/* Video Speed Master - 双开防暂停·消提示（MAIN world，实验）
 * 与 dual-tab.js 同一开关：页面 localStorage __vsm_dual__==='1' 时启用。
 * 仅拦截并移除学习平台弹出的"其他端进入学习"Modal（fish-modal-wrap），
 * 不拦截任何网络上报，学习进度/学分不受影响。
 * 命中：节点含 .fish-modal-body 且文本含任一关键词（其他端/自动暂停/学时/学习完/多设备/学习冲突等）。方案 A-1：只杀学习/暂停类弹窗，不误伤正常公告。
 * 移除整层 wrap（含变暗遮罩），页面恢复可点击。
 * 仅靠 MutationObserver 在绘制前移除，零副作用、无闪烁。 */
(() => {
  const KEY = '__vsm_dual__';
  let on = false;
  try { on = localStorage.getItem(KEY) === '1'; } catch (_) {}
  if (!on) return;
  if (window.__VSM_ANTI_TOAST__) return;
  window.__VSM_ANTI_TOAST__ = true;

  const KWS = ['其他端', '自动暂停', '强制暂停', '暂停学习', '学时', '学习完',
    '多设备', '同时在线', '多端在线', '学习冲突', '已在另一', '账号冲突'];

  function bodyOf(el) {
    return el.matches('.fish-modal-body') ? el : el.querySelector('.fish-modal-body');
  }
  function isToast(el) {
    if (!(el instanceof Element)) return false;
    const b = bodyOf(el);
    if (!b) return false;
    const t = b.textContent || '';
    return KWS.some(k => t.indexOf(k) !== -1);
  }
  function wrapOf(el) {
    return el.closest('.fish-modal-wrap') || el.closest('.fish-modal') || el;
  }
  function kill(el) {
    const w = wrapOf(el);
    if (w && w.parentNode) { w.remove(); return true; }
    return false;
  }
  function sweep(roots) {
    for (const r of roots) {
      if (!(r instanceof Element)) continue;
      if (isToast(r)) { kill(r); continue; }
      const bodies = r.querySelectorAll('.fish-modal-body');
      for (const b of bodies) if (isToast(b)) kill(b);
    }
  }

  const obs = new MutationObserver(muts => {
    const added = [];
    for (const m of muts) for (const n of m.addedNodes) added.push(n);
    if (added.length) sweep(added);
  });
  obs.observe(document.documentElement, { childList: true, subtree: true });
  if (document.body) sweep([document.body]);

  console.log('[VSM] 双开防暂停·提示拦截已启用');
})();
