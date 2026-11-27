// Volo Browser — preload for tab views (web pages).
// The API is exposed ONLY on the local new-tab page (file:// .../newtab.html).
// Ordinary websites get nothing.
const { contextBridge, ipcRenderer } = require('electron');

if (window.location.protocol === 'file:' && window.location.pathname.endsWith('newtab.html')) {
  contextBridge.exposeInMainWorld('voloNewTab', {
    getEngine: () => ipcRenderer.invoke('view:get-engine'),
    getBookmarks: () => ipcRenderer.invoke('view:get-bookmarks'),
    getTopSites: () => ipcRenderer.invoke('view:get-topsites'),
    getSponsored: () => ipcRenderer.invoke('view:get-sponsored'),
    search: (q) => ipcRenderer.invoke('view:search', q),
    open: (url) => ipcRenderer.invoke('view:open', url)
  });
}
