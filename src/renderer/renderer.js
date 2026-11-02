const $ = (id) => document.getElementById(id);
const L = window.launcher;
let state = { account: null, busy: false, running: false };
let deviceUrl = '';
let msLogin = true;   // 클라이언트 ID 가 설정돼 있을 때만 마이크로소프트 로그인 버튼

function setStatus(t) { $('status').textContent = t; }
function addLog(t) {
  const el = $('log');
  el.textContent += (el.textContent ? '\n' : '') + t;
  el.scrollTop = el.scrollHeight;
}
function renderAccount() {
  const a = state.account;
  $('account').innerHTML = a
    ? `<img src="https://crafatar.com/avatars/${a.uuid}?size=56&overlay" alt=""><b>${a.name}</b>${a.source === 'official' ? '<span class="muted">(공식 런처 계정)</span>' : ''}`
    : `<span class="muted">로그인 안 됨</span>`;
  const play = $('play');
  if (state.running) { play.textContent = '실행 중'; play.disabled = true; }
  else if (state.busy) { play.textContent = '준비 중...'; play.disabled = true; }
  else if (!a) { play.textContent = msLogin ? '마이크로소프트 로그인' : '공식 런처 계정으로 로그인'; play.disabled = false; }
  else { play.textContent = '게임 시작'; play.disabled = false; }
}

L.on('state', (s) => { state = { ...state, ...s }; renderAccount(); });
L.on('log', (m) => addLog(m));
L.on('gameLog', (m) => { /* 게임 로그는 너무 많아 접속기 로그엔 안 보임 */ });
L.on('notes', (n) => { $('notes').textContent = n; });
L.on('config', (c) => { $('ver').textContent = 'v' + c.version; msLogin = c.msLogin !== false; renderAccount(); });
L.on('settings', (s) => { $('ram').value = s.ramMb; $('closeOnLaunch').checked = !!s.closeOnLaunch; });
L.on('progress', (p) => {
  if (p.label) setStatus(p.label);
  const f = $('fill');
  if (p.ratio < 0) { f.classList.add('indeterminate'); }
  else { f.classList.remove('indeterminate'); f.style.width = Math.round(p.ratio * 100) + '%'; }
});
L.on('deviceCode', (d) => {
  deviceUrl = d.url;
  $('codeText').textContent = d.code;
  $('deviceCode').classList.remove('hidden');
});
L.on('launcherUpdate', () => $('updateBar').classList.remove('hidden'));

async function guard(fn) {
  try { await fn(); } catch (e) {
    const msg = (e && e.message ? e.message : String(e)).replace(/^Error invoking remote method '[^']+': Error: /, '');
    setStatus('⚠ ' + msg.split('\n')[0]);
    addLog('오류: ' + msg);
  }
}

$('play').onclick = () => guard(async () => {
  if (!state.account) {
    if (!msLogin) {
      // 아직 자체 로그인(클라이언트 ID)이 준비 안 됨 → 공식 런처에 로그인된 계정을 빌려 씀
      setStatus('공식 런처 계정 확인 중...');
      await L.loginOfficial();
      setStatus('로그인 완료. 게임 시작을 눌러 주세요');
      return;
    }
    setStatus('마이크로소프트 로그인 중...');
    await L.login();
    $('deviceCode').classList.add('hidden');
    setStatus('로그인 완료');
    return;
  }
  await L.play();
});
$('cancelLogin').onclick = () => { L.cancelLogin(); $('deviceCode').classList.add('hidden'); setStatus('취소됨'); };
$('copyCode').onclick = () => navigator.clipboard.writeText($('codeText').textContent);
$('openLink').onclick = () => L.openExternal(deviceUrl);
$('settingsBtn').onclick = () => $('settings').classList.remove('hidden');
$('closeSettings').onclick = () => guard(async () => {
  await L.setSettings({ ramMb: Math.max(2048, parseInt($('ram').value, 10) || 4096), closeOnLaunch: $('closeOnLaunch').checked });
  $('settings').classList.add('hidden');
});
$('openDir').onclick = () => L.openGameDir();
$('loginOfficial').onclick = () => guard(async () => { await L.loginOfficial(); $('settings').classList.add('hidden'); setStatus('공식 런처 계정으로 로그인했어요'); });
$('logout').onclick = () => guard(async () => { await L.logout(); $('settings').classList.add('hidden'); });
$('installUpdate').onclick = () => L.installLauncherUpdate();
renderAccount();
