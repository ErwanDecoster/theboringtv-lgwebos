// details feature - uses window.TV (see README "Feature files").
// OK on a title opens a full-screen details page (where to watch, trailer, watchlist, more like this).
(function () {
  var TV = window.TV, esc = TV.esc;
  var box = TV.el('div'), stack = [], cache = {}, origin = null;
  box.id = 'details'; box.hidden = true;
  document.body.appendChild(box);

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
  function load(it) {
    var k = it.tmdb.type + '/' + it.tmdb.id;
    if (!cache[k]) cache[k] = TV.tmdb(k, '&append_to_response=credits,videos,watch/providers,recommendations')
      .then(function (d) { return (cache[k] = d); }, function (e) { delete cache[k]; throw e; });
    return cache[k];
  }
  function names(a) { return (a || []).map(function (p) { return p.provider_name; }).filter(function (n, i, all) { return all.indexOf(n) === i; }); }

  // ---------- render ----------
  function btn(label, fn) { var b = TV.el('span', 'dbtn f', label); b.onok = fn; return b; }
  function render(it, d) { // d = TMDB details (or null while loading)
    var bg = d && d.backdrop_path ? TV.IMG + 'w1280' + d.backdrop_path : it.bg, meta = it.meta, cast = '', extra = '';
    if (d) {
      var len = d.runtime ? Math.floor(d.runtime / 60) + 'h ' + d.runtime % 60 + 'm'
        : d.number_of_seasons ? d.number_of_seasons + (d.number_of_seasons > 1 ? ' seasons' : ' season') : '';
      meta = [meta, len, (d.genres || []).slice(0, 3).map(function (g) { return g.name; }).join(', ')].filter(Boolean).join('  ·  ');
      cast = (d.credits && d.credits.cast || []).slice(0, 6).map(function (c) { return c.name; }).join(', ');
    }
    box.innerHTML = '<img class="dbg" alt="" decoding="async"' + (bg ? ' src="' + bg + '"' : '') + '><div class="dshade"></div>' +
      '<div class="dbody"><div class="dsrc">' + esc(it.src) + '</div><h1>' + esc(it.title) + '</h1><div class="dmeta">' + esc(meta) + '</div>' +
      '<p class="dsub">' + esc(d ? d.overview || it.sub : it.sub) + '</p>' + (cast ? '<div class="dcast">Cast: ' + esc(cast) + '</div>' : '') +
      '<div class="dbtns"></div><div class="dextra"></div></div>';
    var btns = box.querySelector('.dbtns');
    if (d) {
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
    if (!d) btns.appendChild(TV.el('span', 'dnone', 'Loading…'));   // no button to press until the real ones are there (a quick second OK would land on the watchlist)
    else {
      var wl = btn(inList(it) ? '✓ In watchlist' : '＋ Watchlist', function () { wl.textContent = toggle(it) ? '✓ In watchlist' : '＋ Watchlist'; });
      btns.appendChild(wl);
      // seen / not interested: both keep the title out of the suggestions (and Trakt, if connected, is told about what you saw)
      var sn = btn(TV.seen.has(it) ? '✓ Seen' : '○ Mark as seen', function () {
        var on = !TV.seen.has(it); TV.seen.mark(it, on);
        TV.toast(on ? 'Marked as seen' : 'Removed from seen');
        // "not interested" only makes sense for a title you have not seen: draw the buttons again
        var dd = cache[it.tmdb.type + '/' + it.tmdb.id];
        render(it, dd && !dd.then ? dd : null);
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
    var recs = d && ((d.recommendations || {}).results || []).filter(function (m) { return m.backdrop_path; }).slice(0, 20);
    if (recs && recs.length) {
      var more = TV.el('section', 'dmore', '<h3>More like this</h3>'), strip = TV.el('div', 'strip');
      recs.forEach(function (m) { strip.appendChild(TV.card(Object.assign(TV.fromTmdb(m), {src: 'Because you viewed ' + it.title}))); });
      more.appendChild(strip); box.appendChild(more);
    }
  }
  function show(it) {
    stack.push(it); box.hidden = false;
    var k = it.tmdb.type + '/' + it.tmdb.id;
    if (cache[k] && !cache[k].then) return render(it, cache[k]);
    render(it, null);
    load(it).then(function (d) {
      if (stack[stack.length - 1] === it && TV.view() === 'details') { render(it, d); TV.rebuild(0, 0); }
    }, function () { TV.toast('Could not load details'); });
  }
  function hide() {
    stack.pop();
    var prev = stack[stack.length - 1];
    var d = prev && cache[prev.tmdb.type + '/' + prev.tmdb.id];
    if (prev) render(prev, d && !d.then ? d : null); else { box.hidden = true; box.innerHTML = ''; }
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
