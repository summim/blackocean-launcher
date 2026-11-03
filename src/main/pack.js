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
 *   "resourcePacks": ["file/팩.zip"]         ← 게임 켜기 전에 options.txt 에서 자동으로 켜 둘 리소스팩
 *   "removedResourcePacks": ["file/옛팩.zip"] ← 예전에 자동으로 켰다가 뺀 팩 (목록에서 지움)
 * }
 */
async function syncPack(manifest, log, progress) {
  await syncFiles(manifest, log, progress);
  await ensureResourcePacks(manifest, log);
}

async function syncFiles(manifest, log, progress) {
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

/**
 * options.txt 의 resourcePacks 줄에 모드팩 리소스팩을 켜 둔다.
 * - 시청자가 직접 켠 다른 팩과 순서는 그대로 두고, 우리 팩만 맨 위(목록 끝)에 붙인다
 * - incompatibleResourcePacks 에 들어가 있으면 빼서 "호환 안 됨" 경고 없이 켜지게 한다
 * - 실패해도 게임 실행은 막지 않는다
 */
async function ensureResourcePacks(manifest, log) {
  const want = (manifest.resourcePacks || []).filter((x) => typeof x === 'string' && x);
  const removed = new Set((manifest.removedResourcePacks || []).filter((x) => typeof x === 'string'));
  if (!want.length && !removed.size) return;
  const file = path.join(cfg.GAME_DIR, 'options.txt');
  try {
    let text = '';
    try { text = await fs.readFile(file, 'utf8'); } catch { /* 처음 실행: 새로 만든다 */ }
    const nl = text.includes('\r\n') ? '\r\n' : '\n';
    const lines = text ? text.split(/\r?\n/) : [];
    if (lines.length && lines[lines.length - 1] === '') lines.pop();

    const readList = (key) => {
      const i = lines.findIndex((l) => l.startsWith(key + ':'));
      if (i < 0) return { i, list: null };
      try {
        const v = JSON.parse(lines[i].slice(key.length + 1));
        return { i, list: Array.isArray(v) ? v.filter((x) => typeof x === 'string') : null };
      } catch { return { i, list: null }; }
    };
    const writeList = (key, i, list) => {
      const line = key + ':' + JSON.stringify(list);
      if (i < 0) lines.push(line); else lines[i] = line;
    };

    const rp = readList('resourcePacks');
    const before = JSON.stringify(rp.list);
    let list = rp.list || ['vanilla', 'mod_resources'];
    list = list.filter((x) => !removed.has(x) && !want.includes(x));
    list.push(...want);                                   // 목록 끝 = 화면에서 맨 위 = 가장 우선
    let changed = JSON.stringify(list) !== before;
    if (changed) writeList('resourcePacks', rp.i, list);

    const inc = readList('incompatibleResourcePacks');
    if (inc.list) {
      const next = inc.list.filter((x) => !want.includes(x) && !removed.has(x));
      if (next.length !== inc.list.length) { writeList('incompatibleResourcePacks', inc.i, next); changed = true; }
    }

    if (changed) {
      await fs.mkdir(path.dirname(file), { recursive: true });
      await fs.writeFile(file, lines.join(nl) + nl, 'utf8');
      log('리소스팩 자동 적용: ' + want.map((x) => x.replace(/^file\//, '')).join(', '));
    }
  } catch (e) {
    log('리소스팩 자동 적용 실패 (' + e.message + '). 설정 → 리소스팩에서 직접 켜 주세요');
  }
}

module.exports = { fetchManifest, syncPack, ensureResourcePacks };
