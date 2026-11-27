// Volo Browser — preload for the shell window (tabs strip + address bar UI).
// Exposes a minimal, safe API to the shell renderer. No Node access in the UI.
const { contextBridge, ipcRenderer } = require('electron');

const params = new URLSearchParams(window.location.search);

contextBridge.exposeInMainWorld('volo', {
  isPrivate: params.get('private') === '1',
  versions: {
    electron: process.versions.electron,
    chrome: process.versions.chrome
  },

  // Settings
  getSettings: () => ipcRenderer.invoke('settings:get'),
  setSettings: (patch) => ipcRenderer.invoke('settings:set', patch),

  // Bookmarks
  listBookmarks: () => ipcRenderer.invoke('bookmarks:list'),
  toggleBookmark: (bm) => ipcRenderer.invoke('bookmarks:toggle', bm),
  removeBookmark: (id) => ipcRenderer.invoke('bookmarks:remove', id),

  // History
  listHistory: (limit) => ipcRenderer.invoke('history:list', limit),
  clearHistory: () => ipcRenderer.invoke('history:clear'),
  removeHistory: (id) => ipcRenderer.invoke('history:remove', id),
  clearBrowsingData: (opts) => ipcRenderer.invoke('browsing-data:clear', opts),
  clearAllBrowsingData: () => ipcRenderer.invoke('browsing-data:clear-all'),

  // Downloads (pause / resume / cancel)
  listDownloads: () => ipcRenderer.invoke('downloads:list'),
  clearDownloads: () => ipcRenderer.invoke('downloads:clear'),
  openDownload: (id) => ipcRenderer.invoke('download:open-file', id),
  showDownload: (id) => ipcRenderer.invoke('download:show-in-folder', id),
  pauseDownload: (id) => ipcRenderer.invoke('download:pause', id),
  resumeDownload: (id) => ipcRenderer.invoke('download:resume', id),
  cancelDownload: (id) => ipcRenderer.invoke('download:cancel', id),

  // AdBlocker
  getAdblock: () => ipcRenderer.invoke('adblock:get'),
  setAdblock: (patch) => ipcRenderer.invoke('adblock:set', patch),
  allowAdsOnSite: (allow) => ipcRenderer.invoke('adblock:allow-site', allow),

  // Free VPN
  getVpn: () => ipcRenderer.invoke('vpn:get'),
  refreshVpn: () => ipcRenderer.invoke('vpn:refresh'),
  setVpn: (opts) => ipcRenderer.invoke('vpn:set', opts),
  switchVpnServer: () => ipcRenderer.invoke('vpn:switch-next'),

  // Page tools: translate, reader, screenshot, picture-in-picture
  translatePage: (lang) => ipcRenderer.invoke('page:translate', lang),
  restorePage: () => ipcRenderer.invoke('page:translate-restore'),
  readerView: () => ipcRenderer.invoke('page:reader'),
  screenshotPage: () => ipcRenderer.invoke('page:screenshot'),
  popOutVideo: () => ipcRenderer.invoke('page:pip'),

  // Tab sleep
  sleepTabsNow: () => ipcRenderer.invoke('tabs:sleep-now'),

  // Updates (toolbar Update button)
  getUpdateStatus: () => ipcRenderer.invoke('update:status'),
  checkUpdate: () => ipcRenderer.invoke('update:check'),

  // Volo Call download
  openVoloCall: () => ipcRenderer.invoke('volo-call:open'),

  // Extensions
  listExtensions: () => ipcRenderer.invoke('extensions:list'),
  loadUnpackedExtension: () => ipcRenderer.invoke('extensions:load-unpacked'),
  loadCrxExtension: () => ipcRenderer.invoke('extensions:load-crx'),
  removeExtension: (id) => ipcRenderer.invoke('extensions:remove', id),
  setExtensionEnabled: (id, enabled) => ipcRenderer.invoke('extensions:set-enabled', id, enabled),

  // Find in page + print
  findSearch: (tabId, text, forward, findNext) => ipcRenderer.invoke('find:search', tabId, text, forward, findNext),
  findStop: (tabId) => ipcRenderer.invoke('find:stop', tabId),
  printPage: (tabId) => ipcRenderer.invoke('print:page', tabId),

  // Tabs & navigation
  createTab: (url) => ipcRenderer.invoke('tabs:create', url),
  closeTab: (id) => ipcRenderer.invoke('tabs:close', id),
  activateTab: (id) => ipcRenderer.invoke('tabs:activate', id),
  navigate: (tabId, input) => ipcRenderer.invoke('nav:go', tabId, input),
  goBack: (tabId) => ipcRenderer.invoke('nav:back', tabId),
  goForward: (tabId) => ipcRenderer.invoke('nav:forward', tabId),
  reload: (tabId) => ipcRenderer.invoke('nav:reload', tabId),
  goHome: (tabId) => ipcRenderer.invoke('nav:home', tabId),

  // Windows
  newWindow: () => ipcRenderer.invoke('window:new'),
  newPrivateWindow: () => ipcRenderer.invoke('window:new-private'),
  restart: () => ipcRenderer.invoke('app:restart'),
  openExternal: (url) => ipcRenderer.invoke('shell:open-external', url),

  // AI Assistant (Gemini) + slide-over panels
  chatAI: (messages) => ipcRenderer.invoke('ai:chat', messages),
  setPanelOpen: (open) => ipcRenderer.invoke('panel:set-open', open),

  // Layout: tell main how tall the toolbar is so the web view sits below it.
  setToolbarHeight: (h) => ipcRenderer.send('layout:toolbar-height', h),

  // Events from main
  onTabsUpdate: (cb) => ipcRenderer.on('tabs:update', (_e, data) => cb(data)),
  onBookmarksChanged: (cb) => ipcRenderer.on('bookmarks:changed', (_e, list) => cb(list)),
  onDownloadsUpdate: (cb) => ipcRenderer.on('downloads:update', (_e, list) => cb(list)),
  onSettingsChanged: (cb) => ipcRenderer.on('settings:changed', (_e, s) => cb(s)),
  onFocusAddress: (cb) => ipcRenderer.on('ui:focus-address', () => cb()),
  onShowHistory: (cb) => ipcRenderer.on('ui:show-history', () => cb()),
  onShowDownloads: (cb) => ipcRenderer.on('ui:show-downloads', () => cb()),
  onShowSettings: (cb) => ipcRenderer.on('ui:show-settings', () => cb()),
  onShowAI: (cb) => ipcRenderer.on('ui:show-ai', () => cb()),
  onShowFind: (cb) => ipcRenderer.on('ui:show-find', () => cb()),
  onAdblockCount: (cb) => ipcRenderer.on('adblock:count', (_e, d) => cb(d)),
  onVpnChanged: (cb) => ipcRenderer.on('vpn:changed', (_e, s) => cb(s)),
  onUpdateStatus: (cb) => ipcRenderer.on('update:status', (_e, s) => cb(s)),
  onFindResult: (cb) => ipcRenderer.on('find:result', (_e, r) => cb(r))
});
