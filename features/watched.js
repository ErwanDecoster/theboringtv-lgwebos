// watched feature - uses window.TV (see README "Feature files").
// "Seen it?": after you open a title from this screen and come back later, asks whether you watched it. Also the "Recently finished" row
// and the optional import file (seen-import.js, made by tools/import-viewing-activity.mjs).
(function () {
  var TV = window.TV, esc = TV.esc;
  var MIN_MS = 15 * 60e3, MAX_MS = 24 * 3600e3;   // away for at least 15 min (else you probably did not watch), asked within a day
  var box = TV.el('div'), cur = null;
  box.id = 'seenit'; box.hidden = true;
  document.body.appendChild(box);

  TV.addSetting({key: 'askSeen', title: 'Ask if I watched a title', hint: 'After you open a title and come back later, asks whether you saw it. Seen titles are never suggested again',
    opts: [[true, 'On'], [false, 'Off']]}, true);

  // ---------- what was opened ----------
  TV.onOpened = function (it) {
    if (!it.tmdb || it.src === 'YouTube') return;
    TV.store('pending', {title: it.title, img: it.img, bg: it.bg, blur: it.blur, src: it.src, sub: it.sub, meta: it.meta, tmdb: it.tmdb, at: Date.now()});
  };

  // ---------- the question ----------
  function done() { TV.store('pending', null); }
  function answer(how) {
    var it = cur; cur = null;
    if (how === 'yes') { TV.seen.mark(it, true); TV.toast('Marked as seen'); }
    else if (how === 'no') { TV.seen.skip(it, true); TV.toast('We won’t suggest it again'); }
    if (how !== 'later') done();
    TV.closeView();
  }
  function btn(label, how) { var b = TV.el('span', 'dbtn f', label); b.onok = function () { answer(how); }; return b; }
  function render(it) {
    cur = it;
    box.innerHTML = '<img class="dbg" alt="" decoding="async"' + (it.bg ? ' src="' + esc(it.bg) + '"' : '') + '><div class="dshade"></div>' +
      '<div class="dbody"><div class="dsrc">Seen it?</div><h1>' + esc(it.title) + '</h1>' +
      '<p class="tsub">You opened it a while ago. Did you watch it?</p><div class="dbtns"></div></div>';
    var b = box.querySelector('.dbtns');
    b.appendChild(btn('✓ Yes, I saw it', 'yes')); b.appendChild(btn('Not finished', 'part'));
    b.appendChild(btn('✕ Not interested', 'no')); b.appendChild(btn('Ask me later', 'later'));
    if (window.I18N) window.I18N.done(box);
  }
  TV.addView('seenit', {
    nav: function () { return [[].slice.call(box.querySelectorAll('.dbtns .f'))]; },
    show: function (it) { render(it); box.hidden = false; },
    hide: function () { box.hidden = true; box.innerHTML = ''; cur = null; },
    back: function () { answer('later'); }
  });

  function check() {
    if (TV.S.askSeen === false || document.hidden || TV.view() !== 'home') return;
    var p = TV.store('pending');
    if (!p || !p.tmdb) return;
    var away = Date.now() - p.at;
    if (away > MAX_MS || TV.seen.has(p) || TV.seen.skipped(p)) return done();
    if (away < MIN_MS) return;
    TV.openView('seenit', p);
  }
  document.addEventListener('visibilitychange', function () { if (!document.hidden) setTimeout(check, 800); });
  setTimeout(check, 4000);                       // the page may have been restarted while you were away

  // ---------- the row ----------
  TV.addRow(function () { var l = TV.seen.list(); return l.length ? {title: 'Recently finished', items: l.slice(0, 20)} : null; });

  // ---------- import file ----------
  // seen-import.js: window.SEEN_IMPORT = {id, items: [["movie:603", 1700000000000], ...]}; read once per file (by its id), kept as plain keys
  var s = document.createElement('script');
  s.src = 'seen-import.js';
  s.onload = function () {
    var imp = window.SEEN_IMPORT;
    if (!imp || !imp.id || !imp.items) return;
    try { if (localStorage.seenImportId === imp.id) return; } catch (e) { return; }
    var map = {}; imp.items.forEach(function (x) { map[x[0]] = x[1]; });
    var n = TV.seen.merge(map);
    try { localStorage.seenImportId = imp.id; } catch (e) { /* storage unavailable: imported again next time */ }
    if (n) TV.toast(n + ' titles imported as seen');
  };
  s.onerror = function () { /* no import file: normal */ };
  document.head.appendChild(s);
})();
