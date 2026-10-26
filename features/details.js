// details feature - uses window.TV (see README "Feature files").
// OK on a title opens a full-screen details page (where to watch, trailer, watchlist, more like this).
(function () {
  var TV = window.TV, esc = TV.esc;
  var box = TV.el('div'), stack = [], origin = null;
  box.id = 'details'; box.hidden = true;
  document.body.appendChild(box);
  // The page is redrawn whenever its content changes (opened, then the data arrives, then a buttons change): its background must not be, or the picture would be
  // replaced each time. Two layers of their own sit under the page; a new picture is put on the idle layer and fades in (opacity only) over the one already there.
  var bgs = TV.el('div', 'dbgs'), L = [TV.el('div', 'dbgl'), TV.el('div', 'dbgl')], page = TV.el('div', 'dpage'), front = -1, shownKey = '', askedKey = '', seq = 0;
  L.forEach(function (w) { bgs.appendChild(w); });
  box.appendChild(bgs); box.appendChild(page);
  // instant: no fade (a page opened from the home screen has nothing under it yet: the first picture must be there at once, not fade in from black)
  function showLayer(node, key, my, instant) {
    if (my !== seq) return;                       // another title was asked for meanwhile
    var bi = front === 0 ? 1 : 0, back = L[bi], cur = front >= 0 ? L[front] : null;
    back.style.transition = 'none'; back.classList.remove('on'); back.style.zIndex = 1; if (cur) cur.style.zIndex = 0;   // the idle layer is under the shown one: resetting it is invisible
    back.textContent = ''; node.className = 'dbg'; back.appendChild(node);
    void back.offsetWidth; back.style.transition = instant ? 'none' : ''; back.classList.add('on');
    front = bi; shownKey = key;
  }
  var sharpFor = 0, lastIt = null;                // sharpFor: the request whose sharp picture is already up (a late blurred one must not replace it)
  function blurPut(it, my, instant) {
    return TV.blurredBg(it).then(function (k) {
      if (sharpFor === my || my !== seq || shownKey === 'blur:' + it.blur) return;
      showLayer(k, 'blur:' + it.blur, my, instant);
    }, function () { /* no picture at all for this title */ });
  }
  // The sharp picture if the title has one (see MIN_FULL in app.js), else its art blurred. What is already on screen stays until the new picture is ready.
  // On a fresh page (opened from the home screen) the blurred art goes up at once, never a bare dark page, and the sharp picture fades in over it when it is ready;
  // The page is redrawn several times for one title (opened, data arrived, a button changed):
  // only a different title cancels what is pending, the same one asking again does not, or each redraw would restart the wait.
  function setBg(it) {
    if (it !== lastIt) { lastIt = it; seq++; sharpFor = 0; }
    var my = seq, url = TV.fullBg(it), key = url || 'blur:' + (it.blur || '');
    if (key === shownKey || key === askedKey) return;
    askedKey = key;
    var fresh = front < 0;
    if (!url) return blurPut(it, my, fresh);
    // Always the blurred art first when the page is fresh, at once, whatever state the sharp picture is in: loaded is not decoded, and a 4K picture that has arrived
    // but is not decoded yet paints nothing (a dark page) for a moment. The sharp picture fades in over the blur once it is decoded.
    var blurUp = fresh ? blurPut(it, my, true) : Promise.resolve();   // the sharp one waits for it, so it always fades in over the blur and never from a dark page
    var im = new Image();
    im.alt = ''; im.decoding = 'async';
    im.src = url;
    var decoded = im.decode ? im.decode() : new Promise(function (ok, no) { im.onload = ok; im.onerror = no; });
    decoded.then(function () { return blurUp; }).then(function () { sharpFor = my; showLayer(im, key, my, false); }, function () { blurPut(it, my, front < 0); });
  }
  function clearBg() { seq++; front = -1; shownKey = ''; askedKey = ''; lastIt = null; L.forEach(function (w) { w.style.transition = 'none'; w.classList.remove('on'); w.textContent = ''; }); }

  // ---------- watchlist ----------
  var list = TV.store('watchlist') || [];
  function inList(it) { return list.some(function (x) { return x.tmdb.id === it.tmdb.id && x.tmdb.type === it.tmdb.type; }); }
  var wlListeners = [];
  // quiet: a change that comes from outside (Trakt) must not be sent back
  function put(it, on, quiet) {
    if (on === inList(it)) return false;
    list = list.filter(function (x) { return !(x.tmdb.id === it.tmdb.id && x.tmdb.type === it.tmdb.type); });
    if (on) list.unshift({title: it.title, sub: it.sub, meta: it.meta, img: it.img, bg: it.bg, blur: it.blur, src: it.src, svc: it.svc, tmdb: it.tmdb});
    TV.store('watchlist', list);
    if (!quiet) wlListeners.forEach(function (fn) { try { fn(it, on); } catch (e) { /* a listener must not break the screen */ } });
    TV.refresh();
    return true;
  }
  function toggle(it) {
    var on = !inList(it);
    put(it, on);
    TV.toast(on ? 'Added to your watchlist' : 'Removed from your watchlist');
    return on;
  }
  TV.watchlist = {list: function () { return list; }, has: inList, put: put, onChange: function (fn) { wlListeners.push(fn); }};
  TV.addRow(function () { return list.length ? {title: 'My watchlist', items: list} : null; });

  // ---------- data ----------
  // One big TMDB call (credits with the whole crew, every country's providers, every backdrop, recommendations) was awaited before anything but "Loading…" showed.
  // Now two small ones run in parallel and the page paints from the first: A = what the buttons need (overview, runtime, genres, where to watch, trailer),
  // B = the decoration (cast, "More like this"), filled in without redrawing the page. The pictures list is TV.refineBest's own call, skipped when the title is already known.
  var mem = {}, order = [], MEM_MAX = 40;            // mem[k] = {a, b, pa, pb}: the slimmed answers, then the pending requests
  var DISK = 'detailsA.v1', DISK_TTL = 6 * 3600e3, DISK_MAX = 40, disk = null, diskTimer = 0;
  function key(it) { return it.tmdb.type + '/' + it.tmdb.id; }
  function entry(k) {
    if (!mem[k]) { mem[k] = {}; order.push(k); if (order.length > MEM_MAX) delete mem[order.shift()]; }   // the TV has no memory to spare: the oldest go
    return mem[k];
  }
  // a request that cannot stall the page: a slow or silent connection fails after `ms`
  function timed(p, ms) {
    return new Promise(function (ok, no) {
      var t = setTimeout(function () { no(new Error('timeout')); }, ms);
      p.then(function (v) { clearTimeout(t); ok(v); }, function (e) { clearTimeout(t); no(e); });
    });
  }
  function provs(a) { return (a || []).map(function (p) { return {provider_name: p.provider_name}; }); }
  // keep only what render uses (a full answer is ~100 KB of JSON)
  function slimA(d) {
    var reg = ((d['watch/providers'] || {}).results || {})[TV.C.REGION] || {}, res = {}, tr = ((d.videos || {}).results || []).filter(function (v) { return v.site === 'YouTube' && v.type === 'Trailer'; })[0];
    res[TV.C.REGION] = {flatrate: provs(reg.flatrate), ads: provs(reg.ads), free: provs(reg.free), rent: provs(reg.rent), buy: provs(reg.buy)};
    return {overview: d.overview, runtime: d.runtime, number_of_seasons: d.number_of_seasons, genres: (d.genres || []).slice(0, 3).map(function (g) { return {name: g.name}; }),
      'watch/providers': {results: res}, videos: {results: tr ? [{key: tr.key}] : []}};
  }
  function slimB(d) {
    return {credits: {cast: ((d.credits || {}).cast || []).slice(0, 6).map(function (c) { return {name: c.name}; })},
      recommendations: {results: ((d.recommendations || {}).results || []).filter(function (m) { return m.backdrop_path; }).slice(0, 20).map(function (m) {
        return {id: m.id, media_type: m.media_type, title: m.title, name: m.name, overview: m.overview, release_date: m.release_date, first_air_date: m.first_air_date,
          vote_average: m.vote_average, popularity: m.popularity, backdrop_path: m.backdrop_path, poster_path: m.poster_path};
      })}};
  }
  // A is also kept in localStorage for a few hours: a title opened again (or one the focus rested on) after a restart paints at once
  function diskMap() { if (!disk) { try { disk = JSON.parse(localStorage.getItem(DISK) || '{}'); } catch (e) { disk = {}; } } return disk; }
  function diskKey(k) { return k + '|' + TV.C.LANG + '|' + TV.C.REGION; }
  function diskGet(k) { var e = diskMap()[diskKey(k)]; return e && Date.now() - e.at < DISK_TTL ? e.d : null; }
  function diskPut(k, a) {
    var m = diskMap(); m[diskKey(k)] = {at: Date.now(), d: a};
    clearTimeout(diskTimer);
    diskTimer = setTimeout(function () {   // later, off the path of the page
      var keys = Object.keys(m).sort(function (x, y) { return m[y].at - m[x].at; });
      keys.slice(DISK_MAX).forEach(function (x) { delete m[x]; });
      try { localStorage.setItem(DISK, JSON.stringify(m)); } catch (e) { /* storage full: fetched again next time */ }
    }, 3000);
  }
  function loadA(it) {
    var k = key(it), e = entry(k);
    if (e.a) return Promise.resolve(e.a);
    if (!e.pa) {
      var cached = diskGet(k);
      if (cached) return Promise.resolve((e.a = cached));
      e.pa = timed(TV.tmdb(k, '&append_to_response=watch/providers,videos'), 12000).then(function (d) { e.pa = null; e.a = slimA(d); diskPut(k, e.a); return e.a; }, function (er) { e.pa = null; throw er; });
    }
    return e.pa;
  }
  function loadB(it) {
    var k = key(it), e = entry(k);
    if (e.b) return Promise.resolve(e.b);
    if (!e.pb) e.pb = timed(TV.tmdb(k, '&append_to_response=credits,recommendations'), 20000).then(function (d) { e.pb = null; return (e.b = slimB(d)); }, function (er) { e.pb = null; throw er; });
    return e.pb;
  }
  // what is known so far for a title (A, B or both), or null
  function known(it) { var e = mem[key(it)]; return e && (e.a || e.b) ? Object.assign({}, e.a, e.b) : null; }
  // Ahead of the click: the focused card's details are fetched as soon as the focus rests on it (not while a key is held, not for every card swept past):
  // A, then the full-size backdrop (or nothing if it has none sharp enough), so OK finds both already there. B (cast, suggestions) waits for the click.
  var warmPics = [];
  function prefetch(it) {
    if (!it || !it.tmdb || it.src === 'YouTube') return;
    loadA(it).catch(function () { /* the page asks again when it is opened */ });
    TV.refineBest([it]).then(function () {
      var u = TV.fullBg(it);
      if (!u) return;
      var im = new Image(); im.decoding = 'async'; im.src = u;   // into the browser's cache, and decoded now (a 4K picture paints nothing until it is): a few are kept referenced
      if (im.decode) im.decode().catch(function () { /* the page decodes it again */ });
      warmPics.push(im); if (warmPics.length > 3) warmPics.shift();
    });
  }
  TV.prefetchDetails = prefetch;
  function names(a) { return (a || []).map(function (p) { return p.provider_name; }).filter(function (n, i, all) { return all.indexOf(n) === i; }); }

  // ---------- render ----------
  function btn(label, fn) { var b = TV.el('span', 'dbtn f', label); b.onok = fn; return b; }
  function render(it, d, failed) { // d = what is known of the TMDB details (A and/or B, see above), or null while loading
    var meta = it.meta, extra = '';
    if (d) {
      var len = d.runtime ? Math.floor(d.runtime / 60) + 'h ' + d.runtime % 60 + 'm'
        : d.number_of_seasons ? d.number_of_seasons + (d.number_of_seasons > 1 ? ' seasons' : ' season') : '';
      meta = [meta, len, (d.genres || []).slice(0, 3).map(function (g) { return g.name; }).join(', ')].filter(Boolean).join('  ·  ');
    }
    page.innerHTML = '<div class="dshade"></div>' +
      '<div class="dbody"><div class="dsrc">' + esc(it.src) + '</div><h1>' + esc(it.title) + '</h1><div class="dmeta">' + esc(meta) + '</div>' +
      '<p class="dsub">' + esc(d && d.overview || it.sub) + '</p>' +
      '<div class="dcast">&nbsp;</div>' +   // holds the line until the cast arrives, so the buttons do not jump
      '<div class="dbtns"></div><div class="dextra"></div></div>';
    setBg(it);
    var btns = box.querySelector('.dbtns');
    if (d && d['watch/providers']) {
      var reg = (d['watch/providers'] || {}).results || {}, here = reg[TV.C.REGION] || {}, seen = {};
      (here.flatrate || []).concat(here.ads || [], here.free || []).forEach(function (p) {
        var svc = TV.svcFor(p.provider_name);
        if (svc && !seen[svc.name] && TV.S.services.indexOf(svc.name) >= 0) { seen[svc.name] = 1; btns.appendChild(btn('▶ Watch on ' + esc(svc.name), function () { TV.openItem(Object.assign({}, it, {svc: svc})); })); }
      });
      if (!btns.children.length) {
        btns.appendChild(TV.el('span', 'dnone', 'Not on your services'));
        var rb = names((here.rent || []).concat(here.buy || []));
        extra = rb.length ? 'Rent or buy: ' + rb.join(', ') : 'No streaming info for ' + TV.C.REGION;
      }
      var tr = ((d.videos || {}).results || []).filter(function (v) { return v.site === 'YouTube' && v.type === 'Trailer'; })[0];
      if (tr) btns.appendChild(btn('Trailer', function () { TV.launch('youtube.leanback.v4', {contentTarget: 'https://www.youtube.com/tv?v=' + tr.key}); }));
    }
    if (!d || !d['watch/providers']) btns.appendChild(TV.el('span', 'dnone', failed ? 'Could not load details' : 'Loading…'));   // no button to press until the real ones are there (a quick second OK would land on the watchlist)
    else {
      var wl = btn(inList(it) ? '✓ In watchlist' : '＋ Watchlist', function () { wl.textContent = toggle(it) ? '✓ In watchlist' : '＋ Watchlist'; });
      btns.appendChild(wl);
      // seen / not interested: both keep the title out of the suggestions (and Trakt, if connected, is told about what you saw)
      var sn = btn(TV.seen.has(it) ? '✓ Seen' : '○ Mark as seen', function () {
        var on = !TV.seen.has(it); TV.seen.mark(it, on);
        TV.toast(on ? 'Marked as seen' : 'Removed from seen');
        // "not interested" only makes sense for a title you have not seen: draw the buttons again
        render(it, known(it));
        var all = [].slice.call(box.querySelectorAll('.dbtns .f'));
        TV.rebuild(0, Math.max(0, all.indexOf(box.querySelector('.dbtns .dseen'))));
      });
      sn.classList.add('dseen');
      var ni = TV.seen.has(it) ? null : btn(TV.seen.skipped(it) ? '✓ Not interested' : '✕ Not interested', function () {
        var on = !TV.seen.skipped(it); TV.seen.skip(it, on); ni.textContent = on ? '✓ Not interested' : '✕ Not interested';
        TV.toast(on ? 'We won’t suggest it again' : 'Suggestions allowed again');
      });
      btns.appendChild(sn); if (ni) btns.appendChild(ni);   // a title you saw is already out of the suggestions: "not interested" would add nothing
    }
    box.querySelector('.dextra').textContent = extra;
    if (d) fill(it, d);
  }
  // cast and "More like this": B, which arrives after the page is up (or with it, when already known)
  function fill(it, d) {
    var c = page.querySelector('.dcast'), recs = d.recommendations && d.recommendations.results;
    if (!d.credits && !recs) return;
    var cast = ((d.credits || {}).cast || []).map(function (p) { return p.name; }).join(', ');
    if (c) { if (cast) c.textContent = 'Cast: ' + cast; else c.remove(); }
    if (recs && recs.length && !page.querySelector('.dmore')) {
      var more = TV.el('section', 'dmore', '<h3>More like this</h3>'), strip = TV.el('div', 'strip');
      recs.forEach(function (m) { strip.appendChild(TV.card(Object.assign(TV.fromTmdb(m), {src: 'Because you viewed ' + it.title}))); });
      more.appendChild(strip); page.appendChild(more);
    }
  }
  function current(it) { return stack[stack.length - 1] === it && TV.view() === 'details'; }
  function show(it) {
    stack.push(it); box.hidden = false;
    var a = loadA(it), b = loadB(it);
    // the pictures list (skipped when the title is already known): the sharp background may only become possible once it is there
    timed(TV.refineBest([it]), 10000).then(function () { if (current(it)) setBg(it); }, function () { /* the blurred art stays */ });
    var d = known(it);
    render(it, d);
    if (!d || !d['watch/providers']) a.then(function () {
      if (current(it)) { render(it, known(it)); TV.rebuild(0, 0); }   // B may be there already: render fills it in
    }, function () { if (current(it)) render(it, known(it), true); TV.toast('Could not load details'); });
    // B only decorates: put in place without redrawing, keeping the focus where it is
    b.then(function (bd) {
      if (!current(it) || !page.querySelector('.dbtns .f')) return;   // before A the page is redrawn with B anyway
      var p = TV.pos(); fill(it, bd); TV.rebuild(p.r, p.c);
    }, function () { var c = current(it) && page.querySelector('.dcast'); if (c) c.remove(); });
  }
  function hide() {
    stack.pop();
    var prev = stack[stack.length - 1];
    if (prev) render(prev, known(prev)); else { box.hidden = true; page.innerHTML = ''; clearBg(); }
  }

  TV.addView('details', {
    nav: function () {
      var strip = box.querySelector('.strip');
      return [[].slice.call(box.querySelectorAll('.dbtns .f')), strip ? [].slice.call(strip.children) : []];
    },
    show: show,
    hide: hide,
    onFocus: function (e, pos) {
      if (e.parentNode.classList.contains('strip')) e.parentNode.style.transform = 'translateX(' + -TV.stripShift(e) + 'px)';
    },
    back: function () {
      var o = stack.length === 1 && origin;
      TV.closeView();
      if (!o || TV.view() !== 'home') return;
      // Adding/removing the watchlist row can shift home rows: put focus back on the card we came from.
      var secs = [].slice.call(document.querySelectorAll('#rows .row'));
      for (var i = 0; i < secs.length; i++) if (secs[i].querySelector('h3').textContent === o.row) return TV.rebuild(2 + i, o.col);
    }
  });

  function openDetails(it, force) {
    if (!it.tmdb || (it.at && !force) || it.src === 'YouTube') return TV.openItem(it);
    if (TV.view() !== 'details') { // remember where we came from on home
      var f = document.querySelector('#rows .focus'), row = f && f.closest('.row');
      origin = row ? {row: row.querySelector('h3').textContent, col: [].indexOf.call(f.parentNode.children, f)} : null;
    }
    TV.openView('details', it);
  }
  TV.itemOk = function (it) { return openDetails(it); };
  TV.itemDetails = function (it) { return openDetails(it, true); };   // long OK on "Continue watching"
})();
