/** background.js — 工具栏图标：市集页开/关悬浮面板，其他页直接开市集 */
chrome.action.onClicked.addListener((tab) => {
  if (tab.id && tab.url && /^https:\/\/poe\.game\.qq\.com\/trade/.test(tab.url)) {
    chrome.tabs.sendMessage(tab.id, { type: 'P2_TOGGLE_PANEL' }).catch(() => {});
  } else {
    chrome.tabs.create({ url: 'https://poe.game.qq.com/trade' });
  }
});
