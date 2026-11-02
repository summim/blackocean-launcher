// 자바 실행환경 준비 (Adoptium Temurin JRE 를 게임 폴더 안에 내려받음 → 시청자가 자바를 따로 깔 필요 없음)
const fs = require('fs/promises');
const path = require('path');
const AdmZip = require('adm-zip');
const cfg = require('./config');
const { fetchJson, downloadFile, exists } = require('./download');

async function findJavaExe(runtimeDir) {
  try {
    for (const d of await fs.readdir(runtimeDir)) {
      const exe = path.join(runtimeDir, d, 'bin', 'javaw.exe');
      if (await exists(exe)) return exe;
    }
  } catch {}
  return null;
}

async function ensureJava(log, progress) {
  const runtimeDir = path.join(cfg.GAME_DIR, 'runtime', `jre${cfg.JAVA_MAJOR}`);
  const existing = await findJavaExe(runtimeDir);
  if (existing) return existing;

  log(`자바 ${cfg.JAVA_MAJOR} 내려받는 중...`);
  const list = await fetchJson(cfg.ADOPTIUM(cfg.JAVA_MAJOR));
  const pkg = list[0] && list[0].binary && list[0].binary.package;
  if (!pkg) throw new Error('자바 내려받기 주소를 찾지 못했어요');
  const zipFile = path.join(cfg.GAME_DIR, 'runtime', path.basename(pkg.link));
  let got = 0;
  await downloadFile(pkg.link, zipFile, {
    size: pkg.size,
    onBytes: (n) => { got += n; progress({ label: '자바 내려받는 중', ratio: got / pkg.size }); },
  });
  log('자바 압축 푸는 중...');
  await fs.mkdir(runtimeDir, { recursive: true });
  new AdmZip(zipFile).extractAllTo(runtimeDir, true);
  await fs.unlink(zipFile).catch(() => {});
  const exe = await findJavaExe(runtimeDir);
  if (!exe) throw new Error('자바 압축을 풀었는데 javaw.exe 가 없어요');
  return exe;
}

module.exports = { ensureJava };
