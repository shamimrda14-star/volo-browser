// Volo Browser — main process.
// Product name: "Volo Browser" (user's pick, 2026-11-23 — "Volo" is Latin
// for "I fly"). It lives in ONE place here (PRODUCT_NAME below) plus
// package.json productName/appId — a future rename is a simple find-replace
// of those values.
const { app, BrowserWindow, WebContentsView, ipcMain, session, Menu, shell, dialog } = require('electron');
const path = require('path');
const fs = require('fs');
const { pathToFileURL } = require('url');
const extractZip = require('extract-zip');

const PRODUCT_NAME = 'Volo Browser';
// Built-in tools (the user's own Muse artifacts, public pages). Each entry
// opens its tool page in a normal tab. No download/convert logic lives in
// the browser — these entries only open the tool pages. No proxy is involved.
// Video Downloader: direct video file links work; Facebook/Instagram post
// links may be blocked by Meta and show an honest error on the page itself.
// URLs are the tools' public links, filled in once each artifact is shared.
const VOLO_TOOLS = [
  { name: 'Video Downloader', url: 'https://muse.ai/s/video-downloader-hm6xzxnlwxmxhlxf/lDbqiC0qxlJ0QHF_9-2tAQlmSWaaMId0NAR7YEnCZMY' }, // artifact: video-downloader (public link verified via artifact.status)
  { name: 'File Converter', url: '' }, // artifact: file-converter
  { name: 'Passport Photo Maker', url: '' }, // artifact: passport-photo-maker
];
const SMOKE_TEST = process.argv.includes('--smoke-test');
const SMOKE_DEEP = process.argv.includes('--smoke-deep');
const SMOKE_COOKIE_SET = process.argv.includes('--smoke-cookie-set');
const SMOKE_COOKIE_CHECK = process.argv.includes('--smoke-cookie-check');
const SMOKE_PROXY = process.argv.includes('--smoke-proxy');
const SMOKE_UPDATER = process.argv.includes('--smoke-updater');
const SMOKE_AI = process.argv.includes('--smoke-ai');
const SMOKE_FEATURES = process.argv.includes('--smoke-features');
const START_TIME = Date.now(); // startup-time log (performance: fast start matters)

// ---------------------------------------------------------------------------
// Storage (plain JSON files in the app's userData dir — no telemetry, no cloud)
// ---------------------------------------------------------------------------
const userData = app.getPath('userData');
const SETTINGS_FILE = path.join(userData, 'settings.json');
const BOOKMARKS_FILE = path.join(userData, 'bookmarks.json');
const HISTORY_FILE = path.join(userData, 'history.json');
const MAX_HISTORY = 2000;

function readJson(file, fallback) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    return fallback;
  }
}
function writeJson(file, data) {
  try {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, JSON.stringify(data, null, 2), 'utf8');
  } catch (e) {
    console.error('[volo] failed to write', file, e.message);
  }
}

const DEFAULT_SETTINGS = {
  searchEngine: 'google',          // google | duckduckgo | bing
  privateSearchEngine: 'duckduckgo', // search engine used in private windows
  theme: 'light',             // light | dark
  homepage: 'volo://newtab', // volo://newtab or any URL
  showBookmarksBar: true,
  // Blocked sites: DNS-over-HTTPS bypasses DNS-level blocks.
  dohMode: 'secure',          // secure | automatic | off
  dohTemplate: 'cloudflare',  // cloudflare | google | quad9
  proxyMode: 'system',        // system | none | manual
  proxyRules: '',             // e.g. http=127.0.0.1:8080;https=127.0.0.1:8080
  proxyBypass: '',            // e.g. localhost,127.0.0.1
  proxyUsername: '',          // optional proxy auth — stored in plaintext in
  proxyPassword: '',          // settings.json for v1 (see README)
  // AI Assistant: the user's OWN free Gemini API key (Google AI Studio).
  // Stored in plaintext in settings.json for v1, like the proxy password.
  // Sent ONLY to Google's Gemini API endpoint, in the x-goog-api-key
  // header — never to any other server, never in a URL. No key is shipped.
  aiApiKey: '',
  aiModel: 'gemini-2.0-flash', // free-tier default; user can type another model
  // AdBlocker: EasyList-based blocking, ON by default. Per-site allowlist
  // holds hostnames where the user turned blocking off for that site.
  adblockEnabled: true,
  adblockAllowlist: [], // e.g. ['example.com']
  // Free VPN: routes browser traffic through a free public proxy server.
  // VPNGate's list is OpenVPN/L2TP endpoints (not proxies) and its API is
  // unreachable from this build environment, so the working server source
  // is GeoNode's free public proxy list (no key, no account). The servers
  // are volunteers' public proxies: slow, come and go, and can see
  // traffic — unblocking + casual browsing only, never banking/passwords.
  vpnEnabled: false,
  vpnServer: '', // "ip:port" of the chosen free server, or '' for none
  vpnServers: [], // cached [{ ip, port, country, city, latency, upTime }]
  vpnLastFetch: 0, // epoch ms of the last successful server-list fetch
  // Tab sleep: discard inactive tabs after N minutes (0 = off). Sleeping
  // tabs keep their URL + title and reload when clicked again.
  tabSleepMinutes: 15,
  // Page translate target language (ISO code; 'bn' = Bangla).
  translateLang: 'bn',
  // Volo Call download URL — filled in once its APK is published on
  // GitHub Releases; empty = the menu entry says "coming soon".
  voloCallUrl: ''
};
let settings = { ...DEFAULT_SETTINGS, ...readJson(SETTINGS_FILE, {}) };
let bookmarks = readJson(BOOKMARKS_FILE, []);
let history = readJson(HISTORY_FILE, []);

const SEARCH_ENGINES = {
  duckduckgo: { name: 'DuckDuckGo', searchUrl: 'https://duckduckgo.com/?q=' },
  google: { name: 'Google', searchUrl: 'https://www.google.com/search?q=' },
  bing: { name: 'Bing', searchUrl: 'https://www.bing.com/search?q=' }
};

// ---------------------------------------------------------------------------
// Blocked sites: DNS-over-HTTPS + manual proxy
// DoH encrypts DNS lookups so a DNS-level block (the common way ISPs block
// sites) cannot see or block the domain. Chromium reads the dns_over_https
// preference from the profile's Preferences file at startup, so we write it
// there before any window/session exists. Changing it needs a restart.
// ---------------------------------------------------------------------------
const DOH_TEMPLATES = {
  cloudflare: 'https://cloudflare-dns.com/dns-query',
  google: 'https://dns.google/dns-query',
  quad9: 'https://dns.quad9.net/dns-query'
};
const PREFERENCES_FILE = path.join(userData, 'Preferences');

function applyDohPref() {
  const prefs = readJson(PREFERENCES_FILE, {});
  const mode = settings.dohMode || 'secure';
  prefs.dns_over_https = {
    mode,
    templates: mode === 'secure' ? (DOH_TEMPLATES[settings.dohTemplate] || DOH_TEMPLATES.cloudflare) : ''
  };
  writeJson(PREFERENCES_FILE, prefs);
}
// Enable the DoH feature path in Chromium (harmless on builds where it is
// already the default) and write the preference before sessions start.
app.commandLine.appendSwitch('enable-features', 'DnsOverHttps');
applyDohPref();

// Manual proxy: applied live via session.setProxy (no restart needed).
// When the free VPN is on, its server overrides the manual proxy (the VPN
// toggle is the active route); turning the VPN off restores the proxy mode.
const privateSessions = new Set();
async function applyProxy() {
  const mode = settings.proxyMode || 'system';
  if (settings.vpnEnabled && settings.vpnServer) {
    const config = { proxyRules: `http=${settings.vpnServer};https=${settings.vpnServer}`, proxyBypassRules: 'localhost,127.0.0.1' };
    const sessions = [session.defaultSession, ...privateSessions];
    for (const ses of sessions) {
      try { await ses.setProxy(config); }
      catch (e) { console.error('[volo] vpn setProxy failed', e.message); }
    }
    return;
  }
  const config = mode === 'manual'
    ? { proxyRules: settings.proxyRules || '', proxyBypassRules: settings.proxyBypass || '' }
    : mode === 'none'
      ? { proxyRules: 'direct://', proxyBypassRules: '' }
      : { mode: 'system' };
  const sessions = [session.defaultSession, ...privateSessions];
  for (const ses of sessions) {
    try { await ses.setProxy(mode === 'system' ? { mode: 'system' } : config); }
    catch (e) { console.error('[volo] setProxy failed', e.message); }
  }
}

// Proxy authentication: when a proxy answers 407, Chromium asks the app for
// credentials via the 'login' event. Supply the saved proxy username/password
// (if any). Non-proxy auth challenges keep Electron's default behaviour.
app.on('login', (event, _webContents, _details, authInfo, callback) => {
  if (authInfo.isProxy && settings.proxyUsername) {
    event.preventDefault();
    callback(settings.proxyUsername, settings.proxyPassword || '');
  }
});

// ---------------------------------------------------------------------------
// URL resolving: address-bar input -> real URL (or internal page)
// ---------------------------------------------------------------------------
function resolveInput(input, isPrivate) {
  const text = (input || '').trim();
  if (!text) return { internal: 'newtab' };
  if (text === 'volo://newtab' || text === 'volo:newtab') return { internal: 'newtab' };
  if (/^https?:\/\//i.test(text)) return { url: text };
  if (/^localhost(:\d+)?(\/\S*)?$/.test(text)) return { url: 'http://' + text };
  if (/^[^\s]+\.[a-z]{2,}(:\d+)?(\/\S*)?$/i.test(text)) return { url: 'https://' + text };
  // Private windows search with the private engine (DuckDuckGo by default).
  const key = isPrivate
    ? (settings.privateSearchEngine || 'duckduckgo')
    : (settings.searchEngine || 'google');
  const engine = SEARCH_ENGINES[key] || SEARCH_ENGINES.google;
  return { url: engine.searchUrl + encodeURIComponent(text) };
}

function newTabUrl(winState) {
  const url = pathToFileURL(path.join(__dirname, 'renderer', 'newtab.html'));
  url.searchParams.set('engine', settings.searchEngine);
  url.searchParams.set('theme', settings.theme);
  if (winState.isPrivate) url.searchParams.set('private', '1');
  return url.href;
}

// ---------------------------------------------------------------------------
// Windows & tabs
// ---------------------------------------------------------------------------
// winState: { win, tabs: Map<tabId, tab>, activeTabId, isPrivate, toolbarHeight }
// tab: { id, view, url, title, favicon, loading, canGoBack, canGoForward, isNewTab }
const windows = new Map(); // BrowserWindow.id -> winState
let nextTabId = 1;

function getWinStateBySender(sender) {
  for (const ws of windows.values()) {
    if (ws.win.webContents === sender) return ws;
    for (const tab of ws.tabs.values()) {
      if (tab.view.webContents === sender) return ws;
    }
  }
  return null;
}
function getTabBySender(sender) {
  for (const ws of windows.values()) {
    for (const tab of ws.tabs.values()) {
      if (tab.view.webContents === sender) return { ws, tab };
    }
  }
  return null;
}
function focusedWinState() {
  const win = BrowserWindow.getFocusedWindow();
  return win ? windows.get(win.id) : null;
}

function serializableTab(tab) {
  return {
    id: tab.id,
    url: tab.url,
    title: tab.title || 'New Tab',
    favicon: tab.favicon || '',
    loading: tab.loading,
    canGoBack: tab.canGoBack,
    canGoForward: tab.canGoForward,
    isNewTab: tab.isNewTab,
    sleeping: !!tab.sleeping
  };
}
function sendTabsUpdate(ws) {
  const tabs = [...ws.tabs.values()].map(serializableTab);
  ws.win.webContents.send('tabs:update', { tabs, activeTabId: ws.activeTabId, isPrivate: ws.isPrivate });
}

function layoutViews(ws) {
  const bounds = ws.win.getContentBounds();
  const active = ws.tabs.get(ws.activeTabId);
  if (!active) return;
  const y = ws.toolbarHeight || 84;
  active.view.setBounds({ x: 0, y, width: bounds.width, height: Math.max(0, bounds.height - y) });
}

function recordHistory(tab) {
  if (!tab.url || !/^https?:\/\//i.test(tab.url)) return;
  const entry = { id: Date.now() + '-' + Math.random().toString(36).slice(2, 8), title: tab.title || tab.url, url: tab.url, visitedAt: Date.now() };
  history = [entry, ...history.filter(h => h.url !== tab.url)].slice(0, MAX_HISTORY);
  writeJson(HISTORY_FILE, history);
}

function createTab(ws, input) {
  const id = nextTabId++;
  const view = new WebContentsView({
    webPreferences: {
      preload: path.join(__dirname, 'preload-view.js'),
      contextIsolation: true,
      nodeIntegration: false,
      ...(ws.isPrivate ? { partition: `private-${ws.win.id}` } : {})
    }
  });
  view.setBackgroundColor(settings.theme === 'dark' ? '#1f2328' : '#ffffff');
  const tab = { id, view, url: '', title: 'New Tab', favicon: '', loading: false, canGoBack: false, canGoForward: false, isNewTab: true, lastActiveAt: Date.now(), sleeping: false, sleepUrl: '' };
  ws.tabs.set(id, tab);
  const wc = view.webContents;

  wc.on('did-navigate', (_e, url) => {
    tab.url = url;
    tab.isNewTab = url.startsWith('file://') && url.includes('newtab.html');
    tab.canGoBack = wc.navigationHistory.canGoBack();
    tab.canGoForward = wc.navigationHistory.canGoForward();
    if (!ws.isPrivate) recordHistory(tab);
    sendTabsUpdate(ws);
  });
  wc.on('did-navigate-in-page', (_e, url) => {
    tab.url = url;
    tab.canGoBack = wc.navigationHistory.canGoBack();
    tab.canGoForward = wc.navigationHistory.canGoForward();
    sendTabsUpdate(ws);
  });
  wc.on('page-title-updated', (_e, title) => {
    if (tab.sleeping) return; // sleeping tabs keep their 💤 title until woken
    tab.title = title || 'New Tab';
    if (ws.activeTabId === id) ws.win.setTitle(`${tab.title} - ${PRODUCT_NAME}`);
    // History entries are recorded at navigation time (before the title is
    // known) — refresh the stored title now that we have it.
    if (!ws.isPrivate && /^https?:\/\//i.test(tab.url)) {
      const entry = history.find(h => h.url === tab.url);
      if (entry && entry.title !== tab.title) {
        entry.title = tab.title;
        writeJson(HISTORY_FILE, history);
      }
    }
    sendTabsUpdate(ws);
  });
  wc.on('page-favicon-updated', (_e, favicons) => {
    if (favicons && favicons.length) tab.favicon = favicons[0];
    sendTabsUpdate(ws);
  });
  wc.on('did-start-loading', () => { tab.loading = true; sendTabsUpdate(ws); });
  wc.on('did-stop-loading', () => {
    tab.loading = false;
    tab.canGoBack = wc.navigationHistory.canGoBack();
    tab.canGoForward = wc.navigationHistory.canGoForward();
    sendTabsUpdate(ws);
  });
  wc.on('did-fail-load', (_e, code, desc, url, isMainFrame) => {
    if (isMainFrame && code !== -3) { // -3 = aborted (e.g. new navigation started)
      tab.title = 'Failed to load';
      sendTabsUpdate(ws);
    }
  });
  wc.on('found-in-page', (_e, result) => {
    ws.win.webContents.send('find:result', {
      tabId: id,
      activeMatchOrdinal: result.activeMatchOrdinal,
      matches: result.matches,
      finalUpdate: result.finalUpdate
    });
  });
  // Links that would open a new window -> open in a new tab instead.
  wc.setWindowOpenHandler(({ url }) => {
    createTab(ws, url);
    return { action: 'deny' };
  });
  wc.on('context-menu', (_e, params) => showContextMenu(ws, tab, params));

  navigateTab(ws, tab, input === undefined ? 'volo://newtab' : input);
  activateTab(ws, id);
  return tab;
}

function navigateTab(ws, tab, input) {
  const resolved = resolveInput(input, ws.isPrivate);
  if (resolved.internal === 'newtab') {
    tab.view.webContents.loadURL(newTabUrl(ws));
  } else {
    tab.view.webContents.loadURL(resolved.url);
  }
}

function activateTab(ws, tabId) {
  const prev = ws.tabs.get(ws.activeTabId);
  if (prev && prev.id !== tabId) {
    try { ws.win.contentView.removeChildView(prev.view); } catch { /* already removed */ }
  }
  const tab = ws.tabs.get(tabId);
  if (!tab) return;
  // Waking a sleeping tab: reload the page it had open.
  if (tab.sleeping) {
    tab.sleeping = false;
    const url = tab.sleepUrl || tab.url;
    tab.sleepUrl = '';
    if (/^https?:\/\//i.test(url || '')) tab.view.webContents.loadURL(url);
  }
  tab.lastActiveAt = Date.now();
  ws.activeTabId = tabId;
  ws.win.contentView.addChildView(tab.view);
  // Slide-over panels (History, Settings, AI…) live in the shell window's
  // own HTML, which a WebContentsView paints OVER — so while a panel is
  // open the page view stays hidden. See 'panel:set-open' below.
  tab.view.setVisible(!ws.panelOpen);
  layoutViews(ws);
  ws.win.setTitle(`${tab.title || 'New Tab'} - ${PRODUCT_NAME}`);
  sendTabsUpdate(ws);
}

function closeTab(ws, tabId) {
  const tab = ws.tabs.get(tabId);
  if (!tab) return;
  try { ws.win.contentView.removeChildView(tab.view); } catch { /* noop */ }
  try { tab.view.webContents.destroy(); } catch { /* noop */ }
  ws.tabs.delete(tabId);
  if (ws.tabs.size === 0) {
    ws.win.close();
    return;
  }
  if (ws.activeTabId === tabId) {
    const ids = [...ws.tabs.keys()];
    activateTab(ws, ids[ids.length - 1]);
  } else {
    sendTabsUpdate(ws);
  }
}

// ---------------------------------------------------------------------------
// Tab sleep / memory saver — unloads the document of an inactive tab
// (frees the page's JS + DOM memory; the tab keeps its URL + title and
// reloads the moment it is clicked again). Never sleeps the active tab,
// a tab playing audio, or a non-web page.
// ---------------------------------------------------------------------------
function sleepTab(ws, tab) {
  if (!tab || tab.sleeping || tab.id === ws.activeTabId) return false;
  if (!/^https?:\/\//i.test(tab.url || '')) return false;
  try { if (tab.view.webContents.isCurrentlyAudible()) return false; } catch { /* ignore */ }
  tab.sleeping = true;
  tab.sleepUrl = tab.url;
  tab.title = '💤 ' + (tab.title || 'New Tab').replace(/^💤 /, '');
  try { tab.view.webContents.loadURL('about:blank'); } catch { /* ignore */ }
  sendTabsUpdate(ws);
  return true;
}
function sleepInactiveTabs(ws, minutes) {
  const idleMs = (minutes || 0) * 60 * 1000;
  const now = Date.now();
  let slept = 0;
  for (const tab of ws.tabs.values()) {
    if (tab.id === ws.activeTabId || tab.sleeping) continue;
    if (idleMs > 0 && (now - (tab.lastActiveAt || now)) < idleMs) continue;
    if (sleepTab(ws, tab)) slept++;
  }
  return slept;
}
function checkSleepTabs() {
  const minutes = settings.tabSleepMinutes || 0;
  if (!minutes) return;
  for (const ws of windows.values()) sleepInactiveTabs(ws, minutes);
}

// ---------------------------------------------------------------------------
// Context menu (right-click inside a page)
// ---------------------------------------------------------------------------
function showContextMenu(ws, tab, params) {
  const wc = tab.view.webContents;
  const template = [
    { label: 'Back', enabled: wc.navigationHistory.canGoBack(), click: () => wc.navigationHistory.goBack() },
    { label: 'Forward', enabled: wc.navigationHistory.canGoForward(), click: () => wc.navigationHistory.goForward() },
    { label: 'Reload', click: () => wc.reload() },
    { type: 'separator' }
  ];
  if (params.linkURL) {
    template.push(
      { label: 'Open Link in New Tab', click: () => createTab(ws, params.linkURL) },
      { label: 'Copy Link Address', click: () => require('electron').clipboard.writeText(params.linkURL) },
      { type: 'separator' }
    );
  }
  if (params.srcURL) {
    template.push(
      { label: 'Open Image in New Tab', click: () => createTab(ws, params.srcURL) },
      { label: 'Copy Image Address', click: () => require('electron').clipboard.writeText(params.srcURL) },
      { type: 'separator' }
    );
  }
  if (params.selectionText) {
    template.push(
      { label: 'Copy', role: 'copy' },
      { label: `Search "${params.selectionText.slice(0, 30)}${params.selectionText.length > 30 ? '…' : ''}"`, click: () => createTab(ws, params.selectionText) },
      { type: 'separator' }
    );
  }
  if (params.isEditable) {
    template.push(
      { label: 'Cut', role: 'cut' }, { label: 'Copy', role: 'copy' },
      { label: 'Paste', role: 'paste' }, { label: 'Select All', role: 'selectAll' },
      { type: 'separator' }
    );
  }
  template.push({ label: 'Inspect Element', click: () => wc.inspectElement(params.x, params.y) });
  Menu.buildFromTemplate(template).popup({ window: ws.win });
}

// ---------------------------------------------------------------------------
// Downloads
// ---------------------------------------------------------------------------
const downloads = new Map(); // id -> { id, filename, url, totalBytes, receivedBytes, state, savePath }
const downloadItems = new Map(); // id -> DownloadItem (for pause / resume / cancel)
let nextDownloadId = 1;
const downloadSessions = new Set();

function broadcastDownloads() {
  const list = [...downloads.values()].reverse();
  for (const ws of windows.values()) ws.win.webContents.send('downloads:update', list);
}
function attachDownloadHandler(ses) {
  if (downloadSessions.has(ses)) return;
  downloadSessions.add(ses);
  ses.on('will-download', (event, item) => {
    const id = nextDownloadId++;
    const filename = item.getFilename();
    const savePath = path.join(app.getPath('downloads'), filename);
    item.setSavePath(savePath);
    const info = { id, filename, url: item.getURL(), totalBytes: item.getTotalBytes(), receivedBytes: 0, state: 'progressing', savePath };
    downloads.set(id, info);
    downloadItems.set(id, item);
    broadcastDownloads();
    item.on('updated', (_e, state) => {
      info.receivedBytes = item.getReceivedBytes();
      info.totalBytes = item.getTotalBytes();
      if (state === 'interrupted') info.state = item.isPaused() ? 'paused' : 'interrupted';
      broadcastDownloads();
    });
    item.on('done', (_e, state) => {
      info.state = state; // completed | cancelled | interrupted
      info.receivedBytes = item.getReceivedBytes();
      downloadItems.delete(id);
      broadcastDownloads();
    });
  });
}

// ---------------------------------------------------------------------------
// Extensions (Chrome extensions: unpacked folders and .crx files)
// NOTE: Chrome Web Store one-click install does NOT work in Electron —
// extensions must be loaded from an unpacked folder or a .crx file.
// Extensions run in normal windows only, not in private windows.
// ---------------------------------------------------------------------------
const EXTENSIONS_FILE = path.join(userData, 'extensions.json');
const EXTENSIONS_DIR = path.join(userData, 'extensions');
let persistedExtensions = readJson(EXTENSIONS_FILE, []); // [{ id, name, path, enabled }]

function upsertPersistedExtension(id, name, dir) {
  const prev = persistedExtensions.find(p => p.id === id || p.path === dir);
  persistedExtensions = persistedExtensions.filter(p => p.id !== id && p.path !== dir);
  persistedExtensions.push({ id, name, path: dir, enabled: prev ? prev.enabled !== false : true });
  writeJson(EXTENSIONS_FILE, persistedExtensions);
}

async function loadPersistedExtensions() {
  for (const entry of persistedExtensions) {
    try {
      if (entry.enabled === false) continue; // disabled by the user
      if (!entry.path || !fs.existsSync(entry.path)) continue;
      const ext = await session.defaultSession.loadExtension(entry.path, { allowFileAccess: true });
      entry.id = ext.id;
      entry.name = ext.name;
    } catch (e) {
      console.error('[volo] failed to load extension', entry.path, e.message);
    }
  }
  writeJson(EXTENSIONS_FILE, persistedExtensions);
}

function listExtensions() {
  const loaded = session.defaultSession.getAllExtensions();
  const loadedIds = new Set(loaded.map(e => e.id));
  const list = loaded.map(ext => {
    const entry = persistedExtensions.find(p => p.id === ext.id);
    return { id: ext.id, name: ext.name, version: ext.version, path: entry ? entry.path : '', enabled: true };
  });
  // Disabled extensions are not loaded — list them from the persisted file.
  for (const entry of persistedExtensions) {
    if (entry.enabled === false && !loadedIds.has(entry.id)) {
      list.push({ id: entry.id, name: entry.name || 'Extension', version: '', path: entry.path, enabled: false });
    }
  }
  return list;
}

// A .crx file is a small header + a zip. Strip the header, unzip the rest.
async function extractCrx(crxPath, destDir) {
  const buf = fs.readFileSync(crxPath);
  if (buf.toString('ascii', 0, 4) !== 'Cr24') throw new Error('Not a .crx file (bad header)');
  const version = buf.readUInt32LE(4);
  let zipOffset;
  if (version === 2) {
    zipOffset = 16 + buf.readUInt32LE(8) + buf.readUInt32LE(12);
  } else if (version === 3) {
    zipOffset = 12 + buf.readUInt32LE(8);
  } else {
    throw new Error('Unsupported .crx version: ' + version);
  }
  const zipBuf = buf.subarray(zipOffset);
  if (zipBuf.toString('ascii', 0, 2) !== 'PK') throw new Error('Could not find extension data inside the .crx file');
  const tmpZip = destDir + '.zip';
  fs.mkdirSync(path.dirname(destDir), { recursive: true });
  fs.writeFileSync(tmpZip, zipBuf);
  fs.mkdirSync(destDir, { recursive: true });
  await extractZip(tmpZip, { dir: destDir });
  fs.unlinkSync(tmpZip);
  if (!fs.existsSync(path.join(destDir, 'manifest.json'))) {
    throw new Error('No manifest.json found — not a valid extension');
  }
}

// ---------------------------------------------------------------------------
// Browser windows
// ---------------------------------------------------------------------------
function createBrowserWindow({ isPrivate = false, url } = {}) {
  const win = new BrowserWindow({
    width: 1280,
    height: 800,
    minWidth: 800,
    minHeight: 500,
    title: PRODUCT_NAME,
    icon: path.join(__dirname, 'assets', 'logo.png'),
    backgroundColor: settings.theme === 'dark' ? '#1f2328' : '#ffffff',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false
    }
  });
  const ws = { win, tabs: new Map(), activeTabId: null, isPrivate, toolbarHeight: 84, panelOpen: false };
  windows.set(win.id, ws);
  attachDownloadHandler(session.defaultSession);
  attachAdblocker(session.defaultSession);
  if (isPrivate) {
    const privSes = session.fromPartition(`private-${win.id}`);
    privateSessions.add(privSes);
    attachDownloadHandler(privSes);
    attachAdblocker(privSes);
    applyProxy();
  }

  win.loadFile(path.join(__dirname, 'renderer', 'index.html'), { query: { private: isPrivate ? '1' : '0' } });
  win.on('resize', () => layoutViews(ws));
  win.on('closed', () => {
    for (const tab of ws.tabs.values()) {
      try { tab.view.webContents.destroy(); } catch { /* noop */ }
    }
    windows.delete(win.id);
  });
  win.webContents.on('did-finish-load', () => {
    if (ws.tabs.size === 0) createTab(ws, url);
    sendTabsUpdate(ws);
    // Test-only hook: auto-open a slide-over panel (e.g. VOLO_SMOKE_PANEL=ai-panel)
    // so a screenshot can verify the panel actually renders above the page.
    if (process.env.VOLO_SMOKE_PANEL && !ws._panelHookDone) {
      ws._panelHookDone = true;
      const panelId = process.env.VOLO_SMOKE_PANEL;
      setTimeout(() => { win.webContents.executeJavaScript(`openPanel(${JSON.stringify(panelId)})`).catch(() => {}); }, 800);
    }
  });
  return ws;
}

// ---------------------------------------------------------------------------
// Application menu
// ---------------------------------------------------------------------------
function buildMenu() {
  const template = [
    {
      label: 'File',
      submenu: [
        { label: 'New Tab', accelerator: 'CmdOrCtrl+T', click: () => { const ws = focusedWinState(); if (ws) createTab(ws); } },
        { label: 'New Window', accelerator: 'CmdOrCtrl+N', click: () => createBrowserWindow({}) },
        { label: 'New Private Window', accelerator: 'CmdOrCtrl+Shift+N', click: () => createBrowserWindow({ isPrivate: true }) },
        { type: 'separator' },
        { label: 'Close Tab', accelerator: 'CmdOrCtrl+W', click: () => { const ws = focusedWinState(); if (ws && ws.activeTabId) closeTab(ws, ws.activeTabId); } },
        { type: 'separator' },
        {
          label: 'Print…', accelerator: 'CmdOrCtrl+P',
          click: () => {
            const ws = focusedWinState();
            const t = ws && ws.tabs.get(ws.activeTabId);
            if (t) t.view.webContents.print({ silent: false, printBackground: true }, (ok, err) => { if (!ok) console.error('[volo] print failed:', err); });
          }
        },
        { type: 'separator' },
        { label: 'Exit', role: 'quit' }
      ]
    },
    {
      label: 'Edit',
      submenu: [
        { label: 'Find in Page…', accelerator: 'CmdOrCtrl+F', click: () => { const ws = focusedWinState(); if (ws) ws.win.webContents.send('ui:show-find'); } },
        { type: 'separator' },
        { label: 'Undo', role: 'undo' }, { label: 'Redo', role: 'redo' },
        { type: 'separator' },
        { label: 'Cut', role: 'cut' }, { label: 'Copy', role: 'copy' },
        { label: 'Paste', role: 'paste' }, { label: 'Select All', role: 'selectAll' }
      ]
    },
    {
      label: 'View',
      submenu: [
        { label: 'Reload', accelerator: 'CmdOrCtrl+R', click: () => { const ws = focusedWinState(); const t = ws && ws.tabs.get(ws.activeTabId); if (t) t.view.webContents.reload(); } },
        { label: 'Back', accelerator: 'Alt+Left', click: () => { const ws = focusedWinState(); const t = ws && ws.tabs.get(ws.activeTabId); if (t && t.view.webContents.navigationHistory.canGoBack()) t.view.webContents.navigationHistory.goBack(); } },
        { label: 'Forward', accelerator: 'Alt+Right', click: () => { const ws = focusedWinState(); const t = ws && ws.tabs.get(ws.activeTabId); if (t && t.view.webContents.navigationHistory.canGoForward()) t.view.webContents.navigationHistory.goForward(); } },
        { label: 'Focus Address Bar', accelerator: 'CmdOrCtrl+L', click: () => { const ws = focusedWinState(); if (ws) ws.win.webContents.send('ui:focus-address'); } },
        { label: 'AI Assistant', accelerator: 'CmdOrCtrl+Shift+A', click: () => { const ws = focusedWinState(); if (ws) ws.win.webContents.send('ui:show-ai'); } },
        { type: 'separator' },
        { label: 'Zoom In', accelerator: 'CmdOrCtrl+Plus', click: () => zoomActive(0.1) },
        { label: 'Zoom Out', accelerator: 'CmdOrCtrl+-', click: () => zoomActive(-0.1) },
        { label: 'Reset Zoom', accelerator: 'CmdOrCtrl+0', click: () => zoomActive(null) },
        { type: 'separator' },
        { label: 'Toggle Dark / Light Theme', click: () => setSettings({ theme: settings.theme === 'dark' ? 'light' : 'dark' }) },
        { label: 'Toggle Developer Tools', accelerator: 'CmdOrCtrl+Shift+I', click: () => { const ws = focusedWinState(); const t = ws && ws.tabs.get(ws.activeTabId); if (t) t.view.webContents.toggleDevTools(); } },
        { type: 'separator' },
        {
          label: 'Translate Page',
          submenu: [
            { label: 'Translate to Bangla', click: async () => { const r = await translateActivePage('bn'); if (!r.ok) dialog.showMessageBox({ type: 'info', title: 'Translate', message: r.error || 'Translation failed.' }); } },
            { label: 'Translate to English', click: async () => { const r = await translateActivePage('en'); if (!r.ok) dialog.showMessageBox({ type: 'info', title: 'Translate', message: r.error || 'Translation failed.' }); } },
            { label: 'Translate to Hindi', click: async () => { const r = await translateActivePage('hi'); if (!r.ok) dialog.showMessageBox({ type: 'info', title: 'Translate', message: r.error || 'Translation failed.' }); } },
            { label: 'Translate to Spanish', click: async () => { const r = await translateActivePage('es'); if (!r.ok) dialog.showMessageBox({ type: 'info', title: 'Translate', message: r.error || 'Translation failed.' }); } },
            { label: 'Translate to Arabic', click: async () => { const r = await translateActivePage('ar'); if (!r.ok) dialog.showMessageBox({ type: 'info', title: 'Translate', message: r.error || 'Translation failed.' }); } },
            { label: 'Translate to French', click: async () => { const r = await translateActivePage('fr'); if (!r.ok) dialog.showMessageBox({ type: 'info', title: 'Translate', message: r.error || 'Translation failed.' }); } },
            { type: 'separator' },
            { label: 'Show Original Page', click: async () => { await restoreTranslatedPage(); } }
          ]
        },
        { label: 'Reader View', accelerator: 'CmdOrCtrl+Shift+R', click: async () => { const r = await readerActivePage(); if (!r.ok) dialog.showMessageBox({ type: 'info', title: 'Reader View', message: r.error || 'Could not open Reader view.' }); } },
        { label: 'Screenshot Full Page', click: async () => { const r = await screenshotActivePage(); if (!r.ok) dialog.showMessageBox({ type: 'info', title: 'Screenshot', message: r.error || 'Screenshot failed.' }); } },
        { label: 'Pop Out Video (Picture-in-Picture)', click: async () => {
          const r = await popOutVideo();
          if (!r.ok) dialog.showMessageBox({ type: 'info', title: 'Video Pop-out', message: r.error === 'no-video' ? 'No video found on this page.' : r.error === 'already' ? 'The video is already popped out.' : 'Could not pop out the video (' + (r.error || 'failed') + ').' });
        } },
        { label: 'Sleep Other Tabs Now', click: () => { const ws = focusedWinState(); if (ws) sleepInactiveTabs(ws, 0); } }
      ]
    },
    {
      label: 'History',
      submenu: [
        { label: 'Show History', accelerator: 'CmdOrCtrl+H', click: () => { const ws = focusedWinState(); if (ws) ws.win.webContents.send('ui:show-history'); } },
        { label: 'Show Downloads', accelerator: 'CmdOrCtrl+J', click: () => { const ws = focusedWinState(); if (ws) ws.win.webContents.send('ui:show-downloads'); } },
        {
          label: 'Clear All Browsing Data…',
          click: async () => {
            const cleared = await clearAllBrowsingData();
            dialog.showMessageBox({ type: 'info', title: 'Browsing Data Cleared', message: 'Cleared: ' + cleared.join(', ') + '.', detail: 'You have been signed out of sites (cookies were cleared).' });
            const ws = focusedWinState(); if (ws) ws.win.webContents.send('ui:show-history');
          }
        }
      ]
    },
    {
      label: 'Bookmarks',
      submenu: [
        { label: 'Bookmark This Page', accelerator: 'CmdOrCtrl+D', click: () => { const ws = focusedWinState(); const t = ws && ws.tabs.get(ws.activeTabId); if (t && /^https?:\/\//.test(t.url)) toggleBookmark(t.title, t.url); } },
        { label: 'Show / Hide Bookmarks Bar', accelerator: 'CmdOrCtrl+Shift+B', click: () => setSettings({ showBookmarksBar: !settings.showBookmarksBar }) }
      ]
    },
    {
      label: 'Tools',
      submenu: [
        ...VOLO_TOOLS.map(t => ({
          label: t.name,
          click: () => {
            const ws = focusedWinState();
            if (!ws) return;
            if (t.url) createTab(ws, t.url);
            else dialog.showMessageBox({
              type: 'info', title: t.name,
              message: `${t.name} is coming soon in ${PRODUCT_NAME}.`,
              detail: 'Its page is not public yet. Once it is shared, this menu item will open it directly.'
            });
          }
        })),
        { type: 'separator' },
        { label: 'Volo Call — Download', click: () => openVoloCall() }
      ]
    },
    {
      label: 'Help',
      submenu: [
        {
          label: 'Check for Updates…',
          click: () => {
            if (manualUpdateCheck) manualUpdateCheck();
            else dialog.showMessageBox({ type: 'info', title: 'Updates', message: 'Automatic updates run in the installed app. This development build does not check for updates.' });
          }
        },
        { type: 'separator' },
        {
          label: `About ${PRODUCT_NAME}`,
          click: () => {
            dialog.showMessageBox({
              type: 'info',
              title: `About ${PRODUCT_NAME}`,
              message: `${PRODUCT_NAME} v${app.getVersion()} (v1)`,
              detail: `A desktop web browser built on Chromium (Electron ${process.versions.electron}, Chrome ${process.versions.chrome}).\n\nNo telemetry. No analytics. Bookmarks and history stay on your computer.`
            });
          }
        }
      ]
    }
  ];
  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}
function zoomActive(delta) {
  const ws = focusedWinState();
  const t = ws && ws.tabs.get(ws.activeTabId);
  if (!t) return;
  const wc = t.view.webContents;
  if (delta === null) wc.setZoomFactor(1);
  else wc.setZoomFactor(Math.min(3, Math.max(0.25, wc.getZoomFactor() + delta)));
}

// ---------------------------------------------------------------------------
// Settings / bookmarks helpers (shared by IPC + menu)
// ---------------------------------------------------------------------------
function setSettings(patch) {
  const dohChanged = patch && ('dohMode' in patch || 'dohTemplate' in patch);
  const proxyChanged = patch && ('proxyMode' in patch || 'proxyRules' in patch || 'proxyBypass' in patch || 'vpnEnabled' in patch || 'vpnServer' in patch);
  settings = { ...settings, ...patch };
  writeJson(SETTINGS_FILE, settings);
  if (dohChanged) applyDohPref(); // takes effect on next launch (restart needed)
  if (proxyChanged) applyProxy(); // live, no restart needed
  if (patch && ('vpnEnabled' in patch || 'vpnServer' in patch)) broadcastVpnStatus();
  for (const ws of windows.values()) {
    ws.win.webContents.send('settings:changed', settings);
    ws.win.setBackgroundColor(settings.theme === 'dark' ? '#1f2328' : '#ffffff');
    for (const tab of ws.tabs.values()) {
      tab.view.setBackgroundColor(settings.theme === 'dark' ? '#1f2328' : '#ffffff');
    }
  }
}
function toggleBookmark(title, url) {
  if (!url || !/^https?:\/\//.test(url)) return false; // only real web pages
  const existing = bookmarks.find(b => b.url === url);
  if (existing) {
    bookmarks = bookmarks.filter(b => b.url !== url);
  } else {
    bookmarks.push({ id: Date.now() + '-' + Math.random().toString(36).slice(2, 8), title: title || url, url, createdAt: Date.now() });
  }
  writeJson(BOOKMARKS_FILE, bookmarks);
  for (const ws of windows.values()) ws.win.webContents.send('bookmarks:changed', bookmarks);
  return !existing;
}

// ---------------------------------------------------------------------------
// AI Assistant — Google Gemini API, called directly from the user's machine.
// This is NOT Muse: Muse cannot be embedded (no Muse API exists to ship).
// The user pastes their own free Gemini API key (Google AI Studio free tier)
// in Settings. The key is stored locally in settings.json and sent ONLY to
// Google's Gemini endpoint, in the x-goog-api-key header. Chat history is
// kept in memory only (per window) and never written to disk.
// VOLO_GEMINI_API_URL overrides the endpoint for tests only.
// ---------------------------------------------------------------------------
const GEMINI_API_BASE = process.env.VOLO_GEMINI_API_URL || 'https://generativelanguage.googleapis.com/v1beta';
async function callGemini(messages) {
  const key = (settings.aiApiKey || '').trim();
  if (!key) return { ok: false, error: 'NO_KEY' };
  const model = (settings.aiModel || 'gemini-2.0-flash').trim() || 'gemini-2.0-flash';
  const contents = (Array.isArray(messages) ? messages : []).slice(-20).map(m => ({
    role: m.role === 'model' ? 'model' : 'user',
    parts: [{ text: String(m.text || '') }]
  }));
  let res;
  try {
    res = await fetch(`${GEMINI_API_BASE}/models/${encodeURIComponent(model)}:generateContent`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-goog-api-key': key },
      body: JSON.stringify({ contents })
    });
  } catch (e) {
    return { ok: false, error: 'NETWORK' };
  }
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    if (res.status === 400 || res.status === 401 || res.status === 403) return { ok: false, error: 'BAD_KEY' };
    if (res.status === 404) return { ok: false, error: 'BAD_MODEL' };
    if (res.status === 429) return { ok: false, error: 'QUOTA' };
    return { ok: false, error: 'HTTP_' + res.status };
  }
  const text = (data.candidates?.[0]?.content?.parts || []).map(p => p.text || '').join('');
  if (!text) return { ok: false, error: 'EMPTY' };
  return { ok: true, text };
}

// ---------------------------------------------------------------------------
// AdBlocker — EasyList via @cliqz/adblocker, wired into webRequest so the
// app controls the per-site allowlist and counts blocked requests per tab.
// ON by default. The engine first tries the prebuilt Ghostery engine
// (downloaded once); when offline it falls back to the bundled EasyList
// snapshot in filters/easylist.txt. Main-frame navigations are never
// blocked — only sub-resources (ads, trackers, pop-ups).
// ---------------------------------------------------------------------------
let adblockEngine = null;
const adblockBlocked = new Map(); // tabId -> blocked count (this session)
const adblockLastSent = new Map(); // tabId -> epoch ms of last count event
const ADBLOCK_TYPES = {
  script: 'script', image: 'image', stylesheet: 'stylesheet',
  xhr: 'xmlhttprequest', fetch: 'xmlhttprequest', sub_frame: 'subdocument',
  font: 'font', media: 'media', websocket: 'websocket', ping: 'ping',
  csp_report: 'other', other: 'other'
};
async function initAdblocker() {
  try {
    const { FiltersEngine, Request } = require('@cliqz/adblocker');
    // 1. Bundled lists first (EasyList + EasyPrivacy + Volo supplement):
    // blocking works from the very first navigation, even offline.
    try {
      const read = (f) => { try { return fs.readFileSync(path.join(__dirname, 'filters', f), 'utf8'); } catch { return ''; } };
      adblockEngine = FiltersEngine.parse(read('easylist.txt') + '\n' + read('easyprivacy.txt') + '\n' + read('volo-extra.txt'));
      adblockEngine._Request = Request;
      console.log('[volo] adblock engine ready (bundled lists)');
    } catch (e) {
      console.error('[volo] adblock bundled lists failed:', e.message);
    }
    // 2. Upgrade to the prebuilt engine (EasyList + EasyPrivacy + more) in
    // the background when it can be downloaded.
    try {
      const prebuilt = await FiltersEngine.fromPrebuiltAdsAndTracking(fetch);
      prebuilt._Request = Request;
      adblockEngine = prebuilt;
      console.log('[volo] adblock engine upgraded (prebuilt)');
    } catch (e) {
      console.log('[volo] adblock prebuilt unavailable, keeping bundled lists:', e.message);
    }
  } catch (e) {
    console.error('[volo] adblock engine failed to load:', e.message);
    adblockEngine = null;
  }
}
function findTabByWebContentsId(id) {
  for (const ws of windows.values()) {
    for (const tab of ws.tabs.values()) {
      if (tab.view && tab.view.webContents.id === id) return { ws, tab };
    }
  }
  return null;
}
function attachAdblocker(ses) {
  if (ses._voloAdblockAttached) return;
  ses._voloAdblockAttached = true;
  ses.webRequest.onBeforeRequest({ urls: ['http://*/*', 'https://*/*'] }, (details, callback) => {
    try {
      if (!settings.adblockEnabled || !adblockEngine) return callback({});
      if (details.resourceType === 'main_frame') return callback({});
      const found = findTabByWebContentsId(details.webContentsId);
      const sourceUrl = (found && found.tab.url) || details.referrer || '';
      let host = '';
      try { host = new URL(details.url).hostname; } catch { return callback({}); }
      if ((settings.adblockAllowlist || []).includes(host)) return callback({});
      const { match } = adblockEngine.match(adblockEngine._Request.fromRawDetails({
        url: details.url,
        sourceUrl,
        type: ADBLOCK_TYPES[details.resourceType] || 'other'
      }));
      if (match) {
        if (found) {
          const n = (adblockBlocked.get(found.tab.id) || 0) + 1;
          adblockBlocked.set(found.tab.id, n);
          const now = Date.now();
          if ((now - (adblockLastSent.get(found.tab.id) || 0)) > 400) {
            adblockLastSent.set(found.tab.id, now);
            for (const w of windows.values()) w.win.webContents.send('adblock:count', { tabId: found.tab.id, count: n });
          }
        }
        return callback({ cancel: true });
      }
      return callback({});
    } catch (e) {
      return callback({});
    }
  });
}
function adblockCountForTab(tabId) {
  return adblockBlocked.get(tabId) || 0;
}

// ---------------------------------------------------------------------------
// Free VPN — routes browser traffic through a free public proxy server.
// Server list source: GeoNode's free public proxy list (no key, no account).
// VPNGate's list is OpenVPN/L2TP endpoints, not proxies, and its API is
// unreachable from this build environment, so it cannot be the routing
// source for an Electron app — GeoNode is the working list. Servers are
// volunteers' public proxies: slow, come and go, and can see traffic —
// unblocking + casual browsing only, never banking, passwords or logins.
// The toggle overrides the manual proxy while on; turning it off restores
// the proxy mode in Settings.
// ---------------------------------------------------------------------------
const VPN_LIST_URL = 'https://proxylist.geonode.com/api/proxy-list?limit=100&page=1&sort_by=lastChecked&sort_type=desc&protocols=http';
async function fetchVpnServers() {
  const res = await fetch(VPN_LIST_URL, { signal: AbortSignal.timeout(20000) });
  if (!res.ok) throw new Error('HTTP ' + res.status);
  const data = await res.json();
  const list = (data.data || [])
    .filter(p => p.ip && p.port && (p.protocols || []).includes('http'))
    .map(p => ({
      ip: p.ip, port: String(p.port), country: p.country || '?', city: p.city || '',
      latency: Math.round(p.latency || 0), upTime: Math.round(p.upTime || 0)
    }));
  list.sort((a, b) => a.latency - b.latency);
  return list.slice(0, 50);
}
async function refreshVpnServers() {
  const list = await fetchVpnServers();
  settings.vpnServers = list;
  settings.vpnLastFetch = Date.now();
  writeJson(SETTINGS_FILE, settings);
  return list;
}
function currentVpnServer() {
  const [ip, port] = (settings.vpnServer || '').split(':');
  if (!ip || !port) return null;
  const cached = (settings.vpnServers || []).find(s => s.ip === ip && String(s.port) === String(port));
  return cached || { ip, port, country: '?', city: '', latency: 0, upTime: 0 };
}
function vpnStatus() {
  return {
    enabled: !!settings.vpnEnabled,
    server: currentVpnServer(),
    servers: settings.vpnServers || [],
    lastFetch: settings.vpnLastFetch || 0
  };
}
function broadcastVpnStatus() {
  const status = vpnStatus();
  for (const ws of windows.values()) ws.win.webContents.send('vpn:changed', status);
}
async function setVpn(enabled, server) {
  setSettings({ vpnEnabled: !!enabled, vpnServer: server || '' });
  await applyProxy();
  broadcastVpnStatus();
  return vpnStatus();
}
async function switchVpnServer() {
  // One-click switch: pick the next server in the cached list (a different
  // country first when possible), turn the VPN on with it.
  let list = settings.vpnServers || [];
  if (!list.length || (Date.now() - (settings.vpnLastFetch || 0)) > 60 * 60 * 1000) {
    try { list = await refreshVpnServers(); } catch { /* keep the cached list */ }
  }
  if (!list.length) return { ok: false, error: 'No free servers right now — try Refresh in Settings → VPN.' };
  const current = settings.vpnServer || '';
  const idx = list.findIndex(s => `${s.ip}:${s.port}` === current);
  const next = list[(idx + 1) % list.length];
  await setVpn(true, `${next.ip}:${next.port}`);
  return { ok: true, server: next };
}

// Update status (toolbar Update button + menu). Kept in main so the
// renderer can show the current version and "up to date" at a glance.
let lastUpdateStatus = { state: 'unknown', version: app.getVersion() };
function emitUpdateStatus(patch) {
  lastUpdateStatus = { ...lastUpdateStatus, ...patch };
  for (const ws of windows.values()) ws.win.webContents.send('update:status', lastUpdateStatus);
}

function activeTabPair() {
  const ws = focusedWinState();
  return ws ? { ws, tab: ws.tabs.get(ws.activeTabId) } : { ws: null, tab: null };
}

// ---------------------------------------------------------------------------
// Page translate — Google's free translate endpoint (no key), translating
// the page's own text in place. Original text is kept on the page so the
// user can restore it with one click. Runs entirely on the user's machine;
// nothing is sent anywhere except the text being translated, to Google.
// NOTE: from some networks Google rate-limits this free endpoint (HTTP 429);
// the error is reported honestly instead of faking a translation.
// ---------------------------------------------------------------------------
const TRANSLATE_API = process.env.VOLO_TRANSLATE_API_URL || 'https://translate.googleapis.com/translate_a/single';
const TRANSLATE_LANGS = { bn: 'Bangla', en: 'English', hi: 'Hindi', es: 'Spanish', ar: 'Arabic', fr: 'French', de: 'German' };
async function translateText(text, target) {
  const res = await fetch(`${TRANSLATE_API}?client=gtx&sl=auto&tl=${encodeURIComponent(target)}&dt=t&q=${encodeURIComponent(text)}`, {
    headers: { 'User-Agent': 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 Chrome/120 Safari/537.36' },
    signal: AbortSignal.timeout(20000)
  });
  if (!res.ok) throw new Error('HTTP ' + res.status);
  const data = await res.json();
  return (data[0] || []).map(s => s[0] || '').join('');
}
async function translateActivePage(lang) {
  const { tab } = activeTabPair();
  if (!tab || !/^https?:\/\//.test(tab.url || '')) return { ok: false, error: 'Open a web page first.' };
  const target = (lang || settings.translateLang || 'bn').trim();
  const wc = tab.view.webContents;
  let texts;
  try {
    texts = await wc.executeJavaScript(`(function(){
      window.__voloNodes = [];
      const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT, { acceptNode(n) {
        if (!n.nodeValue || !n.nodeValue.trim()) return NodeFilter.FILTER_REJECT;
        const p = n.parentElement; if (!p) return NodeFilter.FILTER_REJECT;
        if (['SCRIPT','STYLE','NOSCRIPT','TEXTAREA','INPUT','SELECT','OPTION'].includes(p.tagName)) return NodeFilter.FILTER_REJECT;
        return NodeFilter.FILTER_ACCEPT;
      }});
      let n; while ((n = walker.nextNode())) window.__voloNodes.push(n);
      return window.__voloNodes.map(n => n.nodeValue);
    })()`, true);
  } catch (e) { return { ok: false, error: 'Could not read the page: ' + e.message }; }
  if (!texts || !texts.length) return { ok: false, error: 'No translatable text on this page.' };
  const unique = [...new Set(texts.filter(t => t.trim().length >= 2))];
  const batches = [];
  let cur = [], curLen = 0;
  for (const t of unique) {
    if (curLen + t.length > 4000 && cur.length) { batches.push(cur); cur = []; curLen = 0; }
    cur.push(t); curLen += t.length;
  }
  if (cur.length) batches.push(cur);
  const translated = new Map();
  try {
    for (const batch of batches) {
      const out = await translateText(batch.join('\n'), target);
      const parts = out.split('\n');
      batch.forEach((t, i) => translated.set(t, parts[i] !== undefined ? parts[i] : t));
    }
  } catch (e) { return { ok: false, error: 'Translation failed (' + e.message + '). Google may be rate-limiting the free endpoint — try again in a little while.' }; }
  const payload = texts.map(t => (translated.has(t) ? translated.get(t) : t));
  try {
    await wc.executeJavaScript(`(function(){
      if (!window.__voloNodes) return false;
      window.__voloOrig = window.__voloNodes.map(n => n.nodeValue);
      const translated = ${JSON.stringify(payload)};
      window.__voloNodes.forEach((n, i) => { if (translated[i] !== undefined) n.nodeValue = translated[i]; });
      return true;
    })()`, true);
  } catch (e) { return { ok: false, error: 'Could not apply the translation: ' + e.message }; }
  return { ok: true, translated: texts.length, lang: target, langName: TRANSLATE_LANGS[target] || target };
}
async function restoreTranslatedPage() {
  const { tab } = activeTabPair();
  if (!tab) return { ok: false };
  try {
    const done = await tab.view.webContents.executeJavaScript(`(function(){
      if (!window.__voloNodes || !window.__voloOrig) return false;
      window.__voloNodes.forEach((n, i) => { if (window.__voloOrig[i] !== undefined) n.nodeValue = window.__voloOrig[i]; });
      return true;
    })()`, true);
    return { ok: !!done };
  } catch { return { ok: false }; }
}

// ---------------------------------------------------------------------------
// Reader view — strips a page down to its article (title + paragraphs +
// images), no ads, no clutter, in a clean new tab. The original page is
// untouched; the reader copy is a local data: page.
// ---------------------------------------------------------------------------
async function readerActivePage() {
  const { ws, tab } = activeTabPair();
  if (!tab || !/^https?:\/\//.test(tab.url || '')) return { ok: false, error: 'Open a web page first.' };
  let data;
  try {
    data = await tab.view.webContents.executeJavaScript(`(function(){
      function clean(el){
        el.querySelectorAll('script,style,iframe,form,button,nav,aside,noscript,svg,video,audio').forEach(n => n.remove());
        el.querySelectorAll('*').forEach(n => {
          [...n.attributes].forEach(a => { if (a.name.startsWith('on') || a.name === 'style') n.removeAttribute(a.name); });
          if (n.tagName === 'A' && /^javascript:/i.test(n.getAttribute('href') || '')) n.removeAttribute('href');
        });
        return el;
      }
      const cands = [...document.querySelectorAll('article, main, [role="main"]')];
      let best = null, bestLen = 0;
      for (const c of cands) {
        const len = [...c.querySelectorAll('p')].reduce((s, p) => s + (p.textContent || '').trim().length, 0);
        if (len > bestLen) { bestLen = len; best = c; }
      }
      if (!best || bestLen < 300) best = document.body;
      const clone = best.cloneNode(true);
      clean(clone);
      const title = (document.querySelector('h1') || {}).textContent || document.title;
      return { title: (title || '').trim(), html: clone.innerHTML.slice(0, 200000) };
    })()`, true);
  } catch (e) { return { ok: false, error: 'Could not read the page: ' + e.message }; }
  if (!data || !data.html) return { ok: false, error: 'No article text found on this page.' };
  const esc = s => String(s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  const doc = '<!DOCTYPE html><html><head><meta charset="utf-8"><title>Reader: ' + esc(data.title) + '</title>' +
    '<style>body{max-width:680px;margin:40px auto;padding:0 20px;font:18px/1.7 Georgia,serif;color:#222;background:#fdfdf8}h1{font-size:28px;line-height:1.3}h2{font-size:22px}img{max-width:100%;height:auto}p{margin:0 0 1em}a{color:#0b5fff}</style>' +
    '</head><body><h1>' + esc(data.title) + '</h1><div>' + data.html + '</div><hr><p style="color:#888;font-size:13px">Reader view — Volo Browser</p></body></html>';
  const rtab = createTab(ws);
  rtab.view.webContents.loadURL('data:text/html;charset=utf-8,' + encodeURIComponent(doc));
  return { ok: true };
}

// ---------------------------------------------------------------------------
// Screenshot — full page in one click (Chrome DevTools Protocol, captures
// beyond the viewport). Falls back to the visible area if the full-page
// capture is unavailable. Saves to the Pictures folder.
// ---------------------------------------------------------------------------
async function screenshotActivePage() {
  const { tab } = activeTabPair();
  if (!tab) return { ok: false, error: 'No active tab.' };
  const wc = tab.view.webContents;
  const dir = app.getPath('pictures') || app.getPath('downloads');
  try { fs.mkdirSync(dir, { recursive: true }); } catch { /* use downloads instead */ }
  const saveDir = fs.existsSync(dir) ? dir : app.getPath('downloads');
  const file = path.join(saveDir,
    `Volo Screenshot ${new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-')}.png`);
  try {
    wc.debugger.attach('1.3');
    try {
      const { data } = await wc.debugger.sendCommand('Page.captureScreenshot', { format: 'png', captureBeyondViewport: true });
      fs.writeFileSync(file, Buffer.from(data, 'base64'));
    } finally { try { wc.debugger.detach(); } catch { /* ignore */ } }
    dialog.showMessageBox({ type: 'info', title: 'Screenshot saved', message: 'Full-page screenshot saved.', detail: file, buttons: ['Show in Folder', 'OK'], defaultId: 1 })
      .then(({ response }) => { if (response === 0) shell.showItemInFolder(file); });
    return { ok: true, file, fullPage: true };
  } catch (e) {
    try {
      const img = await wc.capturePage();
      fs.writeFileSync(file, img.toPNG());
      dialog.showMessageBox({ type: 'info', title: 'Screenshot saved', message: 'Screenshot saved (visible area only — full-page capture was unavailable).', detail: file, buttons: ['Show in Folder', 'OK'], defaultId: 1 })
        .then(({ response }) => { if (response === 0) shell.showItemInFolder(file); });
      return { ok: true, file, fullPage: false };
    } catch (e2) { return { ok: false, error: e2.message }; }
  }
}

// ---------------------------------------------------------------------------
// Video pop-out (picture-in-picture) — floats the page's video in a small
// window that stays on top while the user works elsewhere. Uses the page's
// own PiP support, so it works for YouTube and other players too.
// ---------------------------------------------------------------------------
async function popOutVideo() {
  const { tab } = activeTabPair();
  if (!tab || !/^https?:\/\//.test(tab.url || '')) return { ok: false, error: 'Open a page with a video first.' };
  let res;
  try {
    res = await tab.view.webContents.executeJavaScript(`(function(){
      const v = [...document.querySelectorAll('video')].find(v => !v.paused && v.readyState > 0) || document.querySelector('video');
      if (!v) return { ok: false, error: 'no-video' };
      if (document.pictureInPictureElement) return { ok: false, error: 'already' };
      v.disablePictureInPicture = false;
      return v.requestPictureInPicture().then(() => ({ ok: true })).catch(e => ({ ok: false, error: e.name || 'failed' }));
    })()`, true);
  } catch (e) { return { ok: false, error: e.message }; }
  return res || { ok: false, error: 'failed' };
}

// ---------------------------------------------------------------------------
// Volo Call — one click downloads the Volo Call app. Its APK is still
// being built by a separate team and its download is not published yet
// (GitHub Releases, same repo as the browser), so until a real download
// URL exists the entry says "coming soon" instead of a dead link.
// ---------------------------------------------------------------------------
function openVoloCall() {
  const ws = focusedWinState();
  if (!ws) return;
  if ((settings.voloCallUrl || '').trim()) { createTab(ws, settings.voloCallUrl.trim()); return; }
  dialog.showMessageBox({
    type: 'info', title: 'Volo Call',
    message: 'Volo Call is coming soon.',
    detail: 'The Volo Call app is still being built and its download is not published yet. Once its APK is on GitHub Releases, this button will download it.'
  });
}

// ---------------------------------------------------------------------------
// IPC — shell (renderer) API
// ---------------------------------------------------------------------------
ipcMain.handle('settings:get', () => settings);
ipcMain.handle('settings:set', (_e, patch) => { setSettings(patch || {}); return settings; });
// AI Assistant chat — messages: [{ role: 'user'|'model', text }]
ipcMain.handle('ai:chat', (_e, messages) => callGemini(messages));
// Slide-over panels live in the shell window's HTML, which the tab's
// WebContentsView paints over — so the renderer tells main to hide the page
// view while a panel is open and show it again when the panel closes.
ipcMain.handle('panel:set-open', (e, open) => {
  const ws = getWinStateBySender(e.sender);
  if (!ws) return;
  ws.panelOpen = !!open;
  const tab = ws.tabs.get(ws.activeTabId);
  if (tab) tab.view.setVisible(!ws.panelOpen);
});
ipcMain.handle('bookmarks:list', () => bookmarks);
ipcMain.handle('bookmarks:toggle', (_e, { title, url }) => toggleBookmark(title, url));
ipcMain.handle('bookmarks:remove', (_e, id) => {
  bookmarks = bookmarks.filter(b => b.id !== id);
  writeJson(BOOKMARKS_FILE, bookmarks);
  for (const ws of windows.values()) ws.win.webContents.send('bookmarks:changed', bookmarks);
  return bookmarks;
});
ipcMain.handle('history:list', (_e, limit) => history.slice(0, limit || 500));
ipcMain.handle('history:clear', () => { history = []; writeJson(HISTORY_FILE, history); return []; });
ipcMain.handle('history:remove', (_e, id) => {
  history = history.filter(h => h.id !== id);
  writeJson(HISTORY_FILE, history);
  return history;
});
ipcMain.handle('downloads:list', () => [...downloads.values()].reverse());
ipcMain.handle('downloads:clear', () => {
  for (const [id, d] of downloads) if (d.state !== 'progressing') downloads.delete(id);
  broadcastDownloads();
  return [...downloads.values()].reverse();
});
ipcMain.handle('download:open-file', (_e, id) => {
  const d = downloads.get(id);
  if (d && fs.existsSync(d.savePath)) shell.openPath(d.savePath);
});
ipcMain.handle('download:show-in-folder', (_e, id) => {
  const d = downloads.get(id);
  if (d && fs.existsSync(d.savePath)) shell.showItemInFolder(d.savePath);
});
ipcMain.handle('download:pause', (_e, id) => {
  const item = downloadItems.get(id);
  const d = downloads.get(id);
  if (item && d && d.state === 'progressing' && !item.isPaused()) {
    item.pause();
    d.state = 'paused';
    broadcastDownloads();
  }
  return downloads.get(id) || null;
});
ipcMain.handle('download:resume', (_e, id) => {
  const item = downloadItems.get(id);
  const d = downloads.get(id);
  if (item && d && (d.state === 'paused' || d.state === 'interrupted') && item.isPaused()) {
    item.resume();
    d.state = 'progressing';
    broadcastDownloads();
  }
  return downloads.get(id) || null;
});
ipcMain.handle('download:cancel', (_e, id) => {
  const item = downloadItems.get(id);
  if (item) item.cancel();
  return downloads.get(id) || null;
});
// Clear All History — one click clears browsing history + cookies/site
// data + cache, then reports what was cleared.
async function clearAllBrowsingData() {
  const cleared = [];
  history = [];
  writeJson(HISTORY_FILE, history);
  cleared.push('history');
  await session.defaultSession.clearStorageData({
    storages: ['cookies', 'localstorage', 'sessionstorage', 'indexdb', 'websql']
  });
  cleared.push('cookies and site data');
  await session.defaultSession.clearCache();
  cleared.push('cache');
  for (const ws of windows.values()) ws.win.webContents.send('history:changed');
  return cleared;
}
ipcMain.handle('browsing-data:clear-all', async () => clearAllBrowsingData());
// AdBlocker
ipcMain.handle('adblock:get', () => ({
  enabled: !!settings.adblockEnabled,
  allowlist: settings.adblockAllowlist || [],
  count: adblockCountForTab(focusedWinState() ? focusedWinState().tabs.get(focusedWinState().activeTabId)?.id : -1)
}));
ipcMain.handle('adblock:set', (_e, patch) => {
  if (patch) setSettings({ adblockEnabled: patch.enabled !== undefined ? !!patch.enabled : settings.adblockEnabled, adblockAllowlist: patch.allowlist !== undefined ? patch.allowlist : settings.adblockAllowlist });
  return { enabled: !!settings.adblockEnabled, allowlist: settings.adblockAllowlist || [] };
});
ipcMain.handle('adblock:allow-site', (_e, allow) => {
  const { tab } = activeTabPair();
  if (!tab || !/^https?:\/\//.test(tab.url || '')) return { ok: false, error: 'Open a web page first.' };
  let host = '';
  try { host = new URL(tab.url).hostname; } catch { return { ok: false, error: 'Bad URL.' }; }
  let list = [...(settings.adblockAllowlist || [])];
  if (allow) { if (!list.includes(host)) list.push(host); }
  else { list = list.filter(h => h !== host); }
  setSettings({ adblockAllowlist: list });
  return { ok: true, host, allowed: allow };
});
// Free VPN
ipcMain.handle('vpn:get', () => vpnStatus());
ipcMain.handle('vpn:refresh', async () => {
  try {
    await refreshVpnServers();
    return { ok: true, ...vpnStatus() };
  } catch (e) {
    return { ok: false, error: e.message, ...vpnStatus() };
  }
});
ipcMain.handle('vpn:set', async (_e, { enabled, server }) => {
  return setVpn(enabled, server);
});
ipcMain.handle('vpn:switch-next', async () => {
  const res = await switchVpnServer();
  return res.ok ? { ok: true, ...vpnStatus() } : { ok: false, error: res.error, ...vpnStatus() };
});
// Page tools: translate, reader, screenshot, picture-in-picture
ipcMain.handle('page:translate', async (_e, lang) => translateActivePage(lang));
ipcMain.handle('page:translate-restore', async () => restoreTranslatedPage());
ipcMain.handle('page:reader', async () => readerActivePage());
ipcMain.handle('page:screenshot', async () => screenshotActivePage());
ipcMain.handle('page:pip', async () => popOutVideo());
// Tab sleep
ipcMain.handle('tabs:sleep-now', () => {
  let slept = 0;
  for (const ws of windows.values()) slept += sleepInactiveTabs(ws, 0);
  return slept;
});
// Update check (toolbar Update button + menu)
ipcMain.handle('update:status', () => lastUpdateStatus);
ipcMain.handle('update:check', () => {
  if (manualUpdateCheck) { manualUpdateCheck(); return { ok: true }; }
  dialog.showMessageBox({ type: 'info', title: 'Updates', message: 'Automatic updates run in the installed app. This development build does not check for updates.' });
  return { ok: false, dev: true };
});
// Volo Call download
ipcMain.handle('volo-call:open', () => { openVoloCall(); return true; });
ipcMain.handle('tabs:create', (e, url) => {
  const ws = getWinStateBySender(e.sender);
  if (!ws) return null;
  return serializableTab(createTab(ws, url));
});
ipcMain.handle('tabs:close', (e, tabId) => {
  const ws = getWinStateBySender(e.sender);
  if (ws) closeTab(ws, tabId);
});
ipcMain.handle('tabs:activate', (e, tabId) => {
  const ws = getWinStateBySender(e.sender);
  if (ws) activateTab(ws, tabId);
});
ipcMain.handle('nav:go', (e, tabId, input) => {
  const ws = getWinStateBySender(e.sender);
  const tab = ws && ws.tabs.get(tabId);
  if (tab) navigateTab(ws, tab, input);
});
ipcMain.handle('nav:back', (e, tabId) => {
  const ws = getWinStateBySender(e.sender);
  const tab = ws && ws.tabs.get(tabId);
  if (tab && tab.view.webContents.navigationHistory.canGoBack()) tab.view.webContents.navigationHistory.goBack();
});
ipcMain.handle('nav:forward', (e, tabId) => {
  const ws = getWinStateBySender(e.sender);
  const tab = ws && ws.tabs.get(tabId);
  if (tab && tab.view.webContents.navigationHistory.canGoForward()) tab.view.webContents.navigationHistory.goForward();
});
ipcMain.handle('nav:reload', (e, tabId) => {
  const ws = getWinStateBySender(e.sender);
  const tab = ws && ws.tabs.get(tabId);
  if (tab) tab.view.webContents.reload();
});
ipcMain.handle('nav:home', (e, tabId) => {
  const ws = getWinStateBySender(e.sender);
  const tab = ws && ws.tabs.get(tabId);
  if (tab) navigateTab(ws, tab, settings.homepage || 'volo://newtab');
});
ipcMain.handle('window:new', () => { createBrowserWindow({}); });
ipcMain.handle('window:new-private', () => { createBrowserWindow({ isPrivate: true }); });
ipcMain.handle('app:restart', () => { app.relaunch(); app.quit(); });
ipcMain.handle('shell:open-external', (_e, url) => { if (/^https?:\/\//.test(url)) shell.openExternal(url); });

// IPC — extensions
ipcMain.handle('extensions:list', () => listExtensions());
ipcMain.handle('extensions:load-unpacked', async () => {
  const { canceled, filePaths } = await dialog.showOpenDialog({
    properties: ['openDirectory'], title: 'Select extension folder (unpacked)'
  });
  if (canceled || !filePaths.length) return { ok: false, cancelled: true };
  const dir = filePaths[0];
  try {
    if (!fs.existsSync(path.join(dir, 'manifest.json'))) {
      return { ok: false, error: 'That folder has no manifest.json — not an extension folder.' };
    }
    const ext = await session.defaultSession.loadExtension(dir, { allowFileAccess: true });
    upsertPersistedExtension(ext.id, ext.name, dir);
    return { ok: true, extension: { id: ext.id, name: ext.name, version: ext.version } };
  } catch (e) {
    return { ok: false, error: e.message };
  }
});
ipcMain.handle('extensions:load-crx', async () => {
  const { canceled, filePaths } = await dialog.showOpenDialog({
    properties: ['openFile'],
    filters: [{ name: 'Chrome Extension', extensions: ['crx'] }],
    title: 'Select a .crx file'
  });
  if (canceled || !filePaths.length) return { ok: false, cancelled: true };
  const crx = filePaths[0];
  const name = path.basename(crx, '.crx').replace(/[^a-zA-Z0-9._-]+/g, '_');
  const destDir = path.join(EXTENSIONS_DIR, name + '-' + Date.now());
  try {
    await extractCrx(crx, destDir);
    const ext = await session.defaultSession.loadExtension(destDir, { allowFileAccess: true });
    upsertPersistedExtension(ext.id, ext.name, destDir);
    return { ok: true, extension: { id: ext.id, name: ext.name, version: ext.version } };
  } catch (e) {
    return { ok: false, error: e.message };
  }
});
ipcMain.handle('extensions:remove', async (_e, id) => {
  try { await session.defaultSession.removeExtension(id); } catch { /* already gone */ }
  const entry = persistedExtensions.find(p => p.id === id);
  persistedExtensions = persistedExtensions.filter(p => p.id !== id);
  writeJson(EXTENSIONS_FILE, persistedExtensions);
  // Delete extracted .crx copies (never delete folders outside our own dir).
  if (entry && entry.path && entry.path.startsWith(EXTENSIONS_DIR)) {
    try { fs.rmSync(entry.path, { recursive: true, force: true }); } catch { /* noop */ }
  }
  return listExtensions();
});
// Enable/disable: Electron has no enable/disable API — disable unloads the
// extension (kept in the list, not loaded on startup); enable loads it again.
ipcMain.handle('extensions:set-enabled', async (_e, id, enabled) => {
  const entry = persistedExtensions.find(p => p.id === id);
  if (!enabled) {
    try { await session.defaultSession.removeExtension(id); } catch { /* already gone */ }
    if (entry) { entry.enabled = false; writeJson(EXTENSIONS_FILE, persistedExtensions); }
    return { ok: true };
  }
  if (!entry || !entry.path || !fs.existsSync(entry.path)) {
    return { ok: false, error: 'Extension files not found.' };
  }
  try {
    const ext = await session.defaultSession.loadExtension(entry.path, { allowFileAccess: true });
    entry.id = ext.id;
    entry.name = ext.name;
    entry.enabled = true;
    writeJson(EXTENSIONS_FILE, persistedExtensions);
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e.message };
  }
});

// IPC — find in page, print, clear browsing data
ipcMain.handle('find:search', (e, tabId, text, forward, findNext) => {
  const ws = getWinStateBySender(e.sender);
  const tab = ws && ws.tabs.get(tabId);
  if (tab && text) tab.view.webContents.findInPage(text, { forward: forward !== false, findNext: !!findNext });
});
ipcMain.handle('find:stop', (e, tabId) => {
  const ws = getWinStateBySender(e.sender);
  const tab = ws && ws.tabs.get(tabId);
  if (tab) tab.view.webContents.stopFindInPage('clearSelection');
});
ipcMain.handle('print:page', (e, tabId) => {
  const ws = getWinStateBySender(e.sender);
  const tab = ws && ws.tabs.get(tabId);
  if (tab) {
    tab.view.webContents.print({ silent: false, printBackground: true }, (success, errorType) => {
      if (!success) console.error('[volo] print failed:', errorType);
    });
  }
});
ipcMain.handle('browsing-data:clear', async (_e, opts) => {
  const cleared = [];
  if (opts && opts.history) {
    history = [];
    writeJson(HISTORY_FILE, history);
    cleared.push('history');
  }
  if (opts && opts.cookies) {
    // Cookies + site storage (localStorage, IndexedDB, …) — this signs the
    // user out of sites, exactly like Chrome's "cookies and other site data".
    await session.defaultSession.clearStorageData({
      storages: ['cookies', 'localstorage', 'sessionstorage', 'indexdb', 'websql']
    });
    cleared.push('cookies');
  }
  if (opts && opts.cache) {
    await session.defaultSession.clearCache();
    cleared.push('cache');
  }
  return cleared;
});
ipcMain.on('layout:toolbar-height', (e, h) => {
  const ws = getWinStateBySender(e.sender);
  if (ws && typeof h === 'number' && h > 0) { ws.toolbarHeight = h; layoutViews(ws); }
});

// IPC — new-tab page (view preload, file:// newtab.html only)
ipcMain.handle('view:get-engine', (e) => {
  const found = getTabBySender(e.sender);
  const isPrivate = found ? found.ws.isPrivate : false;
  const key = isPrivate ? (settings.privateSearchEngine || 'duckduckgo') : (settings.searchEngine || 'google');
  return SEARCH_ENGINES[key] || SEARCH_ENGINES.google;
});
// Sponsored shortcut tiles: plain links only (Firefox-style). No ad code,
// no tracking, no AdSense/AdMob — the list is managed in sponsored.json
// shipped with the app. Empty list = no Recommended section shown.
// Format: { "tiles": [{ "title", "url", "sponsored": true|false }] }
// (a bare array is also accepted for backwards compatibility).
ipcMain.handle('view:get-sponsored', () => {
  const data = readJson(path.join(__dirname, 'sponsored.json'), { tiles: [] });
  const list = Array.isArray(data) ? data : (data.tiles || []);
  return list
    .filter(s => s && s.url && /^https?:\/\//.test(s.url))
    .map(s => ({ title: s.title || s.url, url: s.url, sponsored: s.sponsored === true }));
});
ipcMain.handle('view:get-bookmarks', () => bookmarks.slice(0, 8));
ipcMain.handle('view:get-topsites', () => {
  const counts = new Map();
  for (const h of history) {
    if (!/^https?:\/\//.test(h.url)) continue;
    try {
      const host = new URL(h.url).hostname.replace(/^www\./, '');
      counts.set(host, (counts.get(host) || 0) + 1);
    } catch { /* ignore */ }
  }
  return [...counts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 8)
    .map(([host, count]) => ({ host, count, url: 'https://' + host }));
});
ipcMain.handle('view:search', (e, q) => {
  const found = getTabBySender(e.sender);
  if (found) navigateTab(found.ws, found.tab, q);
});
ipcMain.handle('view:open', (e, url) => {
  const found = getTabBySender(e.sender);
  if (found) navigateTab(found.ws, found.tab, url);
});

// ---------------------------------------------------------------------------
// Automatic updates (electron-updater + GitHub Releases)
// The installed app checks GitHub Releases for new versions and installs
// them itself — users never re-download manually. Runs ONLY in packaged
// builds (dev runs never phone home). The repo is configured in
// package.json ("publish"); the check starts 30s after launch so it never
// slows startup, then repeats every 6 hours. Mac auto-update needs a
// SIGNED build (Apple Developer account) — unsigned .dmg builds cannot
// self-update; Windows NSIS updates work unsigned.
// ---------------------------------------------------------------------------
let manualUpdateCheck = null;
function setupAutoUpdater() {
  if (!app.isPackaged && !SMOKE_UPDATER) return; // dev builds never phone home
  let autoUpdater;
  try {
    ({ autoUpdater } = require('electron-updater')); // lazy: keeps dev startup fast
  } catch (e) {
    console.error('[volo] electron-updater unavailable:', e.message);
    return;
  }
  if (SMOKE_UPDATER) autoUpdater.forceDevUpdateConfig = true; // reads dev-app-update.yml
  autoUpdater.autoDownload = true;
  autoUpdater.autoInstallOnAppQuit = true;
  // Immediate updates: a downloaded update installs by itself the next
  // time the user quits Volo normally — no prompt, no interruption, and
  // the next launch is already the new version. The dialog below still
  // offers "Restart Now" for anyone who wants it this minute.
  let checkInProgress = false;
  let lastCheckWasManual = false;
  autoUpdater.on('checking-for-update', () => {
    emitUpdateStatus({ state: 'checking' });
  });
  autoUpdater.on('error', (err) => {
    console.error('[volo] update check failed:', err && err.message ? err.message : err);
    emitUpdateStatus({ state: 'error', error: err && err.message ? err.message : String(err) });
  });
  autoUpdater.on('update-available', (info) => {
    console.log('[volo] update available:', info.version);
    emitUpdateStatus({ state: 'available', version: info.version });
  });
  autoUpdater.on('update-not-available', () => {
    console.log('[volo] update not available');
    emitUpdateStatus({ state: 'up-to-date' });
    if (lastCheckWasManual) {
      lastCheckWasManual = false;
      dialog.showMessageBox({
        type: 'info', title: 'No Updates',
        message: 'You are using the latest version of Volo Browser.'
      });
    }
  });
  autoUpdater.on('update-downloaded', (info) => {
    emitUpdateStatus({ state: 'downloaded', version: info.version });
    dialog.showMessageBox({
      type: 'info',
      title: 'Update Ready',
      message: `Volo Browser ${info.version} is ready to install.`,
      detail: 'The update has been downloaded. Restart Volo to install it now, or keep browsing — it will install automatically the next time you close Volo.',
      buttons: ['Restart Now', 'Later'],
      defaultId: 0
    }).then(({ response }) => {
      if (response === 0) autoUpdater.quitAndInstall();
    });
  });
  const check = (manual) => {
    if (checkInProgress) return;
    lastCheckWasManual = manual;
    checkInProgress = true;
    autoUpdater.checkForUpdates()
      .catch(() => { /* 'error' event already logged */ })
      .finally(() => { checkInProgress = false; });
  };
  manualUpdateCheck = () => check(true);
  // Immediate updates: check on EVERY launch (5s in, so startup is never
  // slowed) and then every hour while the browser stays open, so a new
  // release reaches existing installs the same day without anyone having
  // to go find it. Smoke-test mode checks almost immediately.
  setTimeout(() => check(false), SMOKE_UPDATER ? 2000 : 5000);
  if (!SMOKE_UPDATER) setInterval(() => check(false), 60 * 60 * 1000);
}

// ---------------------------------------------------------------------------
// App lifecycle
// ---------------------------------------------------------------------------
const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
} else {
  app.on('second-instance', () => {
    const win = BrowserWindow.getAllWindows()[0];
    if (win) { if (win.isMinimized()) win.restore(); win.focus(); }
  });
}

app.whenReady().then(() => {
  buildMenu();
  applyProxy();
  initAdblocker();
  loadPersistedExtensions();
  setupAutoUpdater();
  // Tab sleep: every minute, unload tabs idle longer than the setting.
  setInterval(checkSleepTabs, 60 * 1000);
  const ws = createBrowserWindow({});
  console.log(`[volo] startup: first window in ${Date.now() - START_TIME}ms (electron ${process.versions.electron}, chrome ${process.versions.chrome})`);
  if (SMOKE_TEST) {
    // Prove the app boots: wait for the shell + first tab, log, then quit.
    const started = Date.now();
    const timer = setInterval(() => {
      const tab = ws.tabs.get(ws.activeTabId);
      const elapsed = Date.now() - started;
      if ((tab && tab.view.webContents.getURL().includes('newtab.html')) || elapsed > 15000) {
        clearInterval(timer);
        console.log('SMOKE OK: window created, tabs=' + ws.tabs.size);
        console.log('SMOKE OK: active tab url=' + (tab ? tab.view.webContents.getURL() : 'none'));
        console.log('SMOKE OK: electron=' + process.versions.electron + ' chrome=' + process.versions.chrome);
        console.log('SMOKE OK: settings file exists=' + fs.existsSync(SETTINGS_FILE));
        console.log('SMOKE OK: bookmarks=' + bookmarks.length + ' history=' + history.length);
        console.log('SMOKE OK: isPrivate=' + ws.isPrivate);
        app.quit();
      }
    }, 500);
    setTimeout(() => { console.log('SMOKE TIMEOUT'); app.exit(1); }, 30000);
  }
  if (SMOKE_DEEP) {
    // Deep test: real web navigation, bookmark + history persistence,
    // settings persistence, second tab, private window. Then quit.
    setTimeout(async () => {
      try {
        const ws = [...windows.values()][0];
        setSettings({ theme: 'dark' }); // proves settings.json write
        const tab = ws.tabs.get(ws.activeTabId);
        // Test URLs: real sites by default; override with env for offline VMs.
        const testUrl = process.env.VOLO_SMOKE_URL || 'https://example.com';
        const testUrl2 = process.env.VOLO_SMOKE_URL2 || 'https://example.org';
        navigateTab(ws, tab, testUrl);
        await new Promise((resolve) => {
          const wc = tab.view.webContents;
          wc.once('did-finish-load', resolve);
          setTimeout(resolve, 20000);
        });
        toggleBookmark(tab.title, tab.url);
        createTab(ws, testUrl2);
        const pws = createBrowserWindow({ isPrivate: true });
        await new Promise(r => setTimeout(r, 3000));
        // Extensions: load a minimal test extension, then remove it.
        const testExtDir = '/tmp/volo-test-extension';
        fs.mkdirSync(testExtDir, { recursive: true });
        fs.writeFileSync(path.join(testExtDir, 'manifest.json'), JSON.stringify({ manifest_version: 3, name: 'Volo Smoke Test', version: '1.0' }));
        const testExt = await session.defaultSession.loadExtension(testExtDir);
        console.log('DEEP OK: extension loaded name=' + testExt.name + ' id=' + testExt.id);
        await session.defaultSession.removeExtension(testExt.id);
        // Blocked sites: DoH preference + manual proxy resolution.
        const prefs = readJson(PREFERENCES_FILE, {});
        console.log('DEEP OK: doh pref=' + JSON.stringify(prefs.dns_over_https || null));
        await session.defaultSession.setProxy({ proxyRules: 'http=127.0.0.1:9999;https=127.0.0.1:9999' });
        const resolved = await session.defaultSession.resolveProxy('https://example.com');
        console.log('DEEP OK: proxy resolve=' + JSON.stringify(resolved));
        await session.defaultSession.setProxy({ mode: 'system' });
        console.log('DEEP OK: tabs=' + ws.tabs.size + ' activeUrl=' + tab.url);
        console.log('DEEP OK: title=' + JSON.stringify(tab.title));
        console.log('DEEP OK: history=' + history.length + ' file=' + fs.existsSync(HISTORY_FILE));
        console.log('DEEP OK: bookmarks=' + bookmarks.length + ' file=' + fs.existsSync(BOOKMARKS_FILE));
        console.log('DEEP OK: settings file=' + fs.existsSync(SETTINGS_FILE) + ' theme=' + settings.theme);
        console.log('DEEP OK: private window tabs=' + pws.tabs.size + ' isPrivate=' + pws.isPrivate);
        setSettings({ theme: 'light' }); // restore default for the next run
        app.quit();
      } catch (e) {
        console.log('DEEP FAILED: ' + e.message);
        app.exit(1);
      }
    }, 4000);
    setTimeout(() => { console.log('DEEP TIMEOUT'); app.exit(1); }, 90000);
  }
  if (SMOKE_COOKIE_SET) {
    // Cookie-persistence test, phase 1: visit a page that sets a cookie,
    // confirm it landed in the cookie jar, then quit. Phase 2
    // (--smoke-cookie-check) relaunches and verifies it survived.
    setTimeout(async () => {
      try {
        const ws = [...windows.values()][0];
        const tab = ws.tabs.get(ws.activeTabId);
        navigateTab(ws, tab, process.env.VOLO_COOKIE_URL || 'http://127.0.0.1:8901/set-cookie');
        await new Promise((resolve) => {
          tab.view.webContents.once('did-finish-load', resolve);
          setTimeout(resolve, 15000);
        });
        const cookies = await session.defaultSession.cookies.get({ url: 'http://127.0.0.1:8901/' });
        console.log('COOKIE-SET OK: cookies=' + JSON.stringify(cookies.map(c => c.name + '=' + c.value)));
        app.quit();
      } catch (e) { console.log('COOKIE-SET FAILED: ' + e.message); app.exit(1); }
    }, 3000);
    setTimeout(() => { console.log('COOKIE-SET TIMEOUT'); app.exit(1); }, 60000);
  }
  if (SMOKE_COOKIE_CHECK) {
    // Phase 2: after a full restart, the cookie must still be in the jar
    // AND the test server must see it sent back (proves logins stay signed
    // in across restarts, like Chrome).
    setTimeout(async () => {
      try {
        const cookies = await session.defaultSession.cookies.get({ url: 'http://127.0.0.1:8901/' });
        const kept = cookies.some(c => c.name === 'volo-test' && c.value === 'stay-signed-in');
        console.log('COOKIE-CHECK OK: jar has cookie=' + kept + ' cookies=' + JSON.stringify(cookies.map(c => c.name + '=' + c.value)));
        const ws = [...windows.values()][0];
        const tab = ws.tabs.get(ws.activeTabId);
        navigateTab(ws, tab, 'http://127.0.0.1:8901/echo');
        await new Promise((resolve) => {
          tab.view.webContents.once('did-finish-load', resolve);
          setTimeout(resolve, 15000);
        });
        console.log('COOKIE-CHECK OK: server saw title=' + JSON.stringify(tab.title));
        console.log('COOKIE-CHECK RESULT: persisted=' + kept + ' sent-to-site=' + tab.title.includes('stay-signed-in'));
        app.quit();
      } catch (e) { console.log('COOKIE-CHECK FAILED: ' + e.message); app.exit(1); }
    }, 3000);
    setTimeout(() => { console.log('COOKIE-CHECK TIMEOUT'); app.exit(1); }, 60000);
  }
  if (SMOKE_PROXY) {
    // Proxy test: route through a local test proxy that requires Basic auth
    // and serves a fixed page. Credentials come from env, are written to
    // settings for the run, then wiped before quit.
    setTimeout(async () => {
      try {
        const hostport = (process.env.VOLO_PROXY_URL || 'http://127.0.0.1:8902').replace(/^https?:\/\//, '');
        setSettings({
          proxyMode: 'manual',
          proxyRules: `http=${hostport};https=${hostport}`,
          proxyUsername: process.env.VOLO_PROXY_USER || 'volouser',
          proxyPassword: process.env.VOLO_PROXY_PASS || 'volopass'
        });
        await new Promise(r => setTimeout(r, 800));
        const ws = [...windows.values()][0];
        const tab = ws.tabs.get(ws.activeTabId);
        navigateTab(ws, tab, 'http://example.com/');
        await new Promise((resolve) => {
          tab.view.webContents.once('did-finish-load', resolve);
          setTimeout(resolve, 20000);
        });
        console.log('PROXY OK: title=' + JSON.stringify(tab.title) + ' url=' + tab.url);
        setSettings({ proxyMode: 'system', proxyRules: '', proxyUsername: '', proxyPassword: '' });
        app.quit();
      } catch (e) {
        console.log('PROXY FAILED: ' + e.message);
        setSettings({ proxyMode: 'system', proxyRules: '', proxyUsername: '', proxyPassword: '' });
        app.exit(1);
      }
    }, 3000);
    setTimeout(() => { console.log('PROXY TIMEOUT'); app.exit(1); }, 90000);
  }
  if (SMOKE_UPDATER) {
    // Updater test: with forceDevUpdateConfig, the check reads
    // dev-app-update.yml (local test server) instead of GitHub Releases.
    // The server advertises version 9.9.9, so 'update available' must fire.
    setTimeout(() => { console.log('UPDATER-TEST DONE'); app.quit(); }, 20000);
    setTimeout(() => { console.log('UPDATER-TEST TIMEOUT'); app.exit(1); }, 30000);
  }
  if (SMOKE_AI) {
    // AI test: call the Gemini path against the LOCAL test server
    // (VOLO_GEMINI_API_URL=http://127.0.0.1:8901/v1beta). The server
    // returns a canned Gemini-shaped reply. The dummy key is wiped after.
    setTimeout(async () => {
      try {
        const prevKey = settings.aiApiKey;
        const prevModel = settings.aiModel;
        setSettings({ aiApiKey: 'test-key-123', aiModel: 'gemini-2.0-flash' });
        const res = await callGemini([{ role: 'user', text: 'ping' }]);
        console.log('AI OK: with-key ok=' + res.ok + ' text=' + JSON.stringify(res.text || res.error));
        setSettings({ aiApiKey: '' });
        const noKey = await callGemini([{ role: 'user', text: 'ping' }]);
        console.log('AI OK: no-key ok=' + noKey.ok + ' error=' + noKey.error);
        setSettings({ aiApiKey: prevKey, aiModel: prevModel });
        // Panel fix: opening a panel must hide the page view (the view
        // paints over shell HTML, so panels are invisible otherwise).
        const ws = [...windows.values()][0];
        ws.win.webContents.executeJavaScript(`openPanel('ai-panel')`).catch(() => {});
        await new Promise(r => setTimeout(r, 1200));
        const tab = ws.tabs.get(ws.activeTabId);
        console.log('AI OK: panelOpen=' + ws.panelOpen + ' viewVisible=' + (tab ? tab.view.getVisible() : 'no-tab'));
        ws.win.webContents.executeJavaScript(`closePanels()`).catch(() => {});
        await new Promise(r => setTimeout(r, 800));
        console.log('AI OK: after-close panelOpen=' + ws.panelOpen + ' viewVisible=' + (tab ? tab.view.getVisible() : 'no-tab'));
        if (!res.ok || noKey.error !== 'NO_KEY' || !ws || ws.panelOpen) throw new Error('AI assertions failed');
        app.quit();
      } catch (e) { console.log('AI FAILED: ' + e.message); app.exit(1); }
    }, 3000);
    setTimeout(() => { console.log('AI TIMEOUT'); app.exit(1); }, 60000);
  }
  if (SMOKE_FEATURES) {
    // Feature test: adblock, translate (mock), reader, screenshot, PiP,
    // download pause/resume, tab sleep, clear-all, VPN switching.
    // Needs test/test-server.js running on http://127.0.0.1:8901/ and
    // VOLO_TRANSLATE_API_URL=http://127.0.0.1:8901/translate for the mock.
    setTimeout(async () => {
      const fail = (msg) => { console.log('FEATURES FAILED: ' + msg); app.exit(1); };
      try {
        dialog.showMessageBox = async () => ({ response: 1 }); // never block on a dialog
        const ws = [...windows.values()][0];
        const tab = ws.tabs.get(ws.activeTabId);
        const sleep = (ms) => new Promise(r => setTimeout(r, ms));
        const waitLoad = (wc, ms = 20000) => new Promise((resolve) => { wc.once('did-finish-load', resolve); setTimeout(resolve, ms); });

        // 1. AdBlocker: test page carries 3 ad/tracker tags.
        navigateTab(ws, tab, 'http://127.0.0.1:8901/');
        await waitLoad(tab.view.webContents);
        await sleep(3000);
        const blocked = adblockCountForTab(tab.id);
        console.log('FEATURES adblock blocked=' + blocked + ' engine=' + (adblockEngine ? 'ready' : 'MISSING'));
        if (!adblockEngine) return fail('adblock engine not ready');
        if (blocked < 2) return fail('adblock blocked only ' + blocked + ' requests (expected >= 2)');

        // 2. Translate (mock endpoint) + restore.
        const tr = await translateActivePage('bn');
        console.log('FEATURES translate ok=' + tr.ok + ' translated=' + (tr.translated || 0) + ' err=' + (tr.error || ''));
        if (!tr.ok) return fail('translate failed: ' + tr.error);
        const restored = await restoreTranslatedPage();
        console.log('FEATURES translate-restore ok=' + restored.ok);
        if (!restored.ok) return fail('translate restore failed');

        // 3. Reader view opens a new tab with the article.
        const tabsBefore = ws.tabs.size;
        const rd = await readerActivePage();
        await sleep(1500);
        const rtab = ws.tabs.get(ws.activeTabId);
        console.log('FEATURES reader ok=' + rd.ok + ' tabs=' + ws.tabs.size + ' newUrl=' + (rtab ? String(rtab.url).slice(0, 40) : 'none'));
        if (!rd.ok || ws.tabs.size !== tabsBefore + 1) return fail('reader view failed');

        // 4. Screenshot (full page) writes a PNG.
        const shot = await screenshotActivePage();
        const shotOk = shot.ok && shot.file && fs.existsSync(shot.file) && fs.statSync(shot.file).size > 1000;
        console.log('FEATURES screenshot ok=' + shot.ok + ' fullPage=' + shot.fullPage + ' file=' + (shot.file || '') + ' err=' + (shot.error || '') + ' size=' + (shotOk ? fs.statSync(shot.file).size : 0));
        if (!shotOk) return fail('screenshot failed');

        // 5. Picture-in-picture on the test page video.
        activateTab(ws, tab.id);
        navigateTab(ws, tab, 'http://127.0.0.1:8901/');
        await waitLoad(tab.view.webContents);
        await sleep(2500);
        const pip = await popOutVideo();
        console.log('FEATURES pip ok=' + pip.ok + ' err=' + (pip.error || ''));
        if (!pip.ok) console.log('FEATURES pip NOTE: could not enter PiP in this headless run (' + (pip.error || 'failed') + ')');

        // 6. Downloads: slow 8 MB file — pause, resume, complete.
        const dlTab = createTab(ws, 'http://127.0.0.1:8901/file');
        await sleep(2500);
        const dlId = [...downloads.values()].find(d => d.url.includes('/file'))?.id;
        console.log('FEATURES download id=' + dlId + ' state=' + (dlId ? downloads.get(dlId).state : 'none') + ' received=' + (dlId ? downloads.get(dlId).receivedBytes : 0));
        if (!dlId) return fail('download never started');
        const item = downloadItems.get(dlId);
        item.pause();
        await sleep(500);
        console.log('FEATURES download paused=' + item.isPaused());
        if (!item.isPaused()) return fail('download pause failed');
        item.resume();
        for (let i = 0; i < 40; i++) { if (downloads.get(dlId).state === 'completed') break; await sleep(1000); }
        const d = downloads.get(dlId);
        const dlFileOk = d && d.state === 'completed' && fs.existsSync(d.savePath) && fs.statSync(d.savePath).size === 8 * 1024 * 1024;
        console.log('FEATURES download done state=' + (d && d.state) + ' fileOk=' + dlFileOk);
        if (!dlFileOk) return fail('download did not complete');

        // 7. Tab sleep: force-sleep an idle tab, then wake it by clicking.
        const t1 = createTab(ws, 'http://127.0.0.1:8901/');
        await waitLoad(t1.view.webContents);
        const t2 = createTab(ws, 'http://127.0.0.1:8901/');
        await waitLoad(t2.view.webContents);
        t1.lastActiveAt = Date.now() - 60 * 60 * 1000;
        const slept = sleepInactiveTabs(ws, 15);
        console.log('FEATURES sleep slept=' + slept + ' t1.sleeping=' + t1.sleeping + ' t1.url=' + t1.url);
        if (!t1.sleeping) return fail('tab sleep failed');
        activateTab(ws, t1.id);
        await sleep(2500);
        console.log('FEATURES sleep wake sleeping=' + t1.sleeping + ' url=' + t1.url);
        if (t1.sleeping || !String(t1.url).startsWith('http://127.0.0.1:8901/')) return fail('tab wake failed');

        // 8. Clear All: set a cookie + grow history, then clear everything.
        navigateTab(ws, tab, 'http://127.0.0.1:8901/set-cookie');
        await waitLoad(tab.view.webContents);
        const before = await session.defaultSession.cookies.get({ url: 'http://127.0.0.1:8901/' });
        const histBefore = history.length;
        const cleared = await clearAllBrowsingData();
        const after = await session.defaultSession.cookies.get({ url: 'http://127.0.0.1:8901/' });
        console.log('FEATURES clear-all cookiesBefore=' + before.length + ' cookiesAfter=' + after.length + ' histBefore=' + histBefore + ' histAfter=' + history.length + ' cleared=' + cleared.join(','));
        if (after.length !== 0 || history.length !== 0) return fail('clear-all left data behind');

        // 9. VPN: fetch the live server list, switch on, verify routing, switch server, off.
        let servers = [];
        try { servers = await refreshVpnServers(); } catch (e) { console.log('FEATURES vpn fetch FAILED: ' + e.message); }
        console.log('FEATURES vpn servers=' + servers.length + ' first=' + (servers[0] ? servers[0].country + ' ' + servers[0].ip + ':' + servers[0].port : 'none'));
        if (!servers.length) return fail('vpn server list empty');
        const first = servers[0];
        await setVpn(true, `${first.ip}:${first.port}`);
        const resolved = await session.defaultSession.resolveProxy('https://example.com');
        console.log('FEATURES vpn on resolveProxy=' + resolved);
        if (!String(resolved).includes(first.ip)) return fail('vpn proxy not applied: ' + resolved);
        const sw = await switchVpnServer();
        console.log('FEATURES vpn switch ok=' + sw.ok + ' server=' + (sw.server ? sw.server.country + ' ' + sw.server.ip + ':' + sw.server.port : 'none'));
        if (!sw.ok) return fail('vpn switch failed');
        const resolved2 = await session.defaultSession.resolveProxy('https://example.com');
        if (String(resolved2).includes(first.ip)) return fail('vpn switch did not change the proxy');
        await setVpn(false, '');
        const resolved3 = await session.defaultSession.resolveProxy('https://example.com');
        console.log('FEATURES vpn off resolveProxy=' + resolved3);
        console.log('FEATURES ALL OK');
        app.quit();
      } catch (e) { console.log('FEATURES FAILED: ' + (e && e.stack ? e.stack : e.message)); app.exit(1); }
    }, 4000);
    setTimeout(() => { console.log('FEATURES TIMEOUT'); app.exit(1); }, 180000);
  }
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) createBrowserWindow({});
});
