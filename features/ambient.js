// ambient feature - uses window.TV (see README "Feature files").
// Screensaver: after S.ambient minutes without input, a Ken-Burns slideshow of backdrops with clock + title.
(function () {
  var TV = window.TV;
  TV.addSetting({key: 'ambient', title: 'Ambient mode', hint: 'Slideshow when idle',
    opts: [[0, 'Off'], [2, '2 min'], [5, '5 min'], [10, '10 min']]}, 5);

  var root = TV.el('div', '', '<img alt=""><img alt=""><div class="amb-clock"><b></b><div class="amb-sub"><span class="amb-date"></span><span class="amb-wx"></span></div></div>' +
    '<div class="amb-title"><b></b><span></span></div>');
  root.id = 'ambient'; root.hidden = true;
  document.body.appendChild(root);
  var imgs = root.querySelectorAll('img'), clockEl = root.querySelector('.amb-clock b'), dateEl = root.querySelector('.amb-date'), wxEl = root.querySelector('.amb-wx'), cap = root.querySelector('.amb-title');

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
  function show() {
    if (on) return true;
    list = collect(); if (!list.length) return false;   // nothing sharp enough to show yet
    on = true; cur = null; shownAt = Date.now(); idx = 0;
    tick(); tickT = setInterval(tick, 10000);
    root.hidden = false; void root.offsetWidth; root.classList.add('show');
    slide();
    return true;
  }
  function hide() {
    if (!on) return;
    on = false; clearTimeout(slideT); clearInterval(tickT);
    root.classList.remove('show');
    setTimeout(function () { if (!on) { root.hidden = true; imgs[0].className = imgs[1].className = ''; } }, 600);
  }
  TV.ambientNow = show;

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
  document.addEventListener('visibilitychange', function () { last = Date.now(); if (document.visibilityState !== 'visible') hide(); });
})();
