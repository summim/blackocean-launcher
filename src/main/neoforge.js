// NeoForge 설치 (공식 설치기를 조용히 실행 → versions/neoforge-x.y.z 와 patched client 생성)
const fs = require('fs/promises');
const path = require('path');
const { spawn } = require('child_process');
const cfg = require('./config');
const { downloadFile, exists } = require('./download');

function versionId() {
  return `neoforge-${cfg.NEOFORGE_VERSION}`;
}

async function installed() {
  const id = versionId();
  const json = path.join(cfg.GAME_DIR, 'versions', id, `${id}.json`);
  const patched = path.join(cfg.GAME_DIR, 'libraries', 'net', 'neoforged', 'neoforge', cfg.NEOFORGE_VERSION,
      `neoforge-${cfg.NEOFORGE_VERSION}-client.jar`);
  return (await exists(json)) && (await exists(patched));
}

/** versions/neoforge-x/neoforge-x.jar (바닐라 jar 복사본). -DignoreList 가 이 이름을 기대함 */
async function ensureVersionJar() {
  const id = versionId();
  const jar = path.join(cfg.GAME_DIR, 'versions', id, `${id}.jar`);
  if (await exists(jar)) return;
  const vanilla = path.join(cfg.GAME_DIR, 'versions', cfg.MC_VERSION, `${cfg.MC_VERSION}.jar`);
  await fs.copyFile(vanilla, jar);
}

async function ensureNeoForge(javaExe, log, progress) {
  if (await installed()) { await ensureVersionJar(); return versionId(); }
  const v = cfg.NEOFORGE_VERSION;
  log(`NeoForge ${v} 설치 중... (처음 한 번만, 1~3분)`);
  const installer = path.join(cfg.GAME_DIR, 'cache', `neoforge-${v}-installer.jar`);
  let got = 0;
  await downloadFile(cfg.NEOFORGE_INSTALLER(v), installer, {
    onBytes: (n) => { got += n; progress({ label: 'NeoForge 설치기 내려받는 중', ratio: Math.min(0.99, got / 15e6) }); },
  });
  // 설치기는 launcher_profiles.json 이 있는 폴더만 "런처 폴더"로 인정함
  const profiles = path.join(cfg.GAME_DIR, 'launcher_profiles.json');
  if (!(await exists(profiles))) await fs.writeFile(profiles, JSON.stringify({ profiles: {} }, null, 2));

  const javaConsole = javaExe.replace(/javaw\.exe$/i, 'java.exe');
  await new Promise((resolve, reject) => {
    const p = spawn(javaConsole, ['-jar', installer, '--installClient', cfg.GAME_DIR], {
      cwd: cfg.GAME_DIR, windowsHide: true,
    });
    let out = '';
    const onData = (d) => {
      out += d.toString();
      const lines = out.trim().split('\n');
      const last = lines[lines.length - 1].trim();
      if (last) progress({ label: 'NeoForge 설치 중: ' + last.substring(0, 60), ratio: -1 });
    };
    p.stdout.on('data', onData);
    p.stderr.on('data', onData);
    p.on('error', reject);
    p.on('close', (code) => {
      if (code === 0) resolve();
      else reject(new Error('NeoForge 설치 실패 (코드 ' + code + ')\n' + out.split('\n').slice(-15).join('\n')));
    });
  });
  if (!(await installed())) throw new Error('NeoForge 설치가 끝났는데 파일이 없어요');
  await ensureVersionJar();
  return versionId();
}

module.exports = { ensureNeoForge, versionId };
