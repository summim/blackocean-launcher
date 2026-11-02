// 모드팩 동기화: GitHub 의 manifest.json 과 게임 폴더를 맞춤 (바뀐 파일만 받고, 목록에 없는 모드는 지움)
const fs = require('fs/promises');
const path = require('path');
const cfg = require('./config');
const { fetchJson, downloadAll, exists } = require('./download');

async function fetchManifest() {
  const url = cfg.MANIFEST_URL + (cfg.MANIFEST_URL.includes('?') ? '&' : '?') + 't=' + Date.now();   // 캐시 우회
  return fetchJson(url);
}

/**
 * manifest 형식
 * {
 *   "version": 3, "mc": "1.21.1", "neoforge": "21.1.265", "server": "주소:포트",
 *   "notes": "업데이트 내용",
 *   "managedDirs": ["mods"],                 ← 이 폴더에서 목록에 없는 파일은 삭제
 *   "files": [{ "path": "mods/a.jar", "url": "...", "sha1": "...", "size": 123, "once": false }]
 *            once=true 면 처음 한 번만 (options.txt 처럼 시청자가 바꾸는 파일)
 * }
 */
async function syncPack(manifest, log, progress) {
  const items = [];
  for (const f of manifest.files || []) {
    const rel = f.path.replace(/\\/g, '/');
    if (rel.includes('..')) continue;                           // 게임 폴더 밖으로 못 나가게
    const file = path.join(cfg.GAME_DIR, ...rel.split('/'));
    if (f.once && (await exists(file))) continue;
    items.push({ url: f.url, file, sha1: f.sha1, size: f.size });
  }
  log('모드·설정 확인 중...');
  await downloadAll(items, { parallel: 6, onProgress: (p) => progress({ label: `모드 파일 ${p.done}/${p.total}`, ratio: p.total ? p.done / p.total : 1 }) });

  // 관리 폴더 정리: 목록에 없는 파일 삭제 (옛 버전 모드가 남아 충돌하는 것 방지)
  const keep = new Set((manifest.files || []).map((f) => path.normalize(path.join(cfg.GAME_DIR, ...f.path.replace(/\\/g, '/').split('/'))).toLowerCase()));
  for (const dir of manifest.managedDirs || ['mods']) {
    const abs = path.join(cfg.GAME_DIR, dir);
    let entries;
    try { entries = await fs.readdir(abs, { withFileTypes: true }); } catch { continue; }
    for (const e of entries) {
      if (!e.isFile()) continue;
      const p = path.normalize(path.join(abs, e.name));
      if (!keep.has(p.toLowerCase())) {
        log(`정리: ${dir}/${e.name}`);
        await fs.unlink(p).catch(() => {});
      }
    }
  }
}

module.exports = { fetchManifest, syncPack };
