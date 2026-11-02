// 마인크래프트 본체(버전 JSON, 클라이언트 jar, 라이브러리, 에셋) 준비 — 공식 런처가 하는 일을 그대로
const fs = require('fs/promises');
const path = require('path');
const cfg = require('./config');
const { fetchJson, downloadFile, downloadAll, exists } = require('./download');

/** 버전 JSON 의 rules 판정 (윈도우 64비트 기준) */
function allowed(rules, features = {}) {
  if (!rules || rules.length === 0) return true;
  let ok = false;
  for (const r of rules) {
    let match = true;
    if (r.os) {
      if (r.os.name && r.os.name !== 'windows') match = false;
      if (r.os.arch && r.os.arch !== 'x64' && r.os.arch !== 'x86_64') match = false;
    }
    if (r.features) {
      for (const [k, v] of Object.entries(r.features)) if (!!features[k] !== !!v) match = false;
    }
    if (match) ok = r.action === 'allow';
  }
  return ok;
}

/** maven 좌표 → libraries 안의 상대 경로 (downloads 정보가 없는 라이브러리용) */
function mavenPath(name) {
  const [group, artifact, version, classifier] = name.split(':');
  const ext = 'jar';
  const file = `${artifact}-${version}${classifier ? '-' + classifier : ''}.${ext}`;
  return path.join(...group.split('.'), artifact, version, file);
}

function libraryFile(lib) {
  const art = lib.downloads && lib.downloads.artifact;
  const rel = art && art.path ? art.path : mavenPath(lib.name);
  return path.join(cfg.GAME_DIR, 'libraries', rel);
}

function libraryUrl(lib) {
  const art = lib.downloads && lib.downloads.artifact;
  if (art && art.url) return art.url;
  const base = lib.url || 'https://libraries.minecraft.net/';
  return base.replace(/\/?$/, '/') + mavenPath(lib.name).split(path.sep).join('/');
}

async function readJson(file) {
  return JSON.parse(await fs.readFile(file, 'utf8'));
}

async function versionJsonPath(id) {
  return path.join(cfg.GAME_DIR, 'versions', id, `${id}.json`);
}

async function ensureVanilla(log, progress) {
  const id = cfg.MC_VERSION;
  const jsonFile = await versionJsonPath(id);
  let vj;
  if (await exists(jsonFile)) {
    vj = await readJson(jsonFile);
  } else {
    log(`마인크래프트 ${id} 정보 받는 중...`);
    const manifest = await fetchJson(cfg.VERSION_MANIFEST);
    const entry = manifest.versions.find((v) => v.id === id);
    if (!entry) throw new Error(`마인크래프트 ${id} 를 목록에서 찾지 못했어요`);
    await downloadFile(entry.url, jsonFile, { sha1: entry.sha1 });
    vj = await readJson(jsonFile);
  }

  // 클라이언트 jar
  const jar = path.join(cfg.GAME_DIR, 'versions', id, `${id}.jar`);
  log('게임 본체 확인 중...');
  let got = 0;
  await downloadFile(vj.downloads.client.url, jar, {
    sha1: vj.downloads.client.sha1, size: vj.downloads.client.size,
    onBytes: (n) => { got += n; progress({ label: '게임 본체 내려받는 중', ratio: got / vj.downloads.client.size }); },
  });

  // 라이브러리
  const libs = vj.libraries.filter((l) => allowed(l.rules)).filter((l) => l.downloads && l.downloads.artifact);
  const libItems = libs.map((l) => ({ url: libraryUrl(l), file: libraryFile(l), sha1: l.downloads.artifact.sha1, size: l.downloads.artifact.size }));
  log('라이브러리 확인 중...');
  await downloadAll(libItems, { onProgress: (p) => progress({ label: `라이브러리 ${p.done}/${p.total}`, ratio: p.done / p.total }) });

  // 에셋 (소리·언어·폰트 등 수천 개)
  const idx = vj.assetIndex;
  const idxFile = path.join(cfg.GAME_DIR, 'assets', 'indexes', `${idx.id}.json`);
  await downloadFile(idx.url, idxFile, { sha1: idx.sha1 });
  const index = await readJson(idxFile);
  const objects = Object.values(index.objects);
  const seen = new Set();
  const assetItems = [];
  for (const o of objects) {
    if (seen.has(o.hash)) continue;
    seen.add(o.hash);
    const sub = o.hash.substring(0, 2);
    assetItems.push({
      url: `${cfg.RESOURCES}/${sub}/${o.hash}`,
      file: path.join(cfg.GAME_DIR, 'assets', 'objects', sub, o.hash),
      sha1: o.hash, size: o.size,
    });
  }
  log('에셋 확인 중...');
  // 이미 있는 파일은 크기만 보고 건너뛰어 빠르게 (sha1 = 파일 이름이라 안전)
  const missing = [];
  for (const it of assetItems) {
    try {
      const st = await fs.stat(it.file);
      if (st.size === it.size) continue;
    } catch {}
    missing.push(it);
  }
  if (missing.length) {
    await downloadAll(missing, { parallel: 16, onProgress: (p) => progress({ label: `게임 파일 ${p.done}/${p.total}`, ratio: p.done / p.total }) });
  }
  return vj;
}

module.exports = { ensureVanilla, allowed, libraryFile, libraryUrl, readJson, versionJsonPath, mavenPath };
