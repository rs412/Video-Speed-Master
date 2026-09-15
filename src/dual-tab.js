/* Video Speed Master - 双开防暂停（MAIN world，实验）
 * 对抗「同一浏览器两个标签页时，平台判定双开并暂停本端」的前端检测（场景一）。
 * 原理：让本页面无法与同源其它标签页通信 ——
 *   1) 接管 BroadcastChannel，使其不再跨标签传递消息；
 *   2) 拦截 storage 事件，阻断基于 localStorage 的跨标签通知；
 *   3) 降级 SharedWorker，避免其充当跨标签状态中枢。
 * 局限：仅覆盖纯前端检测。若平台用服务端心跳协调（场景二，提示常写"其他端"），
 *       需另行拦截心跳上报并忽略下发的暂停指令。
 * 开关：由 content.js 在页面 localStorage 写入 __vsm_dual__（'1'开 / '0'关），重载后生效。 */
(() => {
  const KEY = '__vsm_dual__';
  let on = false;
  try { on = localStorage.getItem(KEY) === '1'; } catch (_) {}
  if (!on) return;
  if (window.__VSM_DUAL__) return;
  window.__VSM_DUAL__ = { enabled: true };

  // 1) BroadcastChannel 全部降级为空壳（跨标签消息不外传）
  const RealBC = window.BroadcastChannel;
  if (RealBC) {
    function FakeBC(name) { this.name = name; this.onmessage = null; this.onmessageerror = null; }
    FakeBC.prototype.postMessage = function () {};
    FakeBC.prototype.close = function () {};
    FakeBC.prototype.addEventListener = function () {};
    FakeBC.prototype.removeEventListener = function () {};
    window.BroadcastChannel = function (name) { return new FakeBC(name); };
    window.BroadcastChannel.prototype = RealBC.prototype;
  }

  // 2) 拦截 storage 事件（阻断跨标签通知），不影响本页自身读写
  const _add = window.addEventListener.bind(window);
  window.addEventListener = function (type, fn, opt) {
    if (type === 'storage') {
      const wrapped = function () { /* 吞掉所有跨标签 storage 通知 */ };
      return _add(type, wrapped, opt);
    }
    return _add(type, fn, opt);
  };

  // 3) SharedWorker 降级（部分平台用它维护全局状态）
  if (window.SharedWorker) {
    window.SharedWorker = function () {
      return {
        port: { postMessage: function () {}, onmessage: null, start: function () {}, close: function () {} },
        addEventListener: function () {}, removeEventListener: function () {},
      };
    };
  }

  console.log('[VSM] 双开防暂停已启用（前端跨标签通道已中和）');
})();
