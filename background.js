/* Video Speed Master - Service Worker：角标 + 全局模式广播中枢 */

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  // content script 查询自己的 tabId
  if (msg.type === 'whoami') {
    sendResponse({ tabId: sender.tab ? sender.tab.id : -1 });
    return true;
  }

  // 把变更广播给除发送者外的所有标签页
  if (msg.type === 'broadcast') {
    chrome.tabs.query({}, (tabs) => {
      for (const t of tabs) {
        if (sender.tab && t.id === sender.tab.id) continue;
        chrome.tabs.sendMessage(t.id, msg.payload).catch(() => {});
      }
    });
    return;
  }

  if (msg.type === 'badge' && typeof msg.rate === 'number') {
    chrome.action.setBadgeText({ text: msg.rate === 1 ? '' : msg.rate + 'x' });
    chrome.action.setBadgeBackgroundColor({ color: msg.rate > 1 ? '#378ADD' : '#1D9E75' });
  }
});

// 标签页关闭时清理其单独设置
chrome.tabs.onRemoved.addListener((id) => {
  chrome.storage.local.get(['vsmTabs'], (l) => {
    const tabs = l.vsmTabs || {};
    if (tabs[id]) {
      delete tabs[id];
      chrome.storage.local.set({ vsmTabs: tabs });
    }
  });
});
