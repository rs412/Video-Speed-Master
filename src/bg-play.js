/* Video Speed Master - 后台播放（MAIN world）
 * 切走标签页时阻止站点自动暂停  */
(() => {
  if (window.__VSM_BGPLAY__) return;
  const S = (window.__VSM_BGPLAY__ = { enabled: false });

  // 用户手势时间窗：区分"用户按的暂停"和"页面自动暂停"
  let lastGesture = 0;
  const GESTURE_WINDOW = 900; // ms

  ['pointerdown', 'mousedown', 'keydown', 'touchstart'].forEach((ev) =>
    window.addEventListener(ev, () => { lastGesture = Date.now(); }, true));

  function userActivated() {
    try {
      if (navigator.userActivation && navigator.userActivation.isActive) return true;
    } catch (_) {}
    return Date.now() - lastGesture < GESTURE_WINDOW;
  }

  // 劫持 pause()：非用户意图的暂停直接吞掉
  const proto = HTMLMediaElement.prototype;
  const nativePause = proto.pause;
  const userPaused = new WeakSet();

  if (nativePause && !nativePause.__vsmPatched) {
    const patched = function () {
      if (!S.enabled || this.ended) return nativePause.call(this);
      if (userActivated()) { // 用户主动暂停：放行并记住
        userPaused.add(this);
        return nativePause.call(this);
      }
      // 页面自动暂停：吞掉
    };
    patched.__vsmPatched = true;
    proto.pause = patched;
  }

  // pause 事件兜底：站点绕过 pause() 的其它暂停路径
  document.addEventListener('pause', (e) => {
    if (!S.enabled) return;
    const v = e.target;
    if (!(v instanceof HTMLMediaElement) || v.ended) return;
    if (userPaused.has(v) || userActivated()) return;
    setTimeout(() => {
      if (S.enabled && v.paused && !v.ended && !userPaused.has(v)) {
        v.play().catch(() => {}); // 自动播放被拒时静默放弃
      }
    }, 60);
  }, true);

  document.addEventListener('play', (e) => {
    if (e.target instanceof HTMLMediaElement) userPaused.delete(e.target);
  }, true);

  // 伪造 document.hidden / visibilityState（可撤销：关闭开关时 delete 还原）
  const docProto = Document.prototype;
  const hiddenDesc = Object.getOwnPropertyDescriptor(docProto, 'hidden');
  const vsDesc = Object.getOwnPropertyDescriptor(docProto, 'visibilityState');
  let realHidden = () => false;

  function spoof() {
    try {
      if (hiddenDesc && hiddenDesc.get) {
        realHidden = () => { try { return hiddenDesc.get.call(document); } catch (_) { return false; } };
        Object.defineProperty(document, 'hidden', { get: () => false, configurable: true });
      }
      if (vsDesc) {
        Object.defineProperty(document, 'visibilityState', { get: () => 'visible', configurable: true });
      }
    } catch (_) {}
  }

  function unspoof() {
    try {
      delete document.hidden;
      delete document.visibilityState;
    } catch (_) {}
  }

  // 仅在页面真被隐藏时掐断 visibilitychange，切回时放行；
  // 不拦截 blur / mouseleave 。
  document.addEventListener('visibilitychange', (e) => {
    if (!S.enabled) return;
    if (realHidden()) e.stopImmediatePropagation();
  }, true);

  function setEnabled(on) {
    S.enabled = !!on;
    if (S.enabled) spoof(); else unspoof();
  }

  window.addEventListener('message', (e) => {
    if (e.source !== window) return;
    const d = e.data;
    if (!d || d.__vsm !== 'iso') return;
    if (d.type === 'bgplay') setEnabled(!!d.value);
  });
})();
