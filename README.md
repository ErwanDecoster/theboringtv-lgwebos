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

## Make it the real home screen (rooted TVs)
On a TV rooted with the [Homebrew Channel](https://github.com/webosbrew/webos-homebrew-channel), there are two options.
Both live in `service/`, are packaged with the app, and change no files on disk.

**Replace LG's home (recommended).** `service/as-home.sh` runs early at every boot. It copies TV Home into RAM, gives
the copy LG home's app id (`com.webos.app.home`), bind-mounts it over LG's home, and restarts the app manager so it
picks the copy up. webOS then opens TV Home wherever it would open LG's home: the Home button, Back from an app, and
startup (the script also opens it at boot, so the TV no longer starts on the Live TV no-signal screen).
```bash
ares-package . service -e service -e docs -e .git -o /tmp --no-minify
```
```bash
ares-install --device tvroot /tmp/com.boring.tvhome_*.ipk
```
```bash
ssh root@<tv-ip> 'ln -sf /media/developer/apps/usr/palm/services/com.boring.tvhome.service/as-home.sh /var/lib/webosbrew/init.d/40-tvhome-as-home && reboot'
```
Undo: `rm /var/lib/webosbrew/init.d/40-tvhome-as-home` and restart the TV. The running copy is TV Home as it was
at the last boot, so restart after updating TV Home. TV Home running as the home app keeps its own settings and
history, separate from the regular TV Home app.

**Or watch the Home key.** `service/service.js` reads the remote without grabbing it and opens TV Home after each Home
press, at startup and after standby. LG's home still flashes briefly and Back from apps still goes to LG's home.
```bash
ssh root@<tv-ip> 'D=/media/developer/apps/usr/palm/services/com.boring.tvhome.service; ln -sf $D/autostart.sh /var/lib/webosbrew/init.d/50-tvhome && sh $D/autostart.sh'
```
Use one option, not both. `HOME_CODE` in `service/service.js` is 773 on LG Magic Remotes; raise `HOME_DELAYS` if
LG's home still covers TV Home.

## Limits
- Without root it's an app, not the system launcher: the Home button opens LG's home.
- webOS still shows a short splash (TV Home's own dark one) when it has to start TV Home from scratch.
- Netflix and Hotstar titles open the app, not the exact show, because their deep links need internal IDs that
  TMDB doesn't have. YouTube videos do open directly.
- The app can't read LG Channels' channel list or Netflix/Hotstar watch history.

## Credits
App icons in `icons/`, the webOS launch approach and the Home-button service in `service/` come from
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
