/* Video Speed Master - MAIN world 核心 */
(() => {
  if (window.__VSM_MAIN__) return;

  const MIN = 0.0625;
  const MAX = 16;
  const EPS = 0.001;

  const state = (window.__VSM_MAIN__ = {
    enabled: true,
    rate: 1,
    force: true,
  });

  const clamp = (r) => Math.min(MAX, Math.max(MIN, Math.round(r * 1000) / 1000));

  /* 劫持 playbackRate setter：非目标值的写入直接吞掉，
   * 防止站点在 ratechange 里把速度改回 1x。 */
  const proto = HTMLMediaElement.prototype;
  const native = Object.getOwnPropertyDescriptor(proto, 'playbackRate');
  const nativeGet = native.get;
  const nativeSet = native.set;
  const targets = new WeakMap(); // 各媒体元素的目标速度

  if (nativeSet && !nativeSet.__vsmPatched) {
    const patched = function (value) {
      const target = targets.get(this);
      if (state.enabled && state.force && target != null &&
          Math.abs(value - target) > EPS) {
        pending.add(this); // 页面试图改回去，记下稍后写回
        return;
      }
      nativeSet.call(this, value);
    };
    patched.__vsmPatched = true;
    Object.defineProperty(proto, 'playbackRate', {
      configurable: true,
      enumerable: native.enumerable,
      get: nativeGet,
      set: patched,
    });
  }

  const pending = new Set();

  function writeRate(v, rate) {
    if (!v) return;
    try {
      if (Math.abs(v.playbackRate - rate) > EPS) nativeSet.call(v, rate);
    } catch (_) {}
    // 设 defaultPlaybackRate：元素重新 load 后速度自动保持（应对 SPA 切视频）
    try {
      if (Math.abs(v.defaultPlaybackRate - rate) > EPS) v.defaultPlaybackRate = rate;
    } catch (_) {}
  }

  function enforce(v) {
    if (!state.enabled) return;
    const t = targets.get(v);
    if (t != null) writeRate(v, t);
  }

  /* 发现媒体元素：MutationObserver + Shadow DOM 递归 */
  const known = new Set();

  function collect(root, out) {
    let list;
    try {
      list = root.querySelectorAll('video, audio');
    } catch (_) { return out; }
    for (const el of list) out.push(el);
    return out;
  }

  function deepCollect(root, out, depth) {
    collect(root, out);
    if (depth <= 0) return out;
    let all;
    try { all = root.querySelectorAll('*'); } catch (_) { return out; }
    for (const el of all) {
      if (el.shadowRoot) deepCollect(el.shadowRoot, out, depth - 1);
    }
    return out;
  }

  function scan(deep) {
    const found = deep ? deepCollect(document, [], 4) : collect(document, []);
    for (const v of found) {
      if (!known.has(v)) hook(v);
    }
    return found.length;
  }

  function hook(v) {
    if (known.has(v)) { enforce(v); return; }
    known.add(v);
    if (state.rate !== 1) targets.set(v, state.rate);
    enforce(v);

    const onRate = () => {
      if (!state.enabled) return;
      const t = targets.get(v);
      if (t != null && Math.abs(v.playbackRate - t) > EPS && state.force) {
        writeRate(v, t);
      }
      report(v);
    };

    ['ratechange', 'play', 'playing', 'loadedmetadata', 'durationchange',
     'emptied', 'loadstart', 'canplay', 'seeked'].forEach((ev) =>
      v.addEventListener(ev, onRate, true));

    v.addEventListener('ratechange', () => report(v));
  }

  function report(v) {
    post('rate', { rate: v.playbackRate });
  }

  const mo = new MutationObserver((records) => {
    if (records.some((r) => r.addedNodes.length)) scan(false);
  });
  mo.observe(document.documentElement || document, { childList: true, subtree: true });

  /* 事件驱动接管；并在捕获阶段掐断偏离目标的 ratechange，
   * 站点监听不到就不会触发重置。 */
  ['play', 'playing', 'loadedmetadata', 'durationchange', 'emptied', 'canplay']
    .forEach((ev) => document.addEventListener(ev, (e) => {
      if (e.target instanceof HTMLMediaElement) hook(e.target);
    }, true));

  document.addEventListener('ratechange', (e) => {
    const v = e.target;
    if (!(v instanceof HTMLMediaElement)) return;
    const t = targets.get(v);
    if (!state.enabled || t == null) return;
    if (Math.abs(v.playbackRate - t) > EPS) {
      e.stopImmediatePropagation();
      writeRate(v, t);
    }
  }, true);

  /* YouTube：优先走它自己的 API（齿轮菜单可同步）；>2x 超出其上限，直接写属性 */
  function ytPlayer() {
    const p = document.getElementById('movie_player');
    return p && typeof p.setPlaybackRate === 'function' ? p : null;
  }

  function applyRate(rate) {
    const r = clamp(rate);
    state.rate = r;
    const yt = ytPlayer();
    if (yt && r >= 0.25 && r <= 2) {
      try { yt.setPlaybackRate(r); } catch (_) {}
    }
    for (const v of known) {
      targets.set(v, r);
      enforce(v);
    }
    burst(6000);
    return r;
  }

  let burstUntil = 0;
  function burst(ms) { burstUntil = Date.now() + ms; }

  // SPA 导航后高频重设，熬过播放器异步初始化时的速度重置
  ['yt-navigate-finish', 'yt-page-data-updated', 'popstate', 'hashchange']
    .forEach((ev) => window.addEventListener(ev, () => {
      scan(true);
      burst(8000);
      setTimeout(() => { scan(true); applyRate(state.rate); }, 120);
      setTimeout(() => { scan(true); applyRate(state.rate); }, 800);
    }, true));

  /* 心跳：写回被吞掉的值、清理离屏元素；爆发期做深度扫描 */
  setInterval(() => {
    if (!state.enabled || document.hidden) return;
    for (const v of pending) writeRate(v, targets.get(v));
    pending.clear();
    for (const v of known) {
      if (!v.isConnected) { known.delete(v); continue; }
      enforce(v);
    }
  }, 120);

  setInterval(() => {
    if (document.hidden) return;
    scan(false);
    if (Date.now() < burstUntil) scan(true);
  }, 1000);

  /* 与隔离世界的 content script 通信 */
  function post(type, payload) {
    window.postMessage({ __vsm: 'main', type, ...payload }, '*');
  }

  window.addEventListener('message', (e) => {
    if (e.source !== window) return;
    const d = e.data;
    if (!d || d.__vsm !== 'iso') return;
    switch (d.type) {
      case 'set':
        applyRate(d.rate);
        break;
      case 'enabled':
        state.enabled = !!d.value;
        if (!state.enabled) for (const v of known) targets.delete(v);
        else applyRate(state.rate);
        break;
      case 'force':
        state.force = !!d.value;
        applyRate(state.rate);
        break;
      case 'query': {
        const v = known.values().next().value;
        post('rate', { rate: v ? v.playbackRate : state.rate });
        break;
      }
    }
  });

  window.addEventListener('load', () => { scan(true); applyRate(state.rate); }, true);
  scan(true);
  setTimeout(() => { scan(true); }, 1500);

  post('ready', {});
})();
