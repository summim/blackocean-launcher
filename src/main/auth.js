// 마이크로소프트 로그인 (기기 코드 방식) → Xbox Live → Minecraft 계정
//  1) 코드를 보여주고 https://microsoft.com/link 에서 입력  2) Xbox 토큰  3) Minecraft 토큰 + 프로필
// 저장: 갱신 토큰만 암호화해서 보관 (다음부터는 자동 로그인)
const fs = require('fs/promises');
const path = require('path');
const { app, safeStorage } = require('electron');
const cfg = require('./config');

const MS = 'https://login.microsoftonline.com/consumers/oauth2/v2.0';
const SCOPE = 'XboxLive.signin offline_access';

async function postForm(url, form) {
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams(form).toString(),
  });
  return { ok: res.ok, status: res.status, json: await res.json().catch(() => ({})) };
}

async function postJson(url, body, headers = {}) {
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json', ...headers },
    body: JSON.stringify(body),
  });
  return { ok: res.ok, status: res.status, json: await res.json().catch(() => ({})) };
}

function accountFile() {
  return path.join(app.getPath('userData'), 'account.json');
}

async function loadSaved() {
  try {
    const raw = JSON.parse(await fs.readFile(accountFile(), 'utf8'));
    if (raw.enc && safeStorage.isEncryptionAvailable()) {
      raw.refreshToken = safeStorage.decryptString(Buffer.from(raw.enc, 'base64'));
    }
    return raw;
  } catch { return null; }
}

async function save(acc) {
  const out = { name: acc.name, uuid: acc.uuid, xuid: acc.xuid, source: acc.source };
  if (acc.refreshToken) {
    out.enc = safeStorage.isEncryptionAvailable()
        ? safeStorage.encryptString(acc.refreshToken).toString('base64') : null;
    if (!out.enc) out.refreshToken = acc.refreshToken;
  }
  await fs.mkdir(path.dirname(accountFile()), { recursive: true });
  await fs.writeFile(accountFile(), JSON.stringify(out, null, 2));
}

async function clearSaved() {
  await fs.unlink(accountFile()).catch(() => {});
}

/** 기기 코드 발급. 돌아오는 값으로 사용자에게 코드·주소를 보여주고 pollDeviceCode 로 기다림 */
async function startDeviceCode() {
  if (!cfg.MS_CLIENT_ID || cfg.MS_CLIENT_ID.startsWith('00000000')) {
    throw new Error('접속기에 로그인용 클라이언트 ID가 아직 설정되지 않았어요 (config.js MS_CLIENT_ID)');
  }
  const r = await postForm(`${MS}/devicecode`, { client_id: cfg.MS_CLIENT_ID, scope: SCOPE });
  if (!r.ok) throw new Error('로그인 코드를 받지 못했어요: ' + (r.json.error_description || r.status));
  return r.json; // user_code, device_code, verification_uri, interval, expires_in, message
}

async function pollDeviceCode(dc, isCancelled) {
  const interval = Math.max(1, dc.interval || 5) * 1000;
  const deadline = Date.now() + (dc.expires_in || 900) * 1000;
  while (Date.now() < deadline) {
    if (isCancelled()) throw new Error('로그인을 취소했어요');
    await new Promise((r) => setTimeout(r, interval));
    const r = await postForm(`${MS}/token`, {
      client_id: cfg.MS_CLIENT_ID, grant_type: 'urn:ietf:params:oauth:grant-type:device_code', device_code: dc.device_code,
    });
    if (r.ok) return r.json;
    const err = r.json.error;
    if (err === 'authorization_pending' || err === 'slow_down') continue;
    throw new Error('마이크로소프트 로그인 실패: ' + (r.json.error_description || err));
  }
  throw new Error('로그인 시간이 지났어요. 다시 시도해 주세요');
}

async function refreshMs(refreshToken) {
  const r = await postForm(`${MS}/token`, {
    client_id: cfg.MS_CLIENT_ID, grant_type: 'refresh_token', refresh_token: refreshToken, scope: SCOPE,
  });
  if (!r.ok) throw new Error('자동 로그인 만료: 다시 로그인해 주세요');
  return r.json;
}

/** MS 액세스 토큰 → Minecraft 계정 */
async function minecraftFromMs(msToken) {
  const xbl = await postJson('https://user.auth.xboxlive.com/user/authenticate', {
    Properties: { AuthMethod: 'RPS', SiteName: 'user.auth.xboxlive.com', RpsTicket: 'd=' + msToken.access_token },
    RelyingParty: 'http://auth.xboxlive.com', TokenType: 'JWT',
  });
  if (!xbl.ok) throw new Error('Xbox Live 인증 실패 (' + xbl.status + ')');
  const uhs = xbl.json.DisplayClaims.xui[0].uhs;
  const xsts = await postJson('https://xsts.auth.xboxlive.com/xsts/authorize', {
    Properties: { SandboxId: 'RETAIL', UserTokens: [xbl.json.Token] },
    RelyingParty: 'rp://api.minecraftservices.com/', TokenType: 'JWT',
  });
  if (!xsts.ok) {
    const code = xsts.json.XErr;
    if (code === 2148916233) throw new Error('이 마이크로소프트 계정에 Xbox 프로필이 없어요. xbox.com 에서 한 번 로그인해 만들어 주세요');
    if (code === 2148916238) throw new Error('미성년 계정이라 가족 그룹에 추가되어야 해요');
    throw new Error('Xbox 인증 실패 (' + (code || xsts.status) + ')');
  }
  const mc = await postJson('https://api.minecraftservices.com/authentication/login_with_xbox', {
    identityToken: `XBL3.0 x=${uhs};${xsts.json.Token}`,
  });
  if (!mc.ok) throw new Error('Minecraft 로그인 실패 (' + mc.status + '). 접속기의 클라이언트 ID가 Minecraft API 사용 승인을 받았는지 확인하세요');
  const prof = await fetch('https://api.minecraftservices.com/minecraft/profile', {
    headers: { Authorization: 'Bearer ' + mc.json.access_token },
  });
  if (prof.status === 404) throw new Error('이 계정은 마인크래프트(자바 에디션)를 갖고 있지 않아요');
  if (!prof.ok) throw new Error('프로필 조회 실패 (' + prof.status + ')');
  const p = await prof.json();
  return {
    name: p.name, uuid: p.id, accessToken: mc.json.access_token, xuid: uhs,
    expiresAt: Date.now() + (mc.json.expires_in || 86400) * 1000 - 60000,
    refreshToken: msToken.refresh_token, source: 'msa',
  };
}

/** 저장된 계정으로 조용히 로그인 (실패하면 null) */
async function autoLogin() {
  const saved = await loadSaved();
  if (!saved) return null;
  try {
    if (saved.source === 'official') return await officialLauncherAccount();
    if (!saved.refreshToken) return null;
    const ms = await refreshMs(saved.refreshToken);
    const acc = await minecraftFromMs(ms);
    await save(acc);
    return acc;
  } catch {
    return null;
  }
}

/**
 * 공식 마인크래프트 런처에 로그인된 계정 빌려 쓰기 (클라이언트 ID 승인 전 임시용).
 * 공식 런처를 최근에 켠 적이 있어야 토큰이 살아 있어요.
 */
async function officialLauncherAccount() {
  const file = path.join(process.env.APPDATA || '', '.minecraft', 'launcher_accounts.json');
  let data;
  try { data = JSON.parse(await fs.readFile(file, 'utf8')); } catch {
    throw new Error('공식 런처 계정 파일을 찾지 못했어요. 공식 런처로 한 번 로그인한 뒤 다시 시도하세요');
  }
  const accounts = Object.values(data.accounts || {});
  const active = (data.activeAccountLocalId && data.accounts[data.activeAccountLocalId]) || accounts[0];
  if (!active || !active.accessToken || !active.minecraftProfile) throw new Error('공식 런처에 로그인된 계정이 없어요');
  const prof = await fetch('https://api.minecraftservices.com/minecraft/profile', {
    headers: { Authorization: 'Bearer ' + active.accessToken },
  });
  if (!prof.ok) throw new Error('공식 런처 토큰이 만료됐어요. 공식 런처를 한 번 켜서 로그인 상태를 갱신한 뒤 다시 시도하세요');
  const p = await prof.json();
  const acc = { name: p.name, uuid: p.id, accessToken: active.accessToken, xuid: '', source: 'official' };
  await save(acc);
  return acc;
}

module.exports = { startDeviceCode, pollDeviceCode, minecraftFromMs, autoLogin, save, clearSaved, officialLauncherAccount, loadSaved };
