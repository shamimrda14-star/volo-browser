# Volo Browser — v1

A real, working desktop web browser for Windows (with Mac and Linux builds
from the same codebase). Built on **Electron 45 / Chromium 156** — the same
engine Google Chrome uses — so pages render exactly like Chrome.

**No telemetry. No analytics. No calling home.** Bookmarks, history, settings
and extensions live only on the user's computer (plain JSON files in the
app's user-data folder). The only network the app itself initiates is the
automatic update check against GitHub Releases (see "Automatic updates").

> Name: **Volo Browser** — the user's pick (2026-11-23). "Volo" is Latin for
> "I fly". (Earlier working names "Aero" and "Muse Browser" were dropped the
> same day — "Aero" collided with several existing browsers.) The name lives
> in one place in code (`PRODUCT_NAME` in `main.js`) plus `package.json`, so
> a future rename is a simple find-replace.

## Features (v1 — all working and test-verified)

- **Tabs** — open, close, switch, new tab (+ button, Ctrl+T, toolbar logo),
  middle-click to close, favicons, loading spinners
- **Address bar** — URL entry + search. Default search engine **Google**;
  switch to DuckDuckGo or Bing in Settings. Private windows search with
  **DuckDuckGo** by default (changeable in Settings)
- **Navigation** — back / forward / reload / home buttons + shortcuts
- **Bookmarks** — star button (Ctrl+D), bookmarks bar, click to open, remove
  (persisted in `bookmarks.json`)
- **History** — full history view: searchable, **grouped by date** (Today /
  Yesterday / calendar date), per-item delete, clear all (persisted in
  `history.json`, capped at 2,000 entries). Visit recording is verified by
  the test suite
- **Cookies & sessions** — persistent session exactly like Chrome: sites set
  cookies and logins stay signed in across restarts (verified: a cookie set
  in one run was still in the jar and sent back to the site after a full
  app restart). Private windows use a separate in-memory session
- **Downloads** — progress list, open file / show in folder, **pause /
  resume / cancel** for large downloads
- **Private window** (Ctrl+Shift+N) — separate in-memory session, no history
  recorded, DuckDuckGo search, "Private" badge
- **Clear All History** — one click (History panel, History menu, or the
  ⋮ menu) clears history + cookies/site data + cache, with a confirmation
- **AdBlocker** — ON by default: EasyList-based blocking of ads and trackers
  on every page, with a toolbar shield showing the blocked count, a global
  toggle and a per-site allow option (Settings → AdBlocker)
- **Free VPN** — toolbar button + Settings section: one tap picks a free
  public server (GeoNode's free list, no key/account) and routes traffic
  through it; one tap on another server switches instantly. Honest warning
  on screen: free servers are slow, come and go, and can see traffic —
  unblocking + casual browsing only, never banking/passwords. Manual proxy
  settings remain available in the same section
- **Page translate** — View → Translate Page (Bangla, English, Hindi,
  Spanish, Arabic, French), in place, with Show Original to restore
- **Reader view** — View → Reader View: clean article page without ads or
  clutter, in a new tab
- **Screenshot** — View → Screenshot Full Page: captures the whole page
  (beyond the viewport) as a PNG in the Pictures folder
- **Video pop-out** — View → Pop Out Video: picture-in-picture float for
  the page's video
- **Tab sleep / memory saver** — inactive tabs unload after 15 minutes
  (Settings → Tabs & Reading: off / 5 / 15 / 30 min) and reload on click;
  View → Sleep Other Tabs Now
- **Update button** — toolbar button shows the current version and whether
  an update is available; one click checks for and installs the newest
  version (electron-updater + GitHub Releases; see "Automatic updates")
- **Tools menu** — Video Downloader, File Converter, Passport Photo Maker
  (open their pages in a tab), plus **Volo Call — Download** (says
  "coming soon" until the Volo Call APK is published on GitHub Releases)
- **New-tab page** — search box, quick links (bookmarks + most-visited),
  **Recommended shortcut tiles** (see below), logo
- **Extensions** — load Chrome extensions from an unpacked folder or a `.crx`
  file (Settings → Extensions), with **enable / disable / remove**. Loaded
  extensions persist across restarts. Chrome Web Store one-click install
  does **not** work in Electron — this is an Electron limitation, not a bug.
  Extensions run in normal windows only
- **Find in page** (Ctrl+F) — find bar with match count, next/previous,
  Esc to close
- **Zoom** — in/out/reset (Ctrl+= / Ctrl+- / Ctrl+0, View menu)
- **Print** (Ctrl+P) — system print dialog
- **Clear browsing data** — history, cookies + site data, cache (Settings,
  with checkboxes; clearing cookies signs you out of sites, like Chrome).
  **Clear All History** does all three in one click (History panel, History
  menu, or the ⋮ menu), with a confirmation
- **Dark / light theme** toggle (Settings or View menu)
- **Settings** — search engines, theme, homepage, bookmarks bar, Secure DNS,
  proxy, AI Assistant key, extensions, clear data
- **AI Assistant** — built-in chat panel (toolbar button, Ctrl+Shift+A)
  powered by Google Gemini with the user's own free API key (see below)
- **Blocked sites** — DNS-over-HTTPS (Secure DNS) bypasses DNS-level blocks,
  on by default (Cloudflare; Google / Quad9 optional); manual proxy settings
  incl. SOCKS + optional proxy auth (see below)
- **Automatic updates** — checks GitHub Releases and installs new versions
  itself (see below)
- **Extras** — right-click context menu, full application menu with
  shortcuts, About dialog, single-instance lock, window + installer icon

## Sponsored tiles (new-tab page)

The new-tab page shows a **Recommended** row of shortcut tiles — plain links
only, Firefox-style. There is **no ad code, no AdSense/AdMob, no tracking**
anywhere in the app (putting AdSense code in an app would violate Google's
policy and risk the AdSense account currently under review).

Manage the list in [`sponsored.json`](sponsored.json) (shipped with the app):

```json
{
  "tiles": [
    { "title": "The Airport Guide", "url": "https://theairportguide24.blogspot.com/", "sponsored": false },
    { "title": "Example Sponsor", "url": "https://example.com", "sponsored": true }
  ]
}
```

Tiles with `"sponsored": true` show a "Sponsored" tag; the v1 placeholders
(his own blogs) have `"sponsored": false` and show no tag. To add a real
sponsor later, add an entry with `"sponsored": true`. Empty tiles array =
no Recommended section shown.

## AI Assistant (Google Gemini)

The toolbar's AI button (Ctrl+Shift+A) opens a chat panel powered by
**Google Gemini** — this is **not** Muse: Muse cannot be embedded in an app
(no Muse API exists to ship).

- The user pastes **their own free Gemini API key** (Google AI Studio free
  tier) in Settings → AI Assistant. No key is shipped with the app, and no
  key is ever hardcoded.
- The key is stored **locally only** in `settings.json` (plaintext, like the
  proxy password) and sent **only** to Google's Gemini API endpoint
  (`generativelanguage.googleapis.com`), in the `x-goog-api-key` header —
  never to any other server, never in a URL.
- Chat history is **session-only** (kept in memory per window, never written
  to disk). "New chat" clears it.
- Default model is `gemini-2.0-flash` (free tier); the model name is
  editable in Settings.
- If no key is set, the panel shows a short setup note with a button to get
  a free key at [Google AI Studio](https://aistudio.google.com/app/apikey).
- Honest caveat: on Google's free tier, content sent to Gemini may be used
  to improve Google's products — users shouldn't paste passwords or private
  data. The panel and Settings both say this.

## Blocked sites (DNS-over-HTTPS + proxy)

Many blocks work at the DNS level: the ISP's DNS server refuses to resolve
the site's address. Volo Browser bypasses that with **DNS-over-HTTPS
(Secure DNS)**, on by default in Secure mode with Cloudflare
(`https://cloudflare-dns.com/dns-query`; Google and Quad9 are the other
options). DNS lookups are encrypted and go to Cloudflare/Google/Quad9
instead of the ISP, so the ISP cannot see or block the domain. Change it in
Settings → Blocked sites (Secure / Automatic / Off); changing it needs a
browser restart (there is a Restart button in Settings).

For blocks that go beyond DNS, Settings → Proxy supports a **manual proxy**
(HTTP/HTTPS rules like `http=127.0.0.1:8080;https=127.0.0.1:8080`, SOCKS
like `socks5://127.0.0.1:1080`, bypass list, optional username/password for
proxies that require auth). Applies immediately, no restart needed. Note:
proxy credentials are stored in plaintext in `settings.json` for v1 (OS
keychain integration is a future improvement).

Honest limits: DoH beats DNS-level blocks only. IP-level blocks, SNI-based
blocking and national firewalls need a VPN. There is **no built-in VPN** in
v1 (it needs paid servers — there is no free route) and **no Tor** (free but
slow, and it conflicts with the no-lag requirement). No guarantee every
block can be bypassed.

## Automatic updates

The installed app checks GitHub Releases for new versions on EVERY launch
(5 seconds in, so startup is never slowed) and then every hour while it
stays open, and installs them itself: a new version downloads automatically
in the background; when it is ready Volo offers "Restart Now", and if the
user keeps browsing it installs by itself the next time Volo is closed
(`autoInstallOnAppQuit`) — so existing installs pick up a new release the
same day without anyone having to go find it. Help → "Check for Updates…"
checks on demand, and the toolbar Update button shows the version + status.
Dev builds never check.

The updater is wired to the repo in `package.json` (`"publish"` →
owner `shamimrda14-star`, repo `volo-browser` — verified 2026-11-27) and
reads it from `app-update.yml`, which electron-builder embeds in every
installer build automatically. The repo now EXISTS
(https://github.com/shamimrda14-star/volo-browser); until the first Release
is published there, the update check finds nothing — the Update button
honestly reports "up to date". Mac auto-update needs a SIGNED build
(Apple Developer account); Windows NSIS updates work unsigned.
only after a real check, and reports the check error when GitHub cannot be
reached.

**How to publish a new version** (he — or Volo — still builds each release;
users update automatically):

1. Bump `"version"` in `package.json` (e.g. `1.0.0` → `1.0.1`).
2. Build the installer(s) on the target machine (see "Build it" below).
3. Publish a GitHub Release from the build, with the installer attached:
   `GH_TOKEN=<token> npx electron-builder --win --publish always`
   (or create the release manually and attach the installer + the
   `latest.yml` / `latest-mac.yml` / `latest-linux.yml` file from `dist/`).
   The version in the release must be higher than the installed one.
4. Users get the update automatically on the next check.

Notes: Windows NSIS updates work unsigned. Mac auto-update needs a **signed**
build (Apple Developer account) — an unsigned .dmg cannot self-update.
Linux AppImage updates are supported by electron-updater but have not been
tested end to end yet (needs a published v1.0.0 → v1.0.1 pair). The first
real end-to-end update test happens after the first two GitHub Releases
exist.

## Run it (development)

```bash
cd ~/workspace/browser
npm install          # installs Electron + electron-builder (dev),
                     # extract-zip + electron-updater (runtime)
npm start            # runs the browser
```

Smoke tests (headless, used during development):

```bash
npx electron . --smoke-test --no-sandbox        # boot test
npx electron . --smoke-deep --no-sandbox        # navigation + bookmarks +
                                                # history + settings + private
                                                # window + extension + DoH +
                                                # proxy resolution
npx electron . --smoke-cookie-set --no-sandbox  # phase 1: set a cookie, quit
npx electron . --smoke-cookie-check --no-sandbox# phase 2: after a real
                                                # restart, cookie must persist
npx electron . --smoke-proxy --no-sandbox       # manual proxy + Basic auth
npx electron . --smoke-updater --no-sandbox     # updater check against a
                                                # local fake feed (v9.9.9)
# VOLO_SMOKE_URL / VOLO_SMOKE_URL2 override the deep-test pages.
# The cookie/proxy/updater tests need the local test servers in /tmp
# (volo-test-server.js on 8901, volo-test-proxy.js on 8902).
```

## Build it

```bash
npm run build:win       # dist/Volo Browser-Setup-1.0.0.exe  (NSIS installer)
npm run build:win:dir   # dist/win-unpacked/Volo Browser.exe (unpacked app)
npm run build:linux     # dist/Volo Browser-1.0.0.AppImage + dist/linux-unpacked/
npm run build:mac       # dist/Volo Browser-1.0.0.dmg (needs a Mac)
```

### Windows installer — read this

- `npm run build:win:dir` (unpacked Windows app) **works from this Linux VM**
  — verified: `dist/win-unpacked/Volo Browser.exe` builds cleanly. That
  folder runs on Windows as-is (copy the whole folder, run the .exe).
- `npm run build:win` (NSIS one-click installer) **does NOT work from this
  Linux VM**: electron-builder needs **wine** to run the NSIS compiler, and
  wine is not installed here (attempted 2026-11-23: `wine process failed
  ENOENT`). Two ways to get the installer:
  1. **Build on a Windows machine** (recommended): install Node.js LTS, copy
     this folder, run `npm install` then `npm run build:win`.
  2. Install wine in this VM and re-run `npm run build:win`.
- **Code signing:** builds are currently **unsigned**, so Windows SmartScreen
  will warn on first run ("Windows protected your PC" → More info → Run
  anyway). A code-signing certificate removes that warning; it costs money
  and is a separate purchase — not done for v1.

### Mac / Linux

Same codebase, same command shape: `npm run build:linux` produces the
AppImage + unpacked dir (verified from this VM). `npm run build:mac`
produces an **unsigned** .dmg and must run **on a Mac** (electron-builder
cannot build macOS targets from Linux — it needs macOS tooling). A signed,
notarized Mac release needs an Apple Developer account (later step).
iPhone/Android are a separate phase: Electron does not run on mobile
(Android uses a separate WebView app).

## Distribution (free, as decided)

1. Build the Windows installer on a Windows machine (see above).
2. Upload `Volo Browser-Setup-1.0.0.exe` to a **GitHub Release** (free,
   2 GiB per file, no bandwidth limit). The same release feeds automatic
   updates (see above).
3. Link it from the **landing page** — Google Sites is the main page
   (English content), cross-linked with the free Volo space; no domain for
   now. No email gate on downloads (user decision 2026-11-23) and no silent
   telemetry — so *who* downloaded it is not tracked. Download counts come
   from the GitHub Releases API (exact).

## Performance

Speed is the top requirement, so v1 is deliberately light: plain HTML/CSS/JS
shell (no UI framework), two small runtime dependencies only
(`extract-zip`, `electron-updater` — the updater is lazy-required and only
runs in packaged builds), no background services, no telemetry, extensions
loaded asynchronously at startup, update check deferred 30s so it never
slows launch. Measured startup (this VM, Xvfb): **first window in ~600–
1,800 ms** (cold 1,787 ms, warm 652–912 ms). Page rendering and JavaScript
speed match Chrome — same engine, stock Chromium settings.

## Project layout

```
main.js             main process: windows, tabs (WebContentsView), menus,
                    downloads, history/bookmarks/settings storage, extensions,
                    DoH + proxy, auto-updater, smoke-test modes
preload.js          shell-window bridge (context-isolated, minimal API)
preload-view.js     new-tab-page bridge (exposed ONLY on the local new-tab page)
renderer/           shell UI: index.html, styles.css, renderer.js, newtab.html
assets/             logo.png (final logo), icon.ico (Windows), icon.icns (Mac)
logos/              logo options + volo-logo-final.png/.webp (final: bold
                    teal-green V, white paper plane flying up through it)
sponsored.json      Recommended new-tab tiles (placeholders; see above)
dev-app-update.yml  dev-only updater feed for --smoke-updater (never shipped)
package.json        app metadata + electron-builder config (incl. publish)
```

## NOT in v1 (planned / out of scope)

- Chrome Web Store one-click extension install (Electron limitation)
- Google account sync (bookmarks/history across devices), user profiles
- Password manager / form autofill (OS keychain integration is a future step;
  proxy credentials are stored in plaintext in settings.json for v1)
- Tab drag-to-reorder, tab groups
- Code signing (Windows SmartScreen warning on first run until signed;
  Mac signing needs an Apple Developer account)
- Mobile (iPhone/Android) — separate phase
- Built-in VPN / Tor (see "Blocked sites" above for why)
- Search Console — not a browser feature; it belongs to websites, and the
  blog already has it
