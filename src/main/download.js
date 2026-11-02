// 파일 내려받기 (sha1 검사, 병렬, 진행률)
const fs = require('fs');
const fsp = require('fs/promises');
const path = require('path');
const crypto = require('crypto');
const { pipeline } = require('stream/promises');

async function sha1File(file) {
  return new Promise((resolve, reject) => {
    const h = crypto.createHash('sha1');
    fs.createReadStream(file).on('data', (d) => h.update(d)).on('end', () => resolve(h.digest('hex'))).on('error', reject);
  });
}

async function exists(file) {
  try { await fsp.access(file); return true; } catch { return false; }
}

/** 이미 같은 파일(sha1 일치 또는 크기 일치)이 있으면 건너뜀 */
async function upToDate(file, sha1, size) {
  if (!(await exists(file))) return false;
  if (sha1) return (await sha1File(file)) === sha1;
  if (size != null) return (await fsp.stat(file)).size === size;
  return true;
}

async function fetchJson(url) {
  const res = await fetch(url, { headers: { 'User-Agent': 'BlackOceanLauncher' } });
  if (!res.ok) throw new Error(`${url} → HTTP ${res.status}`);
  return res.json();
}

async function downloadFile(url, file, { sha1, size, onBytes } = {}) {
  if (await upToDate(file, sha1, size)) return false;
  await fsp.mkdir(path.dirname(file), { recursive: true });
  const tmp = file + '.part';
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      const res = await fetch(url, { headers: { 'User-Agent': 'BlackOceanLauncher' } });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const out = fs.createWriteStream(tmp);
      const counter = new (require('stream').Transform)({
        transform(chunk, enc, cb) { if (onBytes) onBytes(chunk.length); cb(null, chunk); },
      });
      await pipeline(require('stream').Readable.fromWeb(res.body), counter, out);
      if (sha1) {
        const got = await sha1File(tmp);
        if (got !== sha1) throw new Error(`체크섬 불일치 (${path.basename(file)})`);
      }
      await fsp.rename(tmp, file);
      return true;
    } catch (e) {
      try { await fsp.unlink(tmp); } catch {}
      if (attempt === 3) throw new Error(`내려받기 실패: ${url}\n${e.message}`);
      await new Promise((r) => setTimeout(r, 800 * attempt));
    }
  }
}

/** 여러 파일을 동시에(기본 8개) 내려받음. items: [{url,file,sha1,size}] */
async function downloadAll(items, { parallel = 8, onProgress } = {}) {
  let done = 0, bytes = 0;
  const total = items.length;
  const totalBytes = items.reduce((a, b) => a + (b.size || 0), 0);
  const queue = items.slice();
  const report = () => onProgress && onProgress({ done, total, bytes, totalBytes });
  async function worker() {
    while (queue.length) {
      const it = queue.shift();
      await downloadFile(it.url, it.file, { sha1: it.sha1, size: it.size, onBytes: (n) => { bytes += n; } });
      done++;
      report();
    }
  }
  await Promise.all(Array.from({ length: Math.min(parallel, total) }, worker));
  report();
}

module.exports = { sha1File, exists, downloadFile, downloadAll, fetchJson, upToDate };
