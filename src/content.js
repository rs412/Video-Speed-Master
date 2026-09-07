/* Video Speed Master - content script
 * 快捷键、屏显指示器、设置持久化、与 popup/background 通信；
 * 改速度的操作由 MAIN world 的 inject-main.js 执行。 */
(() => {
  if (window.__VSM_ISO__) return;
  window.__VSM_ISO__ = true;

  const DEFAULTS = {
    rate: 1,
    step: 0.1,
    enabled: true,
    force: true,
    rememberSite: true,
    showOsd: true,
    bgPlay: false,
    scope: 'global', // 'global' 全部标签共用 | 'tab' 仅本标签
    shortcuts: {
      faster: 'Shift+BracketRight',
      slower: 'Shift+BracketLeft',
      reset: 'Shift+Backslash',
    },
  };

  let cfg = { ...DEFAULTS };
  let current = 1;
  let tabId = null;
  const host = location.hostname.replace(/^www\./, '');

  /* 与 MAIN world 通信 */
  const toMain = (type, payload) =>
    window.postMessage({ __vsm: 'iso', type, ...payload }, '*');

  window.addEventListener('message', (e) => {
    if (e.source !== window) return;
    const d = e.data;
    if (!d || d.__vsm !== 'main') return;
    if (d.type === 'rate') {
      current = d.rate;
      updateBadge();
    } else if (d.type === 'ready') {
      toMain('enabled', { value: cfg.enabled });
      toMain('force', { value: cfg.force });
      toMain('set', { rate: cfg.rate });
    }
  });

  /* 设置读写 */
  // content script 拿不到自己的 tabId，向 background 查询
  function getTabId() {
    return new Promise((resolve) => {
      if (tabId != null) return resolve(tabId);
      chrome.runtime.sendMessage({ type: 'whoami' }, (r) => {
        tabId = (r && r.tabId) ? r.tabId : -1;
        resolve(tabId);
      });
    });
  }

  function load() {
    return new Promise((resolve) => {
      chrome.storage.sync.get(['vsmGlobal'], (g) => {
        const global = g.vsmGlobal || {};
        const base = { ...DEFAULTS, ...global };
        cfg = base;

        if (base.scope === 'tab') {
          // 单标签模式：读取本标签的覆盖值
          getTabId().then((id) => {
            chrome.storage.local.get(['vsmTabs'], (l) => {
              const tab = (l.vsmTabs || {})[id];
              if (tab) cfg = { ...base, ...tab };
              resolve();
            });
          });
        } else {
          // 全局模式：站点记忆叠加在全局之上
          chrome.storage.local.get(['vsmSites'], (l) => {
            const site = (l.vsmSites || {})[host];
            if (cfg.rememberSite && site) cfg = { ...base, ...site };
            resolve();
          });
        }
      });
    });
  }

  function save(patch) {
    cfg = { ...cfg, ...patch };
    if (cfg.scope === 'tab') {
      getTabId().then((id) => {
        if (id == null || id < 0) return;
        chrome.storage.local.get(['vsmTabs'], (l) => {
          const tabs = l.vsmTabs || {};
          tabs[id] = { rate: cfg.rate, enabled: cfg.enabled, bgPlay: cfg.bgPlay };
          chrome.storage.local.set({ vsmTabs: tabs });
        });
      });
    } else {
      chrome.storage.sync.set({ vsmGlobal: {
        rate: cfg.rate, enabled: cfg.enabled, step: cfg.step, force: cfg.force,
        rememberSite: cfg.rememberSite, showOsd: cfg.showOsd,
        bgPlay: cfg.bgPlay, scope: cfg.scope, shortcuts: cfg.shortcuts,
      }});
      if (cfg.rememberSite) {
        chrome.storage.local.get(['vsmSites'], (l) => {
          const sites = l.vsmSites || {};
          sites[host] = { rate: cfg.rate, enabled: cfg.enabled };
          chrome.storage.local.set({ vsmSites: sites });
        });
      }
    }
  }

  function updateBadge() {
    chrome.runtime.sendMessage({ type: 'badge', rate: current }).catch?.(() => {});
  }

  /* 应用速度 */
  function setRate(r, opts = {}) {
    const rate = Math.min(16, Math.max(0.0625, Math.round(r * 100) / 100));
    cfg.rate = rate;
    current = rate;
    toMain('set', { rate });
    if (cfg.showOsd && opts.osd !== false) showOsd(rate);
    save({ rate });
    // 全局模式下同步到其它标签页
    if (cfg.scope === 'global') {
      chrome.runtime.sendMessage({ type: 'broadcast', payload: { type: 'set', rate, broadcasted: true } })
        .catch?.(() => {});
    }
  }

  /* 屏显指示器（Shadow DOM 隔离样式） */
  let osd = null, osdTimer = null;

  function buildOsd() {
    const el = document.createElement('div');
    el.style.cssText =
      'all:initial;position:fixed;z-index:2147483647;top:16px;left:50%;' +
      'transform:translateX(-50%);pointer-events:none;font-family:system-ui,sans-serif;';
    const root = el.attachShadow({ mode: 'closed' });
    root.innerHTML = `
      <style>
        .w{background:rgba(12,12,14,.86);color:#fff;font:600 20px/1 ui-monospace,SFMono-Regular,Menlo,monospace;
           padding:10px 16px;border-radius:10px;letter-spacing:.5px;
           box-shadow:0 4px 18px rgba(0,0,0,.35);transition:opacity .18s;opacity:0}
        .w.on{opacity:1}
        .s{font:500 11px/1 system-ui,sans-serif;opacity:.65;margin-top:5px;text-align:center}
      </style>
      <div class="w"><span class="v">1.0x</span><div class="s"></div></div>`;
    return { el, root };
  }

  function showOsd(rate, sub) {
    if (!osd) {
      osd = buildOsd();
      mountOsd();
    }
    const w = osd.root.querySelector('.w');
    osd.root.querySelector('.v').textContent = rate.toFixed(2).replace(/0$/, '') + 'x';
    osd.root.querySelector('.s').textContent =
      sub || (rate > 2 ? '已强制（站点 UI 上限通常为 2x）' : '');
    w.classList.add('on');
    clearTimeout(osdTimer);
    osdTimer = setTimeout(() => w.classList.remove('on'), 1100);
  }

  // 全屏时 fixed 浮层会失效，需挂进全屏元素
  function mountOsd() {
    if (!osd) return;
    const fs = document.fullscreenElement || document.webkitFullscreenElement;
    const target = fs || document.documentElement;
    if (osd.el.parentNode !== target) target.appendChild(osd.el);
    osd.el.style.position = fs ? 'absolute' : 'fixed';
  }

  document.addEventListener('fullscreenchange', mountOsd, true);
  document.addEventListener('webkitfullscreenchange', mountOsd, true);

  /* 快捷键 */
  function keyName(e) {
    const parts = [];
    if (e.shiftKey) parts.push('Shift');
    if (e.ctrlKey) parts.push('Ctrl');
    if (e.altKey) parts.push('Alt');
    parts.push(e.code);
    return parts.join('+');
  }

  function isTyping(t) {
    return t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' ||
                 t.tagName === 'SELECT' || t.isContentEditable);
  }

  // window 捕获阶段抢在站点处理之前
  window.addEventListener('keydown', (e) => {
    if (!cfg.enabled || isTyping(e.target)) return;
    if (e.repeat && !e.altKey) return;
    const k = keyName(e);
    const s = cfg.shortcuts;
    let handled = true;

    if (k === s.faster) setRate(current + cfg.step);
    else if (k === s.slower) setRate(current - cfg.step);
    else if (k === s.reset) setRate(1);
    else handled = false;

    if (handled) {
      e.preventDefault();
      e.stopPropagation();
    }
  }, true);

  /* popup / background 消息：保存 → 转发 MAIN world → 全局模式广播。
   * 广播消息带 broadcasted:true，接收方不再二次广播（防环回）。 */
  function apply(msg) {
    const patch = msg.type === 'set' ? { rate: msg.rate } : (msg.patch || {});
    const fromBroadcast = !!msg.broadcasted;
    const wasScope = cfg.scope;

    save(patch);

    if (patch.enabled != null) toMain('enabled', { value: cfg.enabled });
    if (patch.force != null) toMain('force', { value: cfg.force });
    if (patch.bgPlay != null) toMain('bgplay', { value: cfg.bgPlay });
    if (patch.rate != null) {
      toMain('set', { rate: patch.rate });
      if (!fromBroadcast && cfg.showOsd) showOsd(patch.rate);
      current = patch.rate;
    }

    if (fromBroadcast || cfg.scope !== 'global') return;

    if (patch.scope === 'global' && wasScope !== 'global') {
      // 刚切到全局：把本标签完整设置推给所有其它标签
      chrome.runtime.sendMessage({ type: 'broadcast', payload: {
        type: 'config',
        patch: { rate: cfg.rate, enabled: cfg.enabled, bgPlay: cfg.bgPlay },
        broadcasted: true,
      }}).catch?.(() => {});
    } else if (patch.scope == null) {
      chrome.runtime.sendMessage({ type: 'broadcast', payload: { ...msg, broadcasted: true } })
        .catch?.(() => {});
    }
  }

  chrome.runtime.onMessage.addListener((msg, _s, reply) => {
    switch (msg.type) {
      case 'get':
        reply({ rate: current, cfg });
        break;
      case 'set':
      case 'config':
        apply(msg);
        reply({ ok: true });
        break;
    }
    return true;
  });

  load().then(() => {
    toMain('enabled', { value: cfg.enabled });
    toMain('force', { value: cfg.force });
    toMain('bgplay', { value: cfg.bgPlay });
    if (cfg.rate !== 1) toMain('set', { rate: cfg.rate });
    toMain('query', {});
  });
})();
