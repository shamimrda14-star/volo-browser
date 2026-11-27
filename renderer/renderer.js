// Volo Browser — shell renderer (tabs strip, address bar, panels).
const api = window.volo;

let tabs = [];
let activeTabId = null;
let settings = null;
let bookmarks = [];
let downloads = [];
let addressFocused = false;

const $ = (id) => document.getElementById(id);
const tabsEl = $('tabs');
const addressBar = $('address-bar');
const backBtn = $('back-btn');
const forwardBtn = $('forward-btn');
const reloadBtn = $('reload-btn');
const homeBtn = $('home-btn');
const bookmarkBtn = $('bookmark-btn');
const bookmarksBar = $('bookmarks-bar');
const menuBtn = $('menu-btn');
const menuDropdown = $('menu-dropdown');
const overlay = $('panel-overlay');

const activeTab = () => tabs.find(t => t.id === activeTabId) || null;
const isWebUrl = (url) => /^https?:\/\//i.test(url || '');

// ---------- Tabs ----------
function faviconFor(tab) {
  if (tab.favicon) return `<img class="tab-favicon" src="${escapeHtml(tab.favicon)}" onerror="this.outerHTML='<span class=&quot;tab-favicon fallback&quot;>🌐</span>'">`;
  return '<span class="tab-favicon fallback">🌐</span>';
}
function escapeHtml(s) {
  return String(s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function renderTabs() {
  tabsEl.innerHTML = '';
  for (const tab of tabs) {
    const el = document.createElement('div');
    el.className = 'tab' + (tab.id === activeTabId ? ' active' : '');
    el.title = tab.title + (tab.url && !tab.isNewTab ? '\n' + tab.url : '');
    el.innerHTML =
      (tab.loading ? '<span class="tab-spinner"></span>' : faviconFor(tab)) +
      `<span class="tab-title">${escapeHtml(tab.title || 'New Tab')}</span>` +
      `<button class="tab-close" title="Close tab">✕</button>`;
    el.addEventListener('click', (e) => {
      if (e.target.closest('.tab-close')) { api.closeTab(tab.id); return; }
      api.activateTab(tab.id);
    });
    el.addEventListener('auxclick', (e) => { if (e.button === 1) api.closeTab(tab.id); });
    tabsEl.appendChild(el);
  }
  updateNavState();
}

function updateNavState() {
  const tab = activeTab();
  backBtn.disabled = !(tab && tab.canGoBack);
  forwardBtn.disabled = !(tab && tab.canGoForward);
  if (!addressFocused) {
    addressBar.value = tab && !tab.isNewTab ? (tab.url || '') : '';
  }
  addressBar.placeholder = tab && tab.isNewTab ? 'Search or enter address' : 'Search or enter address';
  const secure = tab && tab.url && tab.url.startsWith('https://');
  $('icon-secure').style.display = secure ? '' : 'none';
  $('icon-globe').style.display = secure ? 'none' : '';
  const bookmarked = tab && isWebUrl(tab.url) && bookmarks.some(b => b.url === tab.url);
  bookmarkBtn.classList.toggle('bookmarked', !!bookmarked);
  document.title = tab ? `${tab.title} - Volo Browser` : 'Volo Browser';
}

// ---------- Bookmarks bar ----------
function renderBookmarksBar() {
  const show = settings && settings.showBookmarksBar;
  bookmarksBar.style.display = show && bookmarks.length ? 'flex' : 'none';
  bookmarksBar.innerHTML = '';
  if (!show) return;
  for (const bm of bookmarks) {
    const chip = document.createElement('button');
    chip.className = 'bm-chip';
    chip.title = bm.url;
    const host = (() => { try { return new URL(bm.url).hostname; } catch { return ''; } })();
    chip.innerHTML = `<img src="https://www.google.com/s2/favicons?domain=${encodeURIComponent(host)}&sz=32" onerror="this.remove()">` +
      `<span>${escapeHtml(bm.title || bm.url)}</span>` +
      `<span class="bm-del" title="Remove bookmark">✕</span>`;
    chip.addEventListener('click', (e) => {
      if (e.target.closest('.bm-del')) { api.removeBookmark(bm.id); return; }
      const tab = activeTab();
      if (tab) api.navigate(tab.id, bm.url);
    });
    bookmarksBar.appendChild(chip);
  }
  reportToolbarHeight();
}

function reportToolbarHeight() {
  requestAnimationFrame(() => {
    const h = document.getElementById('toolbar').offsetHeight;
    api.setToolbarHeight(h);
  });
}

// ---------- Panels ----------
function openPanel(panelId) {
  overlay.hidden = false;
  api.setPanelOpen(true);
  for (const p of overlay.querySelectorAll('.panel')) p.hidden = p.id !== panelId;
  if (panelId === 'history-panel') refreshHistory();
  if (panelId === 'downloads-panel') renderDownloads();
  if (panelId === 'settings-panel') { fillSettings(); refreshExtensions(); }
  if (panelId === 'ai-panel') refreshAiPanel();
  if (panelId === 'about-panel') {
    $('about-versions').textContent =
      `Electron ${api.versions.electron} · Chromium ${api.versions.chrome}`;
  }
}
function closePanels() {
  overlay.hidden = true;
  api.setPanelOpen(false);
  for (const p of overlay.querySelectorAll('.panel')) p.hidden = true;
}
overlay.querySelector('.panel-backdrop').addEventListener('click', closePanels);
document.querySelectorAll('.panel-close').forEach(b =>
  b.addEventListener('click', () => closePanels()));
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') { closePanels(); menuDropdown.hidden = true; }
});

// ---------- History ----------
async function refreshHistory() {
  const filter = ($('history-filter').value || '').toLowerCase();
  const list = await api.listHistory(500);
  const listEl = $('history-list');
  const shown = list.filter(h =>
    !filter || (h.title || '').toLowerCase().includes(filter) || h.url.toLowerCase().includes(filter));
  if (!shown.length) {
    listEl.innerHTML = '<div class="list-empty">No history yet.</div>';
    return;
  }
  // Group by date: Today, Yesterday, then the calendar date.
  const dayLabel = (ts) => {
    const d = new Date(ts);
    const today = new Date();
    const yesterday = new Date();
    yesterday.setDate(today.getDate() - 1);
    const sameDay = (a, b) => a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
    if (sameDay(d, today)) return 'Today';
    if (sameDay(d, yesterday)) return 'Yesterday';
    return d.toLocaleDateString(undefined, { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' });
  };
  listEl.innerHTML = '';
  let lastLabel = null;
  for (const h of shown) {
    const label = dayLabel(h.visitedAt);
    if (label !== lastLabel) {
      lastLabel = label;
      const header = document.createElement('div');
      header.className = 'list-date-header';
      header.textContent = label;
      listEl.appendChild(header);
    }
    const item = document.createElement('div');
    item.className = 'list-item';
    const host = (() => { try { return new URL(h.url).hostname; } catch { return h.url; } })();
    item.innerHTML =
      `<img class="item-icon" src="https://www.google.com/s2/favicons?domain=${encodeURIComponent(host)}&sz=32" onerror="this.style.visibility='hidden'">` +
      `<div class="item-main"><div class="item-title">${escapeHtml(h.title || h.url)}</div>` +
      `<div class="item-sub">${escapeHtml(h.url)} · ${new Date(h.visitedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</div></div>` +
      `<button class="item-del" title="Remove">✕</button>`;
    item.addEventListener('click', (e) => {
      if (e.target.closest('.item-del')) { api.removeHistory(h.id).then(refreshHistory); return; }
      const tab = activeTab();
      if (tab) api.navigate(tab.id, h.url);
      closePanels();
    });
    listEl.appendChild(item);
  }
}
$('history-filter').addEventListener('input', refreshHistory);
$('history-clear-btn').addEventListener('click', async () => {
  // One click clears EVERYTHING: history + cookies/site data + cache.
  const cleared = await api.clearAllBrowsingData();
  alert('Cleared: ' + cleared.join(', ') + '.');
  refreshHistory();
});

// ---------- Downloads ----------
function renderDownloads() {
  const listEl = $('downloads-list');
  if (!downloads.length) {
    listEl.innerHTML = '<div class="list-empty">No downloads yet.</div>';
    return;
  }
  listEl.innerHTML = '';
  for (const d of downloads) {
    const item = document.createElement('div');
    item.className = 'list-item';
    const pct = d.totalBytes > 0 ? Math.round((d.receivedBytes / d.totalBytes) * 100) : 0;
    const stateText = d.state === 'progressing' ? `${pct}% · ${(d.receivedBytes / 1048576).toFixed(1)} MB of ${(d.totalBytes / 1048576).toFixed(1)} MB`
      : d.state === 'completed' ? 'Completed'
      : d.state === 'paused' ? `Paused at ${pct}%`
      : d.state === 'cancelled' ? 'Cancelled' : 'Interrupted';
    item.innerHTML =
      `<div class="item-main"><div class="item-title">${escapeHtml(d.filename)}</div>` +
      `<div class="item-sub">${stateText}</div>` +
      (d.state === 'progressing' || d.state === 'paused' ? `<div class="progress"><div style="width:${pct}%"></div></div>` : '') +
      `</div>` +
      (d.state === 'completed'
        ? `<div class="item-actions"><button data-act="open">Open</button><button data-act="show">Show in folder</button></div>`
        : (d.state === 'progressing' || d.state === 'paused' || d.state === 'interrupted')
          ? `<div class="item-actions">` +
            (d.state === 'progressing' ? `<button data-act="pause">Pause</button>` : `<button data-act="resume">Resume</button>`) +
            `<button data-act="cancel">Cancel</button></div>`
          : '');
    item.querySelector('[data-act="open"]')?.addEventListener('click', (e) => { e.stopPropagation(); api.openDownload(d.id); });
    item.querySelector('[data-act="show"]')?.addEventListener('click', (e) => { e.stopPropagation(); api.showDownload(d.id); });
    item.querySelector('[data-act="pause"]')?.addEventListener('click', async (e) => { e.stopPropagation(); await api.pauseDownload(d.id); downloads = await api.listDownloads(); renderDownloads(); });
    item.querySelector('[data-act="resume"]')?.addEventListener('click', async (e) => { e.stopPropagation(); await api.resumeDownload(d.id); downloads = await api.listDownloads(); renderDownloads(); });
    item.querySelector('[data-act="cancel"]')?.addEventListener('click', async (e) => { e.stopPropagation(); await api.cancelDownload(d.id); downloads = await api.listDownloads(); renderDownloads(); });
    listEl.appendChild(item);
  }
  const active = downloads.filter(d => d.state === 'progressing').length;
  const badge = $('dl-badge');
  badge.hidden = active === 0;
  badge.textContent = active;
}
$('downloads-clear-btn').addEventListener('click', async () => {
  downloads = await api.clearDownloads();
  renderDownloads();
});

// ---------- Settings ----------
function fillSettings() {
  if (!settings) return;
  $('setting-engine').value = settings.searchEngine;
  $('setting-private-engine').value = settings.privateSearchEngine || 'duckduckgo';
  $('setting-theme').value = settings.theme;
  $('setting-homepage').value = settings.homepage;
  $('setting-bookmarks-bar').checked = !!settings.showBookmarksBar;
  $('setting-doh-mode').value = settings.dohMode || 'secure';
  $('setting-doh-template').value = settings.dohTemplate || 'cloudflare';
  $('setting-proxy-mode').value = settings.proxyMode || 'system';
  $('setting-proxy-rules').value = settings.proxyRules || '';
  $('setting-proxy-bypass').value = settings.proxyBypass || '';
  $('setting-proxy-username').value = settings.proxyUsername || '';
  $('setting-proxy-password').value = settings.proxyPassword || '';
  $('setting-ai-key').value = settings.aiApiKey || '';
  $('setting-ai-model').value = settings.aiModel || 'gemini-2.0-flash';
  $('setting-vpn-enabled').checked = !!settings.vpnEnabled;
  $('setting-adblock-enabled').checked = settings.adblockEnabled !== false;
  $('setting-tab-sleep').value = String(settings.tabSleepMinutes ?? 15);
  $('setting-translate-lang').value = settings.translateLang || 'bn';
  refreshVpnUI();
  refreshAdblockUI();
  $('settings-version').textContent =
    `Volo Browser v1.0.0 · Electron ${api.versions.electron} · Chromium ${api.versions.chrome}`;
}
$('setting-engine').addEventListener('change', (e) => api.setSettings({ searchEngine: e.target.value }));
$('setting-private-engine').addEventListener('change', (e) => api.setSettings({ privateSearchEngine: e.target.value }));
$('setting-theme').addEventListener('change', (e) => api.setSettings({ theme: e.target.value }));
$('setting-homepage').addEventListener('change', (e) => api.setSettings({ homepage: e.target.value.trim() || 'volo://newtab' }));
$('setting-bookmarks-bar').addEventListener('change', (e) => api.setSettings({ showBookmarksBar: e.target.checked }));
$('setting-doh-mode').addEventListener('change', (e) => api.setSettings({ dohMode: e.target.value }));
$('setting-doh-template').addEventListener('change', (e) => api.setSettings({ dohTemplate: e.target.value }));
$('setting-proxy-mode').addEventListener('change', (e) => api.setSettings({ proxyMode: e.target.value }));
$('setting-proxy-rules').addEventListener('change', (e) => api.setSettings({ proxyRules: e.target.value.trim() }));
$('setting-proxy-bypass').addEventListener('change', (e) => api.setSettings({ proxyBypass: e.target.value.trim() }));
$('setting-proxy-username').addEventListener('change', (e) => api.setSettings({ proxyUsername: e.target.value.trim() }));
$('setting-proxy-password').addEventListener('change', (e) => api.setSettings({ proxyPassword: e.target.value }));
$('setting-ai-key').addEventListener('change', (e) => api.setSettings({ aiApiKey: e.target.value.trim() }));
$('setting-ai-model').addEventListener('change', (e) => api.setSettings({ aiModel: e.target.value.trim() || 'gemini-2.0-flash' }));
$('setting-vpn-enabled').addEventListener('change', async (e) => {
  const on = e.target.checked;
  if (on && !settings.vpnServer) {
    const r = await api.switchVpnServer();
    if (!r.ok) { alert(r.error || 'Could not turn the VPN on.'); e.target.checked = false; return; }
  } else {
    await api.setVpn({ enabled: on, server: settings.vpnServer });
  }
  settings = await api.getSettings();
  refreshVpnUI();
});
$('setting-vpn-server').addEventListener('change', async (e) => {
  if (!e.target.value) return;
  await api.setVpn({ enabled: true, server: e.target.value });
  settings = await api.getSettings();
  refreshVpnUI();
});
$('vpn-refresh-btn').addEventListener('click', async () => {
  const r = await api.refreshVpn();
  if (!r.ok) alert('Could not fetch the server list: ' + (r.error || 'network error'));
  settings = await api.getSettings();
  refreshVpnUI();
});
$('vpn-next-btn').addEventListener('click', async () => {
  const r = await api.switchVpnServer();
  if (!r.ok) alert(r.error || 'Could not switch server.');
  settings = await api.getSettings();
  refreshVpnUI();
});
$('setting-adblock-enabled').addEventListener('change', async (e) => {
  await api.setAdblock({ enabled: e.target.checked });
  refreshAdblockUI();
});
$('adblock-allow-site-btn').addEventListener('click', async () => {
  const r = await api.allowAdsOnSite(true);
  alert(r.ok ? `Ads allowed on ${r.host}.` : (r.error || 'Could not change this site.'));
  refreshAdblockUI();
});
$('adblock-block-site-btn').addEventListener('click', async () => {
  const r = await api.allowAdsOnSite(false);
  alert(r.ok ? `Ads will be blocked on ${r.host} again.` : (r.error || 'Could not change this site.'));
  refreshAdblockUI();
});
$('setting-tab-sleep').addEventListener('change', (e) => api.setSettings({ tabSleepMinutes: parseInt(e.target.value, 10) || 0 }));
$('setting-translate-lang').addEventListener('change', (e) => api.setSettings({ translateLang: e.target.value }));
$('ai-studio-btn').addEventListener('click', () => { api.createTab('https://aistudio.google.com/app/apikey'); closePanels(); });
$('restart-btn').addEventListener('click', () => api.restart());
$('clear-data-btn').addEventListener('click', async () => {
  const cleared = await api.clearBrowsingData({
    history: $('clear-history').checked,
    cookies: $('clear-cookies').checked,
    cache: $('clear-cache').checked
  });
  alert(cleared.length ? 'Cleared: ' + cleared.join(', ') + '.' : 'Nothing selected.');
});

// ---------- Extensions ----------
async function refreshExtensions() {
  const listEl = $('extensions-list');
  const list = await api.listExtensions();
  if (!list.length) {
    listEl.innerHTML = '<div class="list-empty">No extensions loaded.</div>';
    return;
  }
  listEl.innerHTML = '';
  for (const ext of list) {
    const item = document.createElement('div');
    item.className = 'list-item';
    item.style.opacity = ext.enabled ? '1' : '0.55';
    item.innerHTML =
      `<div class="item-main"><div class="item-title">${escapeHtml(ext.name)}${ext.enabled ? '' : ' (disabled)'}</div>` +
      `<div class="item-sub">v${escapeHtml(ext.version || '')}</div></div>` +
      `<div class="item-actions">` +
      `<button data-act="toggle">${ext.enabled ? 'Disable' : 'Enable'}</button>` +
      `<button data-act="remove">Remove</button></div>`;
    item.querySelector('[data-act="toggle"]').addEventListener('click', async () => {
      const res = await api.setExtensionEnabled(ext.id, !ext.enabled);
      if (!res.ok) alert('Could not change extension: ' + (res.error || 'unknown error'));
      refreshExtensions();
    });
    item.querySelector('[data-act="remove"]').addEventListener('click', async () => {
      await api.removeExtension(ext.id);
      refreshExtensions();
    });
    listEl.appendChild(item);
  }
}
$('ext-unpacked-btn').addEventListener('click', async () => {
  const res = await api.loadUnpackedExtension();
  if (!res.ok && !res.cancelled) alert('Could not load extension: ' + (res.error || 'unknown error'));
  refreshExtensions();
});
$('ext-crx-btn').addEventListener('click', async () => {
  const res = await api.loadCrxExtension();
  if (!res.ok && !res.cancelled) alert('Could not install extension: ' + (res.error || 'unknown error'));
  refreshExtensions();
});

function applyTheme() {
  document.documentElement.setAttribute('data-theme', settings && settings.theme === 'dark' ? 'dark' : 'light');
}

// ---------- Find in page ----------
const findBar = $('find-bar');
const findInput = $('find-input');
let findActive = false;
function showFindBar() {
  findBar.hidden = false;
  findActive = true;
  reportToolbarHeight();
  findInput.focus();
  findInput.select();
  const text = findInput.value.trim();
  const tab = activeTab();
  if (text && tab) api.findSearch(tab.id, text, true, false);
}
function hideFindBar() {
  findBar.hidden = true;
  findActive = false;
  $('find-count').textContent = '';
  const tab = activeTab();
  if (tab) api.findStop(tab.id);
  reportToolbarHeight();
}
findInput.addEventListener('input', () => {
  const tab = activeTab();
  const text = findInput.value;
  if (!tab) return;
  if (!text) { $('find-count').textContent = ''; api.findStop(tab.id); return; }
  api.findSearch(tab.id, text, true, false);
});
findInput.addEventListener('keydown', (e) => {
  const tab = activeTab();
  if (e.key === 'Enter') {
    if (tab && findInput.value) api.findSearch(tab.id, findInput.value, !e.shiftKey, true);
    e.preventDefault();
  } else if (e.key === 'Escape') {
    hideFindBar();
  }
});
$('find-next').addEventListener('click', () => {
  const tab = activeTab();
  if (tab && findInput.value) api.findSearch(tab.id, findInput.value, true, true);
});
$('find-prev').addEventListener('click', () => {
  const tab = activeTab();
  if (tab && findInput.value) api.findSearch(tab.id, findInput.value, false, true);
});
$('find-close').addEventListener('click', hideFindBar);
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && findActive) hideFindBar();
});

// ---------- Nav bar wiring ----------
$('toolbar-logo').addEventListener('click', () => api.createTab());
$('new-tab-btn').addEventListener('click', () => api.createTab());
backBtn.addEventListener('click', () => { const t = activeTab(); if (t) api.goBack(t.id); });
forwardBtn.addEventListener('click', () => { const t = activeTab(); if (t) api.goForward(t.id); });
reloadBtn.addEventListener('click', () => { const t = activeTab(); if (t) api.reload(t.id); });
homeBtn.addEventListener('click', () => { const t = activeTab(); if (t) api.goHome(t.id); });
bookmarkBtn.addEventListener('click', async () => {
  const t = activeTab();
  if (!t || !isWebUrl(t.url)) return;
  await api.toggleBookmark({ title: t.title, url: t.url });
  updateNavState();
});
$('history-btn').addEventListener('click', () => openPanel('history-panel'));
$('downloads-btn').addEventListener('click', () => openPanel('downloads-panel'));
$('ai-btn').addEventListener('click', () => openPanel('ai-panel'));
$('vpn-btn').addEventListener('click', (e) => { e.stopPropagation(); toggleVpnDropdown(); });
$('adblock-btn').addEventListener('click', () => {
  openPanel('settings-panel');
  setTimeout(() => $('setting-adblock-enabled').scrollIntoView({ block: 'center' }), 50);
});
$('update-btn').addEventListener('click', async () => {
  const r = await api.checkUpdate();
  if (r && r.ok) { updateStatus = { ...updateStatus, state: 'checking' }; refreshUpdateUI(); }
});

// ---------- AI Assistant ----------
// Chat history is session-only: kept in memory per window, never saved.
let aiMessages = [];
let aiBusy = false;
const AI_ERRORS = {
  NO_KEY: 'No API key set. Add your free Gemini API key in Settings → AI Assistant.',
  BAD_KEY: 'Google rejected that API key. Check it in Settings → AI Assistant.',
  BAD_MODEL: 'That model name was not found. Check the model in Settings → AI Assistant.',
  QUOTA: 'Free-tier limit reached for now — try again in a little while.',
  NETWORK: "Couldn't reach Google's servers. Check your connection and try again.",
  EMPTY: 'Gemini returned an empty reply. Try rephrasing your question.'
};
async function refreshAiPanel() {
  const s = await api.getSettings();
  settings = s;
  const hasKey = !!(s.aiApiKey || '').trim();
  $('ai-setup').hidden = hasKey;
  $('ai-input').disabled = !hasKey || aiBusy;
  $('ai-send-btn').disabled = !hasKey || aiBusy;
  renderAiMessages();
}
function renderAiMessages() {
  const el = $('ai-messages');
  if (!aiMessages.length) {
    el.innerHTML = '<div class="list-empty">Ask anything — summaries, explanations, help with a page.</div>';
    return;
  }
  el.innerHTML = '';
  for (const m of aiMessages) {
    const div = document.createElement('div');
    div.className = 'ai-msg ' + (m.role === 'model' ? 'model' : 'user') + (m.error ? ' error' : '');
    div.textContent = m.text;
    el.appendChild(div);
  }
  el.scrollTop = el.scrollHeight;
}
async function sendAiMessage() {
  const input = $('ai-input');
  const text = input.value.trim();
  if (!text || aiBusy) return;
  input.value = '';
  aiMessages.push({ role: 'user', text });
  aiBusy = true;
  $('ai-input').disabled = true;
  $('ai-send-btn').disabled = true;
  renderAiMessages();
  const thinking = document.createElement('div');
  thinking.className = 'ai-msg model thinking';
  thinking.textContent = 'Thinking…';
  $('ai-messages').appendChild(thinking);
  $('ai-messages').scrollTop = $('ai-messages').scrollHeight;
  const res = await api.chatAI(aiMessages.filter(m => !m.error));
  thinking.remove();
  aiBusy = false;
  $('ai-input').disabled = false;
  $('ai-send-btn').disabled = false;
  if (res.ok) {
    aiMessages.push({ role: 'model', text: res.text });
  } else {
    aiMessages.push({ role: 'model', error: true, text: '⚠ ' + (AI_ERRORS[res.error] || ('Something went wrong (' + res.error + ').')) });
  }
  renderAiMessages();
  $('ai-input').focus();
}
$('ai-send-btn').addEventListener('click', sendAiMessage);
$('ai-input').addEventListener('keydown', (e) => { if (e.key === 'Enter') sendAiMessage(); });
$('ai-new-chat-btn').addEventListener('click', () => { aiMessages = []; renderAiMessages(); });
$('ai-get-key-btn').addEventListener('click', () => { api.createTab('https://aistudio.google.com/app/apikey'); closePanels(); });
$('ai-open-settings-btn').addEventListener('click', () => openPanel('settings-panel'));

addressBar.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') {
    const t = activeTab();
    const value = addressBar.value.trim();
    if (t && value) api.navigate(t.id, value);
    addressBar.blur();
  }
});
addressBar.addEventListener('focus', () => { addressFocused = true; addressBar.select(); });
addressBar.addEventListener('blur', () => { addressFocused = false; updateNavState(); });

// ---------- Menu dropdown ----------
menuBtn.addEventListener('click', (e) => {
  e.stopPropagation();
  menuDropdown.hidden = !menuDropdown.hidden;
});
document.addEventListener('click', (e) => {
  if (!e.target.closest('#menu-dropdown') && !e.target.closest('#menu-btn')) menuDropdown.hidden = true;
});
menuDropdown.querySelectorAll('button').forEach((btn) => {
  btn.addEventListener('click', async () => {
    menuDropdown.hidden = true;
    const action = btn.dataset.action;
    if (action === 'new-tab') api.createTab();
    else if (action === 'new-window') api.newWindow();
    else if (action === 'new-private') api.newPrivateWindow();
    else if (action === 'history') openPanel('history-panel');
    else if (action === 'downloads') openPanel('downloads-panel');
    else if (action === 'ai') openPanel('ai-panel');
    else if (action === 'find') showFindBar();
    else if (action === 'print') { const t = activeTab(); if (t) api.printPage(t.id); }
    else if (action === 'toggle-bookmarks-bar') api.setSettings({ showBookmarksBar: !(settings && settings.showBookmarksBar) });
    else if (action === 'toggle-theme') api.setSettings({ theme: settings && settings.theme === 'dark' ? 'light' : 'dark' });
    else if (action === 'settings') openPanel('settings-panel');
    else if (action === 'about') openPanel('about-panel');
    else if (action === 'clear-all-history') {
      const cleared = await api.clearAllBrowsingData();
      alert('Cleared: ' + cleared.join(', ') + '.');
    }
    else if (action === 'translate-bn') {
      const r = await api.translatePage('bn');
      if (!r.ok) alert(r.error || 'Translation failed.');
    }
    else if (action === 'reader') {
      const r = await api.readerView();
      if (!r.ok) alert(r.error || 'Could not open Reader view.');
    }
    else if (action === 'screenshot') {
      const r = await api.screenshotPage();
      if (!r.ok) alert(r.error || 'Screenshot failed.');
    }
    else if (action === 'pip') {
      const r = await api.popOutVideo();
      if (!r.ok) alert(r.error === 'no-video' ? 'No video found on this page.' : 'Could not pop out the video.');
    }
    else if (action === 'volo-call') api.openVoloCall();
    else if (action === 'check-updates') {
      const r = await api.checkUpdate();
      if (r && r.ok) { updateStatus = { ...updateStatus, state: 'checking' }; refreshUpdateUI(); }
    }
  });
});

// ---------- Free VPN (toolbar button + quick-pick dropdown) ----------
let vpnState = null;
async function refreshVpnUI() {
  vpnState = await api.getVpn();
  const btn = $('vpn-btn');
  const on = !!(vpnState.enabled && vpnState.server);
  btn.classList.toggle('vpn-on', on);
  $('vpn-label').hidden = !on;
  $('vpn-label').textContent = on ? vpnState.server.country : '';
  btn.title = on
    ? `Free VPN — on (${vpnState.server.country} · ${vpnState.server.ip}:${vpnState.server.port}). Click to switch server.`
    : 'Free VPN — off. Click to pick a server.';
  $('vpn-dd-status').textContent = on
    ? `On — ${vpnState.server.country} (${vpnState.server.ip}:${vpnState.server.port})`
    : 'Off';
  const listEl = $('vpn-server-list');
  listEl.innerHTML = '';
  const servers = (vpnState.servers || []).slice(0, 10);
  if (!servers.length) {
    listEl.innerHTML = '<div class="list-empty">No servers cached yet — use Refresh Server List.</div>';
  }
  for (const s of servers) {
    const b = document.createElement('button');
    b.className = 'vpn-server';
    b.innerHTML = `<span>${escapeHtml(s.country)}${s.city ? ' — ' + escapeHtml(s.city) : ''}</span><small>${escapeHtml(s.ip)}:${escapeHtml(s.port)} · ${s.latency} ms</small>`;
    b.addEventListener('click', async () => {
      await api.setVpn({ enabled: true, server: `${s.ip}:${s.port}` });
      settings = await api.getSettings();
      $('vpn-dropdown').hidden = true;
      refreshVpnUI();
    });
    listEl.appendChild(b);
  }
  const sel = $('setting-vpn-server');
  if (sel) {
    const cur = vpnState.server ? `${vpnState.server.ip}:${vpnState.server.port}` : '';
    sel.innerHTML = '';
    if (!vpnState.servers.length) {
      sel.innerHTML = '<option value="">No servers yet — refresh the list</option>';
    }
    for (const s of (vpnState.servers || [])) {
      const o = document.createElement('option');
      o.value = `${s.ip}:${s.port}`;
      o.textContent = `${s.country}${s.city ? ' — ' + s.city : ''} (${s.ip}:${s.port} · ${s.latency} ms)`;
      if (o.value === cur) o.selected = true;
      sel.appendChild(o);
    }
    if (cur && ![...sel.options].some(o => o.value === cur)) {
      const o = document.createElement('option');
      o.value = cur; o.textContent = `${vpnState.server.country} — current (${cur})`; o.selected = true;
      sel.appendChild(o);
    }
  }
  const line = $('vpn-status-line');
  if (line) {
    line.textContent = on
      ? `VPN is on — ${vpnState.server.country} (${vpnState.server.ip}:${vpnState.server.port}). Last list refresh: ${vpnState.lastFetch ? new Date(vpnState.lastFetch).toLocaleString() : 'never'}.`
      : 'VPN is off.';
  }
}
function toggleVpnDropdown() {
  const dd = $('vpn-dropdown');
  const willShow = dd.hidden;
  menuDropdown.hidden = true;
  dd.hidden = !willShow;
  if (willShow) refreshVpnUI();
}
document.querySelectorAll('#vpn-dropdown [data-vpn]').forEach((btn) => {
  btn.addEventListener('click', async () => {
    const action = btn.dataset.vpn;
    if (action === 'next') {
      const r = await api.switchVpnServer();
      if (!r.ok) alert(r.error || 'Could not switch server.');
    } else if (action === 'refresh') {
      const r = await api.refreshVpn();
      if (!r.ok) alert('Could not fetch the server list: ' + (r.error || 'network error'));
    } else if (action === 'off') {
      await api.setVpn({ enabled: false, server: settings.vpnServer });
    } else if (action === 'settings') {
      $('vpn-dropdown').hidden = true;
      openPanel('settings-panel');
      return;
    }
    settings = await api.getSettings();
    $('vpn-dropdown').hidden = true;
    refreshVpnUI();
  });
});
document.addEventListener('click', (e) => {
  if (!e.target.closest('#vpn-dropdown') && !e.target.closest('#vpn-btn')) $('vpn-dropdown').hidden = true;
});
api.onVpnChanged(() => refreshVpnUI());

// ---------- AdBlocker (toolbar badge + settings) ----------
async function refreshAdblockUI() {
  const info = await api.getAdblock();
  const btn = $('adblock-btn');
  btn.title = info.enabled
    ? `AdBlocker — on${info.count ? ` (${info.count} blocked on this page)` : ''}. Click for AdBlocker settings.`
    : 'AdBlocker — off. Click for AdBlocker settings.';
  btn.style.opacity = info.enabled ? '' : '0.45';
  const badge = $('adblock-badge');
  badge.hidden = !(info.enabled && info.count > 0);
  badge.textContent = info.count > 99 ? '99+' : String(info.count);
  const line = $('adblock-status-line');
  if (line) {
    line.textContent = info.enabled
      ? `Blocking is on.${info.count ? ` ${info.count} ad/tracker requests blocked on the current page.` : ''}${(info.allowlist || []).length ? ` Ads allowed on: ${(info.allowlist || []).join(', ')}.` : ''}`
      : 'Blocking is off — ads will show on all sites.';
  }
  const chk = $('setting-adblock-enabled');
  if (chk) chk.checked = !!info.enabled;
}
api.onAdblockCount(({ tabId, count }) => {
  const t = activeTab();
  if (t && t.id === tabId) refreshAdblockUI();
});

// ---------- Update button ----------
let updateStatus = { state: 'unknown', version: '1.0.0' };
function refreshUpdateUI() {
  const btn = $('update-btn');
  const dot = $('update-dot');
  const v = updateStatus.version || '1.0.0';
  if (updateStatus.state === 'available' || updateStatus.state === 'downloaded') {
    dot.hidden = false;
    btn.title = `Volo Browser v${v} — update ${updateStatus.version} available! Click to install.`;
  } else if (updateStatus.state === 'up-to-date') {
    dot.hidden = true;
    btn.title = `Volo Browser v${v} — up to date.`;
  } else if (updateStatus.state === 'checking') {
    dot.hidden = true;
    btn.title = `Volo Browser v${v} — checking for updates…`;
  } else {
    dot.hidden = true;
    btn.title = `Volo Browser v${v} — click to check for updates.`;
  }
  const m = $('menu-update-btn');
  if (m) m.textContent = `Check for Updates — v${v}`;
}
api.onUpdateStatus((s) => { updateStatus = s; refreshUpdateUI(); });

// ---------- Events from main ----------
api.onTabsUpdate(({ tabs: newTabs, activeTabId: newActive, isPrivate }) => {
  tabs = newTabs;
  activeTabId = newActive;
  $('private-badge').hidden = !isPrivate;
  renderTabs();
  refreshAdblockUI();
});
api.onBookmarksChanged((list) => { bookmarks = list; renderBookmarksBar(); updateNavState(); });
api.onDownloadsUpdate((list) => {
  downloads = list;
  if (!$('downloads-panel').hidden) renderDownloads();
  const active = downloads.filter(d => d.state === 'progressing').length;
  const badge = $('dl-badge');
  badge.hidden = active === 0;
  badge.textContent = active;
});
api.onSettingsChanged((s) => {
  settings = s;
  applyTheme();
  renderBookmarksBar();
});
api.onFocusAddress(() => { addressBar.focus(); addressBar.select(); });
api.onShowHistory(() => openPanel('history-panel'));
api.onShowDownloads(() => openPanel('downloads-panel'));
api.onShowSettings(() => openPanel('settings-panel'));
api.onShowAI(() => openPanel('ai-panel'));
api.onShowFind(() => showFindBar());
api.onFindResult((r) => {
  if (!findActive || r.tabId !== activeTabId) return;
  $('find-count').textContent = r.matches === 0 ? 'No results'
    : (r.finalUpdate ? `${r.activeMatchOrdinal}/${r.matches}` : '…');
});

// ---------- Init ----------
(async () => {
  settings = await api.getSettings();
  bookmarks = await api.listBookmarks();
  downloads = await api.listDownloads();
  updateStatus = await api.getUpdateStatus();
  applyTheme();
  renderBookmarksBar();
  renderDownloads();
  refreshVpnUI();
  refreshAdblockUI();
  refreshUpdateUI();
  $('private-badge').hidden = !api.isPrivate;
  reportToolbarHeight();
  window.addEventListener('resize', reportToolbarHeight);
})();
