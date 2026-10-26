// ambient feature - uses window.TV (see README "Feature files").
// Screensaver: after S.ambient minutes without input, a Ken-Burns slideshow of backdrops with clock + title.
(function () {
  var TV = window.TV;
  TV.addSetting({key: 'ambientDim', title: 'Idle screen dimming', hint: 'A veil that darkens the idle screen more and more, to spare the OLED pixels. Light, Standard or Strong sets how dark it gets',
    opts: [['light', 'Light'], ['std', 'Standard'], ['strong', 'Strong']]}, 'std');
  TV.addSetting({key: 'ambient', title: 'Ambient mode', hint: 'Slideshow when idle',
    opts: [[0, 'Off'], [2, '2 min'], [5, '5 min'], [10, '10 min']]}, 5);

  var root = TV.el('div', '', '<img alt=""><img alt=""><div class="amb-clock"><b></b><div class="amb-sub"><span class="amb-date"></span><span class="amb-wx"></span></div></div>' +
    '<div class="amb-title"><b></b><span></span></div><div class="amb-dim"></div>');
  root.id = 'ambient'; root.hidden = true;
  document.body.appendChild(root);
  var dimEl = root.querySelector('.amb-dim'), clockBox = root.querySelector('.amb-clock'), titleBox = root.querySelector('.amb-title'), imgs = root.querySelectorAll('img'), clockEl = root.querySelector('.amb-clock b'), dateEl = root.querySelector('.amb-date'), wxEl = root.querySelector('.amb-wx'), cap = root.querySelector('.amb-title');

  var on = false, cur, shownAt = 0, last = Date.now(), list = [], idx = 0, flip = 0, slideT, tickT, pre;

  // Everything the home screen has rendered: hero + cards (they carry .item), but only the titles with a sharp full-screen picture (TV.fullBg, see MIN_FULL in app.js).
  function collect() {
    var seen = {}, out = TV.heroItems().concat([].map.call(document.querySelectorAll('.card'), function (c) { return c.item; }));
    out = out.filter(function (it) {
      if (!it || !it.bg || it.src === 'YouTube' || seen[it.title] || !TV.fullBg(it)) return false;
      return (seen[it.title] = true);
    });
    for (var i = out.length - 1; i > 0; i--) { var j = Math.random() * (i + 1) | 0, t = out[i]; out[i] = out[j]; out[j] = t; }
    return out;
  }
  function tick() {
    var d = new Date(), h = d.getHours();
    clockEl.textContent = (TV.S.clock24 ? ('0' + h).slice(-2) : h % 12 || 12) + ':' + ('0' + d.getMinutes()).slice(-2);
    var date = d.toLocaleDateString(window.UI_LOCALE || 'en-US', {weekday: 'long', month: 'long', day: 'numeric'});   // "vendredi 23 octobre" / "Friday, October 23"
    dateEl.textContent = date.charAt(0).toUpperCase() + date.slice(1);
    var w = document.getElementById('weather');   // the weather of the top bar (icon and temperature), when it is on
    wxEl.innerHTML = w && !w.hidden ? w.innerHTML : '';
  }
  function pic(it) { return TV.fullBg(it); }   // TMDB's full-size file, or the 1280 one when Settings → Picture quality says Standard
  function slide() {
    var it = list[idx % list.length], img = imgs[flip], old = imgs[1 - flip];
    img.onload = function () {
      if (!on) return;
      img.className = ''; void img.offsetWidth; // restart the Ken-Burns animation
      img.className = 'on kb' + (idx % 4);
      old.classList.remove('on');
      setTimeout(function () { if (!old.classList.contains('on')) old.removeAttribute('src'); }, 2500);   // faded out: its decoded 4K bitmap (~32 MB) is let go
      cur = it; cap.firstChild.textContent = it.title;
      cap.lastChild.textContent = it.svc ? 'On ' + it.svc.name : it.src || '';
      flip = 1 - flip; idx++;
      var next = list[idx % list.length]; pre = new Image(); pre.src = pic(next); // preload only the next one
      slideT = setTimeout(slide, 12000);
    };
    var src = pic(it);
    img.onerror = function () {
      if (/\/original\//.test(src)) { src = src.replace('/original/', '/w1280/'); img.src = src; return; }   // the full-size picture did not come: the 1280 one of the same art
      idx++; slideT = setTimeout(slide, 500);
    };
    img.src = src;
  }
  // ---------- dimming ----------
  // What wears an OLED is how bright its pixels are and for how long: a black veil over the whole idle screen (pictures and texts alike) lowers the light of every lit pixel,
  // and gets darker the longer the screen stays on. (LG's screensaver lowers the panel's luminance through an undocumented call of the picture service, whose parameters are
  // not published: they are not guessed here.) Settings → Idle screen dimming: Light / Standard / Strong set the darkest level; the share of it grows in steps.
  var DIM_MAX = {light: .45, std: .72, strong: .85};
  var DIM_STEPS = [[0, .42], [60e3, .62], [300e3, .82], [1200e3, 1]];   // after ms, share of the darkest level
  var dimT = 0;
  function dimTarget(ms) {
    var max = DIM_MAX[TV.S.ambientDim] || DIM_MAX.std, share = DIM_STEPS[0][1];
    DIM_STEPS.forEach(function (s) { if (ms >= s[0]) share = s[1]; });
    return +(max * share).toFixed(2);
  }
  function dimNow() { dimEl.style.opacity = dimTarget(Date.now() - shownAt); }
  TV.ambientDimTarget = dimTarget; TV.ambientDimNow = dimNow;      // (for tests)

  // ---------- slow random drift ----------
  // On an OLED nothing should stay on the same pixels for hours: the clock block (time, date, weather) and the title block shift a little, at random, so the strokes of the
  // texts do not always light the same pixels. A few dozen pixels are enough for that, so it stays in a small zone, and the two blocks move together: ONE random offset
  // (dx, dy) for both, the left block by (dx, dy) and the right block by (-dx, dy), so they keep the same margins from the edges and stay on the same line. The move itself is
  // far too slow to be seen (a few tenths of a pixel per second) and followed by a long rest, never a cycle: each point is drawn at random, at least 24 px from the previous one, and the
  // last one is kept (localStorage "ambDrift2") so the next time starts from there.
  var ZONE = {x: [0, 56], y: [-36, 0], minStep: 24};                  // px; dx grows to the right for the left block and to the left for the right one
  var MOVE_MS = [150000, 300000], REST_MS = [120000, 300000];            // how long a move takes, how long it rests after it
  var pos = loadDrift(), driftT = 0;
  function loadDrift() {
    try { var d = JSON.parse(localStorage.getItem('ambDrift2')); if (d && isFinite(d.x) && isFinite(d.y)) return {x: Math.min(Math.max(d.x, ZONE.x[0]), ZONE.x[1]), y: Math.min(Math.max(d.y, ZONE.y[0]), ZONE.y[1])}; } catch (e) { /* none yet */ }
    return {x: 0, y: 0};
  }
  function rnd(a, b) { return a + Math.random() * (b - a); }
  function pick(from) {
    var p;
    for (var i = 0; i < 12; i++) {
      p = {x: Math.round(rnd(ZONE.x[0], ZONE.x[1])), y: Math.round(rnd(ZONE.y[0], ZONE.y[1]))};
      if (Math.sqrt(Math.pow(p.x - from.x, 2) + Math.pow(p.y - from.y, 2)) >= ZONE.minStep) break;
    }
    return p;
  }
  function place(el, p, ms) { el.style.transition = ms ? 'transform ' + ms + 'ms ease-in-out' : 'none'; el.style.transform = 'translate3d(' + p.x + 'px,' + p.y + 'px,0)'; }
  function apply(p, ms) { place(clockBox, {x: p.x, y: p.y}, ms); place(titleBox, {x: -p.x, y: p.y}, ms); }
  function wander() {
    pos = pick(pos);
    var ms = Math.round(rnd(MOVE_MS[0], MOVE_MS[1]));
    apply(pos, ms);
    try { localStorage.setItem('ambDrift2', JSON.stringify(pos)); } catch (e) { /* storage unavailable: starts from the corners next time */ }
    driftT = setTimeout(wander, ms + rnd(REST_MS[0], REST_MS[1]));      // then a long rest, and no fixed rhythm
  }
  TV.ambientWander = wander;      // (for tests)
  TV.ambientDrift = function () { return pos; };
  TV.ambientZone = function () { return ZONE; };

  function show() {
    if (on) return true;
    list = collect(); if (!list.length) return false;   // nothing sharp enough to show yet
    on = true; cur = null; shownAt = Date.now(); idx = 0;
    tick(); tickT = setInterval(tick, 10000);
    root.hidden = false; void root.offsetWidth; root.classList.add('show');
    dimEl.style.transition = 'none'; dimEl.style.opacity = dimTarget(0);
    clearInterval(dimT); dimT = setInterval(dimNow, 20000);                                 // each step is reached slowly (see the stylesheet), never as a jump
    apply(pos, 0);                                                   // where they were the last time, not back at the corners
    clearTimeout(driftT); driftT = setTimeout(wander, rnd(30000, 90000));
    slide();
    return true;
  }
  function hide() {
    if (!on) return;
    on = false; clearTimeout(slideT); clearInterval(tickT); clearTimeout(driftT); clearInterval(dimT);
    root.classList.remove('show');
    setTimeout(function () { if (!on) { root.hidden = true; imgs[0].className = imgs[1].className = ''; imgs[0].removeAttribute('src'); imgs[1].removeAttribute('src'); pre = null; } }, 600);   // hidden: both pictures are let go (~64 MB of decoded pixels)
  }
  TV.ambientNow = show;

  // ---------- instead of LG's screensaver ----------
  // In front of another app (or with TV Home behind it), LG's screensaver is what would start. On a rooted TV the helper service refuses that request and launches TV Home with
  // {ambient: true}: this page then shows its idle screen. And the helper is told, now and after each change of Settings → Ambient mode, whether it should do that (not when Off).
  function tellHelper(path, body) {
    if (!TV.onTV) return Promise.resolve(null);
    try {
      return fetch('http://127.0.0.1:45621' + path, {method: 'POST', body: JSON.stringify(body || {})}).then(function (r) { return r.json(); }).catch(function () { return null; });   // no helper: LG's screensaver stays
    } catch (e) { return Promise.resolve(null); }
  }
  // The light idle screen (ambient/, an app of its own: see tools/tv-service) cannot know the home screen's pictures, so they go to the helper along with the setting, each with
  // its title (a plain copy: OK on one there opens its page, and TV Home, often closed by the system in the meantime, starts cold and knows nothing).
  // The ~60 KB list is only built and sent when it changed: each sync sends the setting and a short signature of the list, and the helper answers "need" when it holds no list
  // or another one (it was restarted, or the home screen changed).
  function plain(it) { try { return JSON.parse(JSON.stringify(it)); } catch (e) { return null; } }
  function entry(it) { return {img: pic(it), title: it.title, sub: it.svc ? 'On ' + it.svc.name : it.src || ''}; }
  function sigOf(l, head) {                                   // order-free (the list is shuffled at each collect), so an unchanged home screen gives the same signature
    var s = head + l.map(function (it) { var e = entry(it); return e.img + '\n' + e.title + '\n' + e.sub; }).sort().join('\n'), h = 5381;
    for (var i = 0; i < s.length; i++) h = (h * 33 + s.charCodeAt(i)) | 0;
    return (h >>> 0).toString(36) + '.' + l.length;
  }
  function payload(l) {
    var w = document.getElementById('weather');
    return {rev: Date.now(), clock24: !!TV.S.clock24, locale: window.UI_LOCALE || 'en-US', dim: TV.S.ambientDim || 'std', weather: w && !w.hidden ? w.innerHTML : '',
      items: l.slice(0, 40).map(function (it) { var e = entry(it); e.it = plain(it); return e; })};
  }
  function syncHelper() {
    var on = +TV.S.ambient > 0;
    if (!on) return void tellHelper('/ambient', {on: false});
    var l = collect();
    if (!l.length) return void tellHelper('/ambient', {on: true});
    var w = document.getElementById('weather');
    var sig = sigOf(l, [!!TV.S.clock24, window.UI_LOCALE || 'en-US', TV.S.ambientDim || 'std', w && !w.hidden ? w.innerHTML : ''].join('|') + '\n');
    tellHelper('/ambient', {on: true, sig: sig}).then(function (r) {
      if (r && r.need) tellHelper('/ambient', {on: true, sig: sig, data: payload(l)});
    });
  }
  window.addEventListener('tvsettings', syncHelper);
  setTimeout(syncHelper, 3000); setTimeout(syncHelper, 20000); setTimeout(syncHelper, 60000); setInterval(function () { if (document.visibilityState === 'visible') syncHelper(); }, 2 * 60e3);           // again from time to time (the helper forgets everything when it restarts); a hidden page cannot have changed
  function launchParams() {
    var raw; try { raw = window.PalmSystem && window.PalmSystem.launchParams; } catch (e) { return null; }
    if (!raw) return null;
    var p; try { p = typeof raw === 'string' ? JSON.parse(raw) : raw; } catch (e) { return null; }
    return p && Date.now() - (p.at || 0) < 20000 ? p : null;                // recent: a stale parameter must not start it on every later relaunch
  }
  function launchedForAmbient() { var p = launchParams(); return !!(p && p.ambient); }
  var opened = 0;
  function openFromAmbient() {                                               // OK on a title of the light idle screen
    var p = launchParams();
    if (!p || !p.ambientOpen || !p.item || p.at === opened) return;
    opened = p.at;
    setTimeout(function () { TV.itemDetails(p.item); }, 600);                 // after a cold start the home screen is still being drawn
  }
  function startForLaunch() {
    openFromAmbient();
    if (!launchedForAmbient()) return;
    var tries = 0;
    (function again() {
      if (show()) return;                                                      // up
      if (++tries < 15) setTimeout(again, 800);                                // the pictures may not be known yet at a cold start
      else tellHelper('/ambient/failed');                                      // never: LG's screensaver is let through rather than a still screen
    })();
  }
  setTimeout(startForLaunch, 600);
  document.addEventListener('webOSRelaunch', function () { setTimeout(startForLaunch, 200); });

  // Input tracking (capture phase on window runs before the core's document listeners).
  // OK on the remote opens the details page of the title on screen (the first 1.5 s excepted: the title that has just come up is not the one you meant). With the
  // Magic Remote pointer OK is a mouse click, not a key: the press wakes the screen, and the rest of that same click (mouseup, click) is swallowed so it does not land on
  // whatever is under the pointer; the details page opens on the click itself.
  var eatUntil = 0, opener = null;
  function openCur(it) { if (it) TV.itemDetails(it); }
  function input(ev) {
    last = Date.now();
    if (eatUntil && last < eatUntil && (ev.type === 'mouseup' || ev.type === 'click')) {   // the end of the press that woke the screen
      ev.stopImmediatePropagation(); ev.preventDefault();
      if (ev.type === 'click') { eatUntil = 0; var it = opener; opener = null; openCur(it); }
      return;
    }
    if (!on) return;
    if (ev.type === 'mousemove' && last - shownAt < 800) return; // ignore the jitter right as it appears
    ev.stopImmediatePropagation(); ev.preventDefault();
    var pick = cur && Date.now() - shownAt > 1500 ? cur : null;
    hide();
    if (ev.type === 'keydown' && ev.keyCode === 13 && !ev.repeat) openCur(pick);
    else if (ev.type === 'mousedown') { eatUntil = last + 900; opener = pick; }
    else if (ev.type === 'click') openCur(pick);   // a click on its own (no press seen)
  }
  ['keydown', 'keyup', 'click', 'mousedown', 'mouseup', 'wheel', 'mousemove'].forEach(function (t) {
    window.addEventListener(t, input, {capture: true, passive: false});
  });
  setInterval(function () {
    if (+TV.S.ambient && document.visibilityState === 'visible' && Date.now() - last > TV.S.ambient * 60000) show();
  }, 10000);
  document.addEventListener('visibilitychange', function () { last = Date.now(); if (document.visibilityState !== 'visible') hide(); else syncHelper(); });
})();
