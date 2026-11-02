// 블랙오션 접속기 — 메인 프로세스
const { app, BrowserWindow, ipcMain, shell, dialog } = require('electron');
const path = require('path');
const fs = require('fs/promises');
const cfg = require('./config');
const auth = require('./auth');
const { ensureJava } = require('./java');
const { ensureVanilla } = require('./vanilla');
const { ensureNeoForge } = require('./neoforge');
const { fetchManifest, syncPack } = require('./pack');
const { launch, resolveVersion, ensureLibraries } = require('./launch');

let win = null;
let account = null;
let game = null;
let loginCancelled = false;
let settings = { ramMb: cfg.DEFAULT_RAM_MB, closeOnLaunch: true };

const settingsFile = () => path.join(app.getPath('userData'), 'settings.json');
async function loadSettings() {
  try { settings = { ...settings, ...JSON.parse(await fs.readFile(settingsFile(), 'utf8')) }; } catch {}
}
async function saveSettings() {
  await fs.mkdir(path.dirname(settingsFile()), { recursive: true });
  await fs.writeFile(settingsFile(), JSON.stringify(settings, null, 2));
}

function send(channel, payload) {
  if (win && !win.isDestroyed()) win.webContents.send(channel, payload);
}
const log = (msg) => send('log', msg);
const progress = (p) => send('progress', p);
const setState = (s) => send('state', s);

function createWindow() {
  win = new BrowserWindow({
    width: 980, height: 620, resizable: false, autoHideMenuBar: true,
    title: cfg.SERVER_NAME + ' 접속기',
    icon: path.join(__dirname, '..', '..', 'assets', 'icon.png'),
    backgroundColor: '#07111f',
    webPreferences: { preload: path.join(__dirname, '..', 'preload.js'), contextIsolation: true, nodeIntegration: false },
  });
  win.loadFile(path.join(__dirname, '..', 'renderer', 'index.html'));
  win.webContents.setWindowOpenHandler(({ url }) => { shell.openExternal(url); return { action: 'deny' }; });
  win.on('closed', () => { win = null; });
}

app.whenReady().then(async () => {
  await loadSettings();
  createWindow();
  win.webContents.once('did-finish-load', async () => {
    send('settings', settings);
    send('config', { serverName: cfg.SERVER_NAME, gameDir: cfg.GAME_DIR, version: app.getVersion(),
      msLogin: !!cfg.MS_CLIENT_ID && !cfg.MS_CLIENT_ID.startsWith('00000000') });
    account = await auth.autoLogin();
    setState({ account: publicAccount() });
    checkLauncherUpdate();
  });
});

app.on('window-all-closed', () => app.quit());

function publicAccount() {
  return account ? { name: account.name, uuid: account.uuid, source: account.source } : null;
}

// ---------------- 접속기 자동 업데이트 (GitHub 릴리스) ----------------
function checkLauncherUpdate() {
  try {
    const { autoUpdater } = require('electron-updater');
    autoUpdater.autoDownload = true;
    autoUpdater.on('update-available', (i) => log(`접속기 새 버전 ${i.version} 내려받는 중...`));
    autoUpdater.on('update-downloaded', (i) => {
      send('launcherUpdate', { version: i.version });
    });
    autoUpdater.on('error', () => {});
    autoUpdater.checkForUpdates().catch(() => {});
  } catch {}
}
ipcMain.handle('installLauncherUpdate', () => {
  try { require('electron-updater').autoUpdater.quitAndInstall(); } catch {}
});

// ---------------- IPC ----------------
ipcMain.handle('getSettings', () => settings);
ipcMain.handle('setSettings', async (e, s) => { settings = { ...settings, ...s }; await saveSettings(); return settings; });
ipcMain.handle('openGameDir', () => shell.openPath(cfg.GAME_DIR));
ipcMain.handle('openExternal', (e, url) => shell.openExternal(url));

ipcMain.handle('login', async () => {
  loginCancelled = false;
  const dc = await auth.startDeviceCode();
  send('deviceCode', { code: dc.user_code, url: dc.verification_uri });
  shell.openExternal(dc.verification_uri);
  const ms = await auth.pollDeviceCode(dc, () => loginCancelled);
  account = await auth.minecraftFromMs(ms);
  await auth.save(account);
  setState({ account: publicAccount() });
  return publicAccount();
});
ipcMain.handle('cancelLogin', () => { loginCancelled = true; });
ipcMain.handle('loginOfficial', async () => {
  account = await auth.officialLauncherAccount();
  setState({ account: publicAccount() });
  return publicAccount();
});
ipcMain.handle('logout', async () => {
  account = null;
  await auth.clearSaved();
  setState({ account: null });
});

ipcMain.handle('play', async () => {
  if (!account) throw new Error('먼저 로그인해 주세요');
  if (game) throw new Error('게임이 이미 실행 중이에요');
  setState({ busy: true });
  try {
    progress({ label: '준비 중', ratio: -1 });
    const manifest = await fetchManifest().catch((e) => { log('모드 목록을 못 받았어요 (' + e.message + '). 지금 있는 파일로 실행해요'); return null; });
    if (manifest) {
      if (manifest.neoforge) cfg.NEOFORGE_VERSION = manifest.neoforge;
      if (manifest.mc) cfg.MC_VERSION = manifest.mc;
      if (manifest.notes) send('notes', manifest.notes);
    }
    const javaExe = await ensureJava(log, progress);
    await ensureVanilla(log, progress);
    const versionId = await ensureNeoForge(javaExe, log, progress);
    const vj = await resolveVersion(versionId);
    await ensureLibraries(vj, log, progress);
    if (manifest) await syncPack(manifest, log, progress);

    // 계정 토큰이 오래됐으면 갱신
    if (account.expiresAt && Date.now() > account.expiresAt) {
      const fresh = await auth.autoLogin();
      if (fresh) account = fresh; else throw new Error('로그인이 만료됐어요. 다시 로그인해 주세요');
    }
    progress({ label: '게임 실행 중...', ratio: 1 });
    log('게임을 실행해요');
    const server = manifest && manifest.server ? manifest.server : null;
    game = await launch({
      versionId, javaExe, account, ramMb: settings.ramMb, server,
      onLog: (line) => send('gameLog', line),
      onExit: (code) => {
        game = null;
        setState({ busy: false, running: false });
        if (win && !win.isVisible()) win.show();
        if (code !== 0) log(`게임이 종료됐어요 (코드 ${code})`);
      },
    });
    setState({ busy: false, running: true });
    if (settings.closeOnLaunch) setTimeout(() => { if (win && game) win.hide(); }, 8000);
  } catch (e) {
    setState({ busy: false, running: false });
    progress({ label: '', ratio: 0 });
    throw e;
  }
});

ipcMain.handle('killGame', () => { if (game) game.kill(); });

process.on('unhandledRejection', (e) => {
  log('오류: ' + (e && e.message ? e.message : e));
});
