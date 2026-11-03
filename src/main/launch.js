// 게임 실행: 버전 JSON(바닐라 + NeoForge)을 합쳐 자바 실행 인자를 만들고 띄움
const fs = require('fs/promises');
const path = require('path');
const { spawn } = require('child_process');
const cfg = require('./config');
const { allowed, libraryFile, libraryUrl, readJson, versionJsonPath } = require('./vanilla');
const { downloadAll } = require('./download');

/** 자식(neoforge) JSON 에 부모(1.21.1) JSON 을 합침 */
async function resolveVersion(id) {
  const vj = await readJson(await versionJsonPath(id));
  if (!vj.inheritsFrom) return vj;
  const parent = await resolveVersion(vj.inheritsFrom);
  const merged = { ...parent, ...vj };
  merged.libraries = [...(vj.libraries || []), ...(parent.libraries || [])];
  merged.arguments = {
    jvm: [...((parent.arguments || {}).jvm || []), ...((vj.arguments || {}).jvm || [])],
    game: [...((parent.arguments || {}).game || []), ...((vj.arguments || {}).game || [])],
  };
  merged.jar = vj.jar || vj.id;          // 공식 런처처럼 versions/<id>/<id>.jar (설치기가 만든 바닐라 복사본) 을 씀
  return merged;
}

function flattenArgs(list, features) {
  const out = [];
  for (const a of list) {
    if (typeof a === 'string') { out.push(a); continue; }
    if (!allowed(a.rules, features)) continue;
    if (Array.isArray(a.value)) out.push(...a.value); else out.push(a.value);
  }
  return out;
}

function substitute(args, vars) {
  return args.map((a) => a.replace(/\$\{([^}]+)\}/g, (m, k) => (k in vars ? vars[k] : m)));
}

/** NeoForge 가 추가한 라이브러리 중 아직 없는 것 내려받기 (설치기가 대부분 받지만 혹시 모를 누락 대비) */
async function ensureLibraries(vj, log, progress) {
  const items = [];
  const seen = new Set();
  for (const lib of vj.libraries) {
    if (!allowed(lib.rules)) continue;
    const art = lib.downloads && lib.downloads.artifact;
    if (!art) continue;                       // 설치기가 만든 로컬 전용(client-extra 등)은 url 없음
    if (seen.has(lib.name)) continue;
    seen.add(lib.name);
    items.push({ url: libraryUrl(lib), file: libraryFile(lib), sha1: art.sha1, size: art.size });
  }
  await downloadAll(items.filter((i) => i.url), { onProgress: (p) => progress({ label: `라이브러리 ${p.done}/${p.total}`, ratio: p.total ? p.done / p.total : 1 }) });
}

function classpath(vj) {
  const seen = new Set();
  const cp = [];
  for (const lib of vj.libraries) {
    if (!allowed(lib.rules)) continue;
    // 같은 라이브러리의 다른 버전이 부모·자식에 둘 다 있으면 자식(먼저 나온 것) 우선
    const key = lib.name.split(':').slice(0, 2).join(':') + (lib.name.split(':')[3] ? ':' + lib.name.split(':')[3] : '');
    if (seen.has(key)) continue;
    seen.add(key);
    cp.push(libraryFile(lib));
  }
  cp.push(path.join(cfg.GAME_DIR, 'versions', vj.jar, `${vj.jar}.jar`));
  return cp;
}

async function launch({ versionId, javaExe, account, ramMb, server, onLog, onExit }) {
  const vj = await resolveVersion(versionId);
  const natives = path.join(cfg.GAME_DIR, 'natives', versionId);
  await fs.mkdir(natives, { recursive: true });
  const features = { has_quick_plays_support: !!server, is_quick_play_multiplayer: !!server };
  const vars = {
    auth_player_name: account.name,
    version_name: versionId,
    game_directory: cfg.GAME_DIR,
    assets_root: path.join(cfg.GAME_DIR, 'assets'),
    assets_index_name: vj.assets || vj.assetIndex.id,
    auth_uuid: account.uuid,
    auth_access_token: account.accessToken,
    clientid: 'blackocean',
    auth_xuid: account.xuid || '',
    user_type: 'msa',
    version_type: 'release',
    natives_directory: natives,
    launcher_name: 'BlackOceanLauncher',
    launcher_version: '1.0',
    classpath: classpath(vj).join(';'),
    library_directory: path.join(cfg.GAME_DIR, 'libraries'),
    classpath_separator: ';',
    quickPlayMultiplayer: server || '',
    quickPlayPath: path.join(cfg.GAME_DIR, 'quickPlay.json'),
  };
  const jvm = substitute(flattenArgs(vj.arguments.jvm, features), vars);
  const game = substitute(flattenArgs(vj.arguments.game, features), vars);
  const extra = [
    `-Xmx${ramMb}M`, `-Xms${ramMb}M`, // 시작부터 최대 메모리를 잡아 GC(메모리 청소) 횟수를 줄임
    '-Dfile.encoding=UTF-8', '-Dstdout.encoding=UTF-8', '-Dstderr.encoding=UTF-8',
    '-XX:+UseG1GC', '-XX:+UnlockExperimentalVMOptions', '-XX:G1NewSizePercent=20', '-XX:MaxGCPauseMillis=50',
  ];
  const args = [...extra, ...jvm, vj.mainClass, ...game];
  const child = spawn(javaExe, args, { cwd: cfg.GAME_DIR, windowsHide: true, detached: false });
  child.stdout.on('data', (d) => onLog && onLog(d.toString()));
  child.stderr.on('data', (d) => onLog && onLog(d.toString()));
  child.on('close', (code) => onExit && onExit(code));
  return child;
}

module.exports = { launch, resolveVersion, ensureLibraries };
