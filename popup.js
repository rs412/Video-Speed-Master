/* Video Speed Master - 工具栏面板 */
const $ = (id) => document.getElementById(id);

const slider = $('slider');
const val = $('val');

function fmt(r) {
  return (Math.round(r * 100) / 100).toFixed(2).replace(/0$/, '') + 'x';
}

function paint(rate) {
  val.textContent = fmt(rate);
  slider.value = Math.min(8, rate);
  document.querySelectorAll('#presets button').forEach((b) => {
    b.classList.toggle('on', Math.abs(parseFloat(b.dataset.r) - rate) < 0.001);
  });
}

async function withTab(fn) {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab) return;
  try {
    const state = await chrome.tabs.sendMessage(tab.id, { type: 'get' });
    fn(state, tab);
  } catch (_) {
    $('site').textContent = '请刷新页面后使用';
  }
}

function setScope(scope) {
  document.querySelectorAll('#scope button').forEach((b) => {
    b.classList.toggle('on', b.dataset.s === scope);
  });
}

function send(msg) {
  chrome.tabs.query({ active: true, currentWindow: true }, ([tab]) => {
    if (tab) chrome.tabs.sendMessage(tab.id, msg).catch(() => {});
  });
}

withTab((state) => {
  paint(state.rate);
  const c = state.cfg;
  $('step').value = c.step;
  $('force').checked = c.force;
  $('remember').checked = c.rememberSite;
  $('osd').checked = c.showOsd;
  $('bgplay').checked = !!c.bgPlay;
  setScope(c.scope || 'global');
});

slider.addEventListener('input', () => {
  const r = parseFloat(slider.value);
  paint(r);
  send({ type: 'set', rate: r, osd: false });
});

document.querySelectorAll('#presets button').forEach((b) => {
  b.addEventListener('click', () => {
    const r = parseFloat(b.dataset.r);
    paint(r);
    send({ type: 'set', rate: r });
  });
});

$('step').addEventListener('change', (e) =>
  send({ type: 'config', patch: { step: Math.max(0.01, parseFloat(e.target.value) || 0.1) } }));
$('force').addEventListener('change', (e) =>
  send({ type: 'config', patch: { force: e.target.checked } }));
$('remember').addEventListener('change', (e) =>
  send({ type: 'config', patch: { rememberSite: e.target.checked } }));
$('osd').addEventListener('change', (e) =>
  send({ type: 'config', patch: { showOsd: e.target.checked } }));
$('bgplay').addEventListener('change', (e) =>
  send({ type: 'config', patch: { bgPlay: e.target.checked } }));

document.querySelectorAll('#scope button').forEach((b) => {
  b.addEventListener('click', () => {
    setScope(b.dataset.s);
    send({ type: 'config', patch: { scope: b.dataset.s } });
  });
});
