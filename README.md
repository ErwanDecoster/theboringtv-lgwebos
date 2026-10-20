# TheBoringTV for LG webOS

A Google TV-style home screen for LG webOS TVs. It's a plain HTML/CSS/JS web app with no build step.

Built and tested on an LG 55UR8040 (webOS 25, SDK 10.3, Chromium 120) at 1920x1080. Works with the arrow keys,
OK and Back, the Magic Remote pointer, and the scroll wheel.

![Home screen with the featured title and Top picks](docs/screenshots/01-home.jpg)

| Rows with a blurred background | Details page with where to watch |
|:---:|:---:|
| ![Popular on Netflix, JioHotstar and Prime Video rows](docs/screenshots/02-rows.jpg) | ![Details page with Watch, Trailer and Watchlist buttons](docs/screenshots/03-details.jpg) |
| **Search across services** | **Quick settings** |
| ![Search with on-screen keyboard and where-to-watch labels](docs/screenshots/04-search.jpg) | ![Quick settings side panel](docs/screenshots/05-quick-settings.jpg) |
| **Settings** | **Profiles** |
| ![Settings panel with country, languages and services](docs/screenshots/06-settings.jpg) | ![Who's watching profile picker](docs/screenshots/07-profiles.jpg) |
| **Ambient mode** | |
| ![Ambient mode slideshow with clock](docs/screenshots/08-ambient.jpg) | |

## Features
- **Hero and rows:** full-screen featured titles, "Top picks", "Popular on Netflix / JioHotstar / Prime Video" and
  "Trending on YouTube", using [TMDB](https://www.themoviedb.org/) and the YouTube Data API.
- **Where to watch:** pressing OK on a title opens a details page with "Watch on …" buttons for the services that
  stream it in your country, a trailer, cast and "More like this".
- **Watchlist, Continue watching:** both saved on the TV. Netflix and Hotstar don't share watch history, so
  Continue watching lists the titles you opened from this home screen.
- **Search across services:** an on-screen keyboard; each result shows where it's streaming.
- **Your apps:** checks a list of known apps (webOS won't list installed apps to non-system apps) and opens them.
- **Settings:** country, recommendation languages (pick several), which services get rows, clock, and more.
- **Quick settings panel:** Wi-Fi, audio output, Bluetooth, volume, screensaver and inputs.
- **Profiles:** each has its own settings, watchlist and history, plus a kids profile.
- **Ambient mode:** a slideshow of artwork with the clock when the TV is idle.

## Setup
1. Copy `keys.example.js` to `keys.js` and add a free TMDB API key and a YouTube Data API v3 key.
   `keys.js` is gitignored.
2. Set your region, services and apps in `config.js`.
3. Preview it in a browser:
   ```bash
   python3 -m http.server 8765
   ```
   Then open http://localhost:8765 in a 1920x1080 window. Use the arrow keys, Enter, and Esc (Esc acts as Back).

## Install on the TV
Turn on LG's Developer Mode (or use a rooted TV), install the [webOS CLI](https://www.npmjs.com/package/@webos-tools/cli),
and add your TV with `ares-setup-device`. Then:
```bash
ares-package . -o /tmp --no-minify
```
```bash
ares-install --device tv /tmp/com.boring.tvhome_*.ipk
```
```bash
ares-launch --device tv com.boring.tvhome
```
Developer Mode installs expire after 50 hours unless you extend them in the Developer Mode app.

## Limits
- It's an app, not the system launcher. The Home button still opens LG's home unless the TV is rooted and runs a
  Home-button service; this repo doesn't include one yet.
- Netflix and Hotstar titles open the app, not the exact show, because their deep links need internal IDs that
  TMDB doesn't have. YouTube videos do open directly.
- The app can't read LG Channels' channel list or Netflix/Hotstar watch history.

## Credits
App icons in `icons/` and the webOS launch approach come from
[zzeppieri/webos-custom-home](https://github.com/zzeppieri/webos-custom-home) (MIT licence). Title data and images
come from TMDB; this product uses the TMDB API but is not endorsed or certified by TMDB.

## Feature files
Each feature lives in `features/<name>.js` + `features/<name>.css` and only talks to the core through `window.TV`
(defined at the end of `app.js`). `profiles.js` loads *before* `app.js`; the others load after it.

| API | What it does |
|---|---|
| `TV.addView(name, {nav, show, hide, onFocus?, back?, keydown?})` | Full-screen/overlay screen. `nav()` returns rows of focusable elements (give them class `f`; focused one gets `.focus`). Arrow keys, OK, pointer and wheel then work automatically. `back()` overrides Back (default: `TV.closeView()`). `keydown(ev)` runs first on every key while the view is open; return `true` to swallow it. |
| `TV.openView(name, arg)` / `TV.closeView()` | Push / pop a view; closing restores the previous focus. |
| `TV.rebuild(r?, c?)` | Re-read `nav()` after the view's content changes (optionally move focus). |
| `TV.addTab(label, viewName)` | Adds a top-bar tab that opens a view. |
| `TV.addRow(fn)` + `TV.refresh()` | `fn()` returns `{title, items}` or `null`; shown after Continue watching. |
| `TV.itemOk = fn(item)` | Called on OK for any title card / hero. Default `TV.openItem(item)` (open the service). |
| `TV.onAvatar = fn()` | What the avatar does (default: quick settings panel). |
| `TV.addSetting(row, default)` | Adds a row to the Settings panel: `{key, title, hint?, many?, opts: [[value, label]…]}`. Value lands in `TV.S[key]`. |
| `TV.tmdb(path, q)`, `TV.get(url)`, `TV.fromTmdb(m, svc?)`, `TV.svcFor(providerName)` | Data helpers. Items look like `{title, sub, meta, img, bg, blur, src, svc, tmdb: {type, id}}`. |
| `TV.launch(appId, params)`, `TV.luna(uri, params)`, `TV.toast(msg)`, `TV.card(item)`, `TV.el`, `TV.esc` | UI / system helpers. |
| `TV.store(key[, value])` | Per-profile JSON storage. |
| `TV.heroItems()`, `TV.view()`, `TV.idleSince()`, `TV.setBg(url)`, `TV.S`, `TV.C`, `TV.LANGS`, `TV.IMG` | State. |
| `window.TV_PROFILE = {prefix, name, color, extraQ, hideApps}` | Set by `profiles.js` before `app.js` runs: storage prefix, avatar, extra TMDB discover query (e.g. kids certification), app ids to hide. |
| `tvready` event on `window` | Fired once `window.TV` exists (for `profiles.js`, which loads first). |
