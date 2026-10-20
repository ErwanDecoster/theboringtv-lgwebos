// Google-TV-style home for webOS. Works with remote arrow keys AND the Magic Remote pointer.
(function () {
  var C = window.CONFIG;
  var $ = function (id) { return document.getElementById(id); };
  var IMG = 'https://image.tmdb.org/t/p/';
  var onTV = typeof window.PalmServiceBridge === 'function';
  // Set by profiles.js (loaded before this file): {prefix, name, color, extraQ, hideApps}.
  var P = window.TV_PROFILE || {};
  function store(k, v) { // per-profile localStorage; store(k) reads JSON, store(k, v) writes
    try {
      if (arguments.length > 1) localStorage[(P.prefix || '') + k] = JSON.stringify(v);
      else return JSON.parse(localStorage[(P.prefix || '') + k] || 'null');
    } catch (e) { return null; }
  }

  // ---------- settings (saved on the TV in localStorage) ----------
  var LANGS = [['hi', 'Hindi'], ['en', 'English'], ['ta', 'Tamil'], ['te', 'Telugu'], ['ml', 'Malayalam'], ['kn', 'Kannada'],
    ['bn', 'Bengali'], ['mr', 'Marathi'], ['pa', 'Punjabi'], ['gu', 'Gujarati'], ['ko', 'Korean'], ['ja', 'Japanese'], ['es', 'Spanish'], ['fr', 'French']];
  var COUNTRIES = [['IN', 'India'], ['US', 'United States'], ['GB', 'United Kingdom'], ['CA', 'Canada'], ['AU', 'Australia'], ['AE', 'UAE'],
    ['SG', 'Singapore'], ['DE', 'Germany'], ['FR', 'France'], ['JP', 'Japan'], ['KR', 'South Korea'], ['BR', 'Brazil']];
  var S = {region: C.REGION, langs: [], services: C.SERVICES.filter(function (x) { return x.on; }).map(function (x) { return x.name; }),
    youtube: true, autoplay: true, clock24: false};
  Object.assign(S, store('settings') || {});
  C.REGION = S.region;
  var SERVICES = C.SERVICES.filter(function (x) { return S.services.indexOf(x.name) >= 0; });
  function pickLabel() {
    return S.langs.length ? 'Popular in ' + LANGS.filter(function (l) { return S.langs.indexOf(l[0]) >= 0; }).map(function (l) { return l[1]; }).join(', ') : 'Trending today';
  }
  function langQ() { return (S.langs.length ? '&with_original_language=' + S.langs.join('%7C') : '') + (P.extraQ || ''); }

  // ---------- webOS luna bridge ----------
  function luna(uri, params) {
    return new Promise(function (ok, fail) {
      if (!onTV) return fail({errorText: 'not on webOS'});
      var b = new window.PalmServiceBridge(), done = false;
      b.onservicecallback = function (m) { done = true; var d = JSON.parse(m); d.returnValue === false ? fail(d) : ok(d); };
      b.call('luna://' + uri, JSON.stringify(params || {}));
      setTimeout(function () { if (!done) fail({errorText: 'timeout'}); }, 5000);
    });
  }
  function launch(id, params) {
    if (!onTV) return toast('Would open ' + id);
    luna('com.webos.applicationManager/launch', {id: id, params: params || {}})
      .catch(function (e) { toast('Could not open ' + id + ': ' + (e.errorText || e)); });
  }

  // ---------- apps: the TV denies listLaunchPoints to non-system apps, so probe our list ----------
  var apps = [];
  function loadApps() {
    if (!onTV) { apps = C.APPS.slice(); return Promise.resolve(); }
    return Promise.all(C.APPS.map(function (a) {
      return luna('com.webos.applicationManager/getAppLoadStatus', {appId: a.id})
        .then(function (r) { return r.exist ? a : null; }, function () { return a; });
    })).then(function (list) { apps = list.filter(Boolean); });
  }
  function visibleApps() { return apps.filter(function (a) { return (P.hideApps || []).indexOf(a.id) < 0; }); }
  function svcFor(name) {
    name = name.toLowerCase();
    return C.SERVICES.filter(function (s) { return name.indexOf(s.match) >= 0; })[0];
  }

  // ---------- data ----------
  function get(url) { return fetch(url).then(function (r) { if (!r.ok) throw new Error(r.status); return r.json(); }); }
  function tmdb(path, q) { return get('https://api.themoviedb.org/3/' + path + '?api_key=' + C.TMDB_KEY + '&language=' + C.LANG + (q || '')); }
  function fromTmdb(m, svc) {
    var type = m.media_type || (m.title ? 'movie' : 'tv'), date = m.release_date || m.first_air_date || '', pic = m.backdrop_path || m.poster_path; // poster when there's no backdrop
    return {
      title: m.title || m.name, sub: m.overview,
      meta: [date.slice(0, 4), type === 'movie' ? 'Movie' : 'Series', m.vote_average ? '★ ' + m.vote_average.toFixed(1) : ''].filter(Boolean).join('  ·  '),
      img: IMG + 'w500' + pic, bg: IMG + 'w1280' + pic, blur: IMG + 'w300' + pic,
      src: svc ? svc.name : pickLabel(), svc: svc, tmdb: {type: type, id: m.id}
    };
  }
  function mix(a, b) { var out = []; for (var i = 0; i < 20; i++) [a[i], b[i]].forEach(function (m) { if (m && m.backdrop_path) out.push(m); }); return out; }
  function trending() {
    if (S.langs.length || P.extraQ) { // trending has no language/certification filter, so use popular-and-streamable in the chosen languages
      var q = '&watch_region=' + C.REGION + '&with_watch_monetization_types=flatrate%7Cfree%7Cads&sort_by=popularity.desc&vote_count.gte=5' + langQ();
      return Promise.all([tmdb('discover/movie', q), tmdb('discover/tv', q)])
        .then(function (rs) { return mix(rs[0].results, rs[1].results).map(function (m) { return fromTmdb(m); }); });
    }
    return tmdb('trending/all/day').then(function (r) {
      return r.results.filter(function (m) { return m.backdrop_path && m.media_type !== 'person'; }).map(function (m) { return fromTmdb(m); });
    });
  }
  function serviceRow(svc, providers) {
    var name = function (x) { return x.provider_name.toLowerCase(); };
    var p = providers.filter(function (x) { return name(x) === svc.match; })[0] ||
      providers.filter(function (x) { return name(x).indexOf(svc.match) >= 0; })[0];
    if (!p) return Promise.resolve(null);
    var q = '&watch_region=' + C.REGION + '&with_watch_providers=' + p.provider_id + '&sort_by=popularity.desc' + langQ();
    return Promise.all([tmdb('discover/tv', q), tmdb('discover/movie', q)]).then(function (rs) {
      return {title: 'Popular on ' + svc.name, items: mix(rs[0].results, rs[1].results).map(function (m) { return fromTmdb(m, svc); })};
    });
  }
  function youtube() {
    return get('https://www.googleapis.com/youtube/v3/videos?part=snippet,statistics&chart=mostPopular&maxResults=20&regionCode=' + C.REGION + '&key=' + C.YT_KEY)
      .then(function (r) {
        return {title: 'Trending on YouTube', items: r.items.map(function (v) {
          var t = v.snippet.thumbnails, img = t.medium.url, big = (t.maxres || t.standard || t.high).url;
          var views = +(v.statistics && v.statistics.viewCount) || 0;
          return {title: v.snippet.title, sub: v.snippet.description, img: img, bg: big, blur: t.default.url, src: 'YouTube',
            meta: v.snippet.channelTitle + (views ? '  ·  ' + (views >= 1e6 ? (views / 1e6).toFixed(1) + 'M' : Math.round(views / 1e3) + 'K') + ' views' : ''),
            svc: {name: 'YouTube', app: 'youtube.leanback.v4'}, params: {contentTarget: 'https://www.youtube.com/tv?v=' + v.id}};
        })};
      });
  }

  // Continue watching: titles opened from this home screen (other apps don't share their history).
  var recent = [];
  recent = store('recent') || [];
  function remember(it) {
    var keep = {title: it.title, sub: it.sub, meta: it.meta, img: it.img, bg: it.bg, blur: it.blur, src: it.src, svc: it.svc, params: it.params, at: Date.now()};
    recent = [keep].concat(recent.filter(function (x) { return x.title !== it.title; })).slice(0, 12);
    store('recent', recent);
    buildRows();
  }
  function ago(t) {
    var m = Math.round((Date.now() - t) / 60000);
    return m < 60 ? (m || 1) + ' min ago' : m < 1440 ? Math.round(m / 60) + ' hr ago' : Math.round(m / 1440) + ' days ago';
  }

  // OK on a title → open the service that streams it.
  function openItem(it) {
    if (it.svc) { remember(it); return launch(it.svc.app, it.params); }
    tmdb(it.tmdb.type + '/' + it.tmdb.id + '/watch/providers').then(function (r) {
      var reg = r.results[C.REGION] || {}, list = (reg.flatrate || []).concat(reg.ads || [], reg.free || []), svc;
      for (var i = 0; i < list.length && !svc; i++) { svc = svcFor(list[i].provider_name); if (svc && S.services.indexOf(svc.name) < 0) svc = null; }
      svc ? (remember(Object.assign({}, it, {svc: svc})), launch(svc.app)) : toast('“' + it.title + '” isn’t on your services in ' + C.REGION);
    }).catch(function () { toast('Could not look up where to watch'); });
  }

  // ---------- render ----------
  var rowsData = [], heroItems = [], base = [], rowProviders = [];
  function buildRows() {
    var extra = rowProviders.map(function (fn) { return fn(); }).filter(Boolean);
    rowsData = base.slice(0, 2).concat([{title: 'Continue watching', items: recent}], extra, base.slice(2))
      .filter(function (x) { return (x.apps || x.items).length; });
    if (base.length) render();
  }
  function el(tag, cls, html) { var e = document.createElement(tag); if (cls) e.className = cls; if (html) e.innerHTML = html; return e; }
  function esc(s) { return String(s || '').replace(/[&<>"]/g, function (c) { return '&#' + c.charCodeAt(0) + ';'; }); }

  function appTile(a) {
    var t = el('div', 'app f');
    t.innerHTML = '<div class="disc" style="background:' + a.color + '">' +
      (a.icon ? '<img src="icons/' + a.icon + '" alt="" decoding="async">' : '<span class="txt">' + esc(a.title) + '</span>') + '</div><div class="cap">' + esc(a.title) + '</div>';
    t.onok = function () { launch(a.id); };
    return t;
  }
  function card(it) {
    var c = el('div', 'card f', '<div class="pic"><img src="' + it.img + '" alt="" loading="lazy" decoding="async">' +
      (it.src === 'YouTube' ? '' : '<b class="ttl">' + esc(it.title) + '</b>') + '</div>' +
      '<div class="cap">' + esc(it.at ? it.svc.name + '  ·  opened ' + ago(it.at) : it.src === 'YouTube' ? it.title : it.meta) + '</div>');
    c.item = it; c.onok = function () { TV.itemOk(it); };
    return c;
  }
  function render() {
    var root = $('rows'); root.innerHTML = '';
    rowsData.forEach(function (row) {
      var r = el('section', 'row' + (row.apps ? ' apps-row' : '')), s = el('div', 'strip');
      r.appendChild(el('h3', '', esc(row.title)));
      (row.apps || row.items).forEach(function (x) { s.appendChild(row.apps ? appTile(x) : card(x)); });
      r.appendChild(s); root.appendChild(r);
    });
    var g = $('grid'); g.innerHTML = '';
    visibleApps().forEach(function (a) { g.appendChild(appTile(a)); });
    buildNav();
  }

  var SROWS = [
    {key: 'region', title: 'Country', hint: 'Where to look up what’s streaming', opts: COUNTRIES},
    {key: 'langs', title: 'Recommendation languages', hint: 'Pick any. None = trending in every language', many: true, opts: LANGS},
    {key: 'services', title: 'Your streaming services', hint: 'Each gets a “Popular on …” row', many: true, opts: C.SERVICES.map(function (x) { return [x.name, x.name]; })},
    {key: 'youtube', title: 'Trending on YouTube row', opts: [[true, 'On'], [false, 'Off']]},
    {key: 'autoplay', title: 'Rotate featured titles', opts: [[true, 'On'], [false, 'Off']]},
    {key: 'clock24', title: 'Clock', opts: [[false, '12-hour'], [true, '24-hour']]},
    {key: 'clear', title: 'Continue watching', opts: [['clear', 'Clear history']]}
  ];
  var draft, dirty;
  function renderSettings() {
    $('settings').innerHTML = '<div class="shead"><h2>Settings</h2><span id="sclose" class="f" title="Close">&#10005;</span></div>' + SROWS.map(function (row, r) {
      return '<section class="srow"><h4>' + row.title + '</h4>' + (row.hint ? '<p>' + row.hint + '</p>' : '') + '<div class="strip">' +
        row.opts.map(function (o, i) {
          var v = draft[row.key], sel = row.many ? v.indexOf(o[0]) >= 0 : v === o[0];
          return '<span class="chip f' + (sel ? ' sel' : '') + '" data-r="' + r + '" data-i="' + i + '">' + (sel && row.many ? '✓ ' : '') + o[1] + '</span>';
        }).join('') + '</div></section>';
    }).join('');
  }
  function openSettings() {
    draft = JSON.parse(JSON.stringify(S)); dirty = false; prevView = view;
    renderSettings(); $('spanel').hidden = $('sdim').hidden = false; pos.r = 1; pos.c = 0; mem = {}; view = 'settings'; buildNav();
  }
  function closeSettings() {
    if (dirty) { store('settings', draft); store('homeCache', null); location.reload(); return; }
    $('spanel').hidden = $('sdim').hidden = true; pos.r = 0; setView(prevView);
  }
  function choose(e) {
    var row = SROWS[+e.dataset.r], o = row.opts[+e.dataset.i], v = draft[row.key];
    if (row.key === 'clear') { recent = []; store('recent', []); buildRows(); return toast('Continue watching cleared'); }
    if (row.many) { var i = v.indexOf(o[0]); i >= 0 ? v.splice(i, 1) : v.push(o[0]); } else draft[row.key] = o[0];
    dirty = true;
    var r = pos.r, c = pos.c; renderSettings(); buildNav(); pos.r = r; pos.c = c; focus();
  }

  // ---------- quick settings side panel ----------
  var OUTPUTS = {tv_speaker: 'TV speaker', bt_soundbar: 'Bluetooth soundbar', external_arc: 'HDMI ARC', external_optical: 'Optical',
    headphone: 'Headphones', tv_external_speaker: 'TV + external', lineout: 'Line out'};
  function setText(id, t) { $(id).textContent = t; }
  function refreshQuick() {
    var d = new Date();
    setText('qdate', d.toLocaleDateString('en-US', {weekday: 'short', month: 'short', day: 'numeric'}));
    setText('qtime', $('clock').textContent + (S.clock24 ? '' : d.getHours() < 12 ? ' AM' : ' PM'));
    if (!onTV) { setText('qwifi', 'Home Wi-Fi'); setText('qaudio', 'TV speaker'); setText('qbt', 'On'); setText('qvol', '37'); return; }
    luna('com.webos.service.connectionmanager/getStatus').then(function (r) {
      setText('qwifi', r.wifi && r.wifi.state === 'connected' ? r.wifi.displayName || r.wifi.ssid || 'Connected' : r.wired && r.wired.state === 'connected' ? 'Ethernet' : 'Not connected');
    }, function () { setText('qwifi', ''); });
    luna('com.webos.service.audio/getSoundOutput').then(function (r) { setText('qaudio', OUTPUTS[r.soundOutput] || r.soundOutput); }, function () {});
    luna('com.webos.service.bluetooth2/adapter/getStatus').then(function (r) { setText('qbt', r.adapters && r.adapters[0] && r.adapters[0].powered ? 'On' : 'Off'); }, function () {});
    luna('com.webos.audio/getVolume').then(function (r) { setText('qvol', r.muteStatus ? 'Muted' : r.volume); }, function () {});
  }
  function openQuick() {
    prevView = view; refreshQuick();
    $('qpanel').hidden = $('qdim').hidden = false;
    view = 'quick'; pos.r = 1; pos.c = 0; mem = {}; buildNav();
  }
  function closeQuick() { $('qpanel').hidden = $('qdim').hidden = true; pos.r = 0; setView(prevView); }
  function volume(dir) {
    luna('com.webos.service.audio/master/' + dir).then(function (r) { setText('qvol', r.volume); }, function (e) { toast('Volume: ' + (e.errorText || e)); });
  }
  function quickAct(q) {
    var tvSettings = function (target) { launch('com.palm.app.settings', {target: target}); };
    ({
      settings: function () { closeQuick(); openSettings(); },
      tip: function () { closeQuick(); openSettings(); },
      close: closeQuick,
      screensaver: function () { launch('com.webos.app.screensaver'); },
      inputs: function () { launch('com.webos.app.inputcommon'); },
      wifi: function () { tvSettings('network'); },
      a11y: function () { tvSettings('accessibility'); },
      audio: function () { tvSettings('sound'); },
      bluetooth: function () { tvSettings('bluetooth'); },
      voldown: function () { volume('volumeDown'); },
      volup: function () { volume('volumeUp'); }
    })[q]();
  }

  // ---------- hero / background ----------
  var heroIdx = 0, bgFlip = false, lastBg, lastBlur, bgTimer;
  function setBlur(src) { if (src && src !== lastBlur) { lastBlur = src; $('bgBlur').src = src; } }
  // Swap backgrounds only once focus rests, so holding an arrow key doesn't decode/blur every card.
  function bgFor(it, scrolled) {
    clearTimeout(bgTimer);
    bgTimer = setTimeout(function () {
      if (scrolled) setBlur(it && it.blur); else setBg(it ? it.bg : heroItems[heroIdx] && heroItems[heroIdx].bg);
    }, 300);
  }
  function setBg(src) {
    if (!src || src === lastBg) return; lastBg = src;
    var on = bgFlip ? $('bgA') : $('bgB'), off = bgFlip ? $('bgB') : $('bgA');
    bgFlip = !bgFlip;
    on.onload = function () { on.className = 'on'; off.className = ''; };
    on.src = src;
  }
  function showHero() {
    var it = heroItems[heroIdx]; if (!it) return;
    $('heroSrc').textContent = it.src;
    $('heroTitle').textContent = it.title;
    $('heroMeta').textContent = it.meta || '';
    $('heroSub').textContent = it.sub || '';
    $('heroBtn').textContent = it.svc ? 'Open in ' + it.svc.name : 'Where to watch';
    $('dots').innerHTML = heroItems.map(function (_, i) { return '<i' + (i === heroIdx ? ' class="on"' : '') + '></i>'; }).join('');
    setBg(it.bg);
  }
  function stepHero(d) { heroIdx = (heroIdx + d + heroItems.length) % heroItems.length; showHero(); }
  var idleSince = Date.now();
  setInterval(function () { if (S.autoplay && view === 'home' && pos.r <= 1 && Date.now() - idleSince > 7000) stepHero(1); }, 8000);

  // ---------- navigation (keys + pointer) ----------
  var nav = [], pos = {r: 0, c: 0}, mem = {}, view = 'home', prevView = 'home';
  function all(sel) { return [].slice.call(document.querySelectorAll(sel)); }
  function buildNav() {
    var top = all('#top .f');
    if (views[view]) {
      nav = views[view].nav();
    } else if (view === 'quick') {
      nav = all('#quick .qrow').map(function (r) { return [].slice.call(r.querySelectorAll('.f')); });
    } else if (view === 'settings') {
      nav = [[$('sclose')]].concat(all('#settings .strip').map(function (s) { return [].slice.call(s.children); }));
    } else if (view === 'home') {
      nav = [top, [$('heroBtn')]].concat(all('#rows .strip').map(function (s) { return [].slice.call(s.children); }));
    } else {
      var tiles = all('#grid .app'), cols = 9;
      nav = [top];
      for (var i = 0; i < tiles.length; i += cols) nav.push(tiles.slice(i, i + cols));
    }
    nav = nav.filter(function (r) { return r.length; });
    pos.r = Math.min(pos.r, nav.length - 1);
    focus();
  }
  function focus(fromPointer) {
    var cur = document.querySelector('.focus'); if (cur) cur.classList.remove('focus');
    if (!nav.length) return;
    var row = nav[pos.r]; pos.c = Math.max(0, Math.min(pos.c, row.length - 1));
    var e = row[pos.c]; e.classList.add('focus'); mem[pos.r] = pos.c;
    if (fromPointer) return; // don't scroll content out from under the pointer
    var strip = e.parentNode;
    if (views[view]) { if (views[view].onFocus) views[view].onFocus(e, pos); return; }
    if (view === 'quick') return;
    if (strip.classList.contains('strip')) strip.style.transform = 'translateX(' + -Math.max(0, e.offsetLeft - (pos.c ? 40 : 0)) + 'px)';
    var section = e.closest('.row, .srow');
    var rowTop = pos.r === 0 ? 0 : section ? section.offsetTop : e.offsetTop;
    var dy = view === 'home' ? (section && section.previousElementSibling ? rowTop - 90 : 0) : Math.max(0, rowTop - 400);
    if (view === 'home') dy = Math.max(0, Math.min(dy, $('home').scrollHeight - 1080 + 40)); // stop at the last row
    $(view).style.transform = 'translateY(' + -dy + 'px)';
    if (view === 'settings') return;
    document.body.classList.toggle('scrolled', dy > 0);
    bgFor(e.item, dy > 0);
  }
  function setView(v) {
    view = v; $('home').hidden = v !== 'home'; $('apps').hidden = v !== 'apps';
    all('.tab').forEach(function (t) { t.classList.toggle('cur', t.dataset.tab === v); });
    $('bg').style.opacity = v === 'home' ? 1 : 0;
    $('bgBlur').style.visibility = v === 'home' || v === 'settings' || v === 'quick' ? '' : 'hidden';
    document.body.classList.toggle('scrolled', v !== 'home');
    buildNav();
  }
  function activate(e) {
    if (e.dataset.tab) return setView(e.dataset.tab);
    if (e.dataset.view) return openView(e.dataset.view);
    if (e.dataset.act === 'live') return launch('com.webos.app.livetv');
    if (e.id === 'avatar') return TV.onAvatar();
    if (e.dataset.act === 'settings') return openQuick();
    if (e.dataset.q) return quickAct(e.dataset.q);
    if (e.dataset.r) return choose(e);
    if (e.id === 'sclose') return closeSettings();
    if (e.id === 'heroBtn') return TV.itemOk(heroItems[heroIdx]);
    if (e.onok) e.onok();
  }
  document.addEventListener('keydown', function (ev) {
    var k = ev.keyCode, onHero = view === 'home' && pos.r === 1;
    idleSince = Date.now();
    if (views[view] && views[view].keydown && views[view].keydown(ev)) { ev.preventDefault(); return; } // view handled it
    if (k === 37) { if (onHero) stepHero(-1); else pos.c--; }
    else if (k === 39) { if (onHero) stepHero(1); else pos.c++; }
    else if (k === 38) { if (pos.r > 0) { pos.r--; pos.c = mem[pos.r] || 0; } }
    else if (k === 40) { if (pos.r < nav.length - 1) { pos.r++; pos.c = mem[pos.r] || 0; } }
    else if (k === 13) { ev.preventDefault(); return activate(nav[pos.r][pos.c]); }
    else if (k === 461 || k === 27 || k === 8) { if (views[view]) return views[view].back ? views[view].back() : closeView(); if (view === 'settings') return closeSettings(); if (view === 'quick') return closeQuick(); if (view !== 'home') setView('home'); else { pos.r = 1; pos.c = 0; } }
    else return;
    ev.preventDefault();
    focus();
  });
  // Magic Remote scroll wheel: one notch = one row (sideways wheel/trackpad = one item).
  var wheelAt = 0;
  document.addEventListener('wheel', function (ev) {
    ev.preventDefault();
    if (Date.now() - wheelAt < 180) return;
    var dy = ev.deltaY, dx = ev.deltaX;
    if (Math.abs(dy) < 4 && Math.abs(dx) < 4) return;
    wheelAt = Date.now(); idleSince = wheelAt;
    if (Math.abs(dx) > Math.abs(dy)) { if (view === 'home' && pos.r === 1) stepHero(dx > 0 ? 1 : -1); else pos.c += dx > 0 ? 1 : -1; }
    else if (dy > 0 && pos.r < nav.length - 1) { pos.r++; pos.c = mem[pos.r] || 0; }
    else if (dy < 0 && pos.r > 0) { pos.r--; pos.c = mem[pos.r] || 0; }
    focus();
  }, {passive: false});
  // Magic Remote pointer: hover moves focus, OK/click activates.
  function locate(target) {
    var e = target.closest && target.closest('.f');
    if (!e) return null;
    for (var r = 0; r < nav.length; r++) { var c = nav[r].indexOf(e); if (c >= 0) return {r: r, c: c, e: e}; }
    return null;
  }
  document.addEventListener('mouseover', function (ev) {
    var p = locate(ev.target); idleSince = Date.now();
    if (p && (p.r !== pos.r || p.c !== pos.c)) { pos.r = p.r; pos.c = p.c; focus(true); if (p.e.item) bgFor(p.e.item, document.body.classList.contains('scrolled')); }
  });
  document.addEventListener('click', function (ev) {
    var p = locate(ev.target);
    if (p) { pos.r = p.r; pos.c = p.c; focus(true); activate(p.e); }
  });

  // ---------- misc ----------
  var toastT;
  function toast(m) { var t = $('toast'); t.textContent = m; t.style.display = 'block'; clearTimeout(toastT); toastT = setTimeout(function () { t.style.display = 'none'; }, 3500); }
  function tick() { var d = new Date(), h = d.getHours(); $('clock').textContent = (S.clock24 ? ('0' + h).slice(-2) : h % 12 || 12) + ':' + ('0' + d.getMinutes()).slice(-2); }
  setInterval(tick, 10000); tick();
  $('avatar').textContent = C.NAME;
  document.querySelector('.qav').textContent = C.NAME;
  $('qdim').onclick = function () { closeQuick(); };
  $('sdim').onclick = function () { closeSettings(); };

  // ---------- plugin API (details.js, search.js, ambient.js, profiles.js) ----------
  // A view = {nav() -> rows of focusable elements, show(arg), hide(), onFocus(el, pos)?, back()?, keydown(ev)?}.
  var views = {}, stack = [];
  function openView(name, arg) {
    stack.push({view: view, r: pos.r, c: pos.c, mem: mem});
    view = name; pos.r = 0; pos.c = 0; mem = {};
    views[name].show(arg); buildNav();
  }
  function closeView() {
    if (views[view] && views[view].hide) views[view].hide();
    var prev = stack.pop() || {view: 'home', r: 1, c: 0, mem: {}};
    view = prev.view; mem = prev.mem; pos.r = prev.r; pos.c = prev.c;
    buildNav();
  }
  var TV = window.TV = {
    C: C, S: S, P: P, LANGS: LANGS, IMG: IMG, onTV: onTV,
    luna: luna, launch: launch, get: get, tmdb: tmdb, fromTmdb: fromTmdb, svcFor: svcFor, store: store,
    openItem: openItem,            // default OK on a title: open its service
    itemOk: openItem,              // override to intercept OK on any title card / hero
    onAvatar: openQuick,           // override to change what the avatar does
    card: card, esc: esc, el: el, toast: toast, setBg: setBg, setBlur: setBlur,
    heroItems: function () { return heroItems; },
    view: function () { return view; },
    idleSince: function () { return idleSince; },
    addView: function (name, def) { views[name] = def; },
    openView: openView, closeView: closeView,
    rebuild: function (r, c) { if (r != null) { pos.r = r; pos.c = c || 0; } buildNav(); },
    addRow: function (fn) { rowProviders.push(fn); },   // fn() -> {title, items} | null, shown after Continue watching
    refresh: function () { buildRows(); },
    addTab: function (label, viewName) {
      var t = el('span', 'tab f', esc(label)); t.dataset.view = viewName;
      document.querySelector('#top .pill').insertBefore(t, document.querySelector('[data-tab=apps]'));
      buildNav();
    },
    addSetting: function (row, def) { if (S[row.key] === undefined) S[row.key] = def; SROWS.splice(SROWS.length - 1, 0, row); }
  };
  if (P.name) { $('avatar').textContent = document.querySelector('.qav').textContent = P.name.charAt(0).toUpperCase(); }
  if (P.color) $('avatar').style.background = P.color;
  window.dispatchEvent(new Event('tvready'));

  // Relaunch (Home button, or opening TV Home again): appinfo's handlesRelaunch keeps the page alive
  // instead of reloading it behind a splash, so bring ourselves forward and go back to the top of For you.
  document.addEventListener('webOSRelaunch', function () {
    try { window.PalmSystem.activate(); } catch (e) { /* not on webOS */ }
    if (!$('qpanel').hidden) closeQuick();
    if (!$('spanel').hidden) { $('spanel').hidden = $('sdim').hidden = true; }
    while (views[view]) closeView();
    if (view !== 'home') setView('home');
    pos.r = 1; pos.c = 0; buildNav();
  });

  // ---------- boot ----------
  // Draw the last home screen straight away (webOS often kills us in the background, so most
  // opens are cold starts), then replace it with fresh data. Kept per profile via store().
  var cached = store('homeCache');
  if (cached && cached.base && cached.base.length) {
    heroItems = cached.hero; base = cached.base;
    buildRows(); showHero(); pos.r = 1; focus();
  }
  loadApps().then(function () {
    var safe = function (p) { return p.catch(function (e) { console.warn(e); return null; }); };
    return Promise.all([
      safe(trending()),
      safe(tmdb('watch/providers/tv', '&watch_region=' + C.REGION).then(function (r) {
        return Promise.all(SERVICES.map(function (s) { return safe(serviceRow(s, r.results)); }));
      })),
      S.youtube ? safe(youtube()) : null
    ]).then(function (r) {
      var picks = r[0] || [];
      heroItems = picks.slice(0, 6);
      base = [{title: 'Top picks for you', items: picks.slice(6)}, {title: 'Your apps', apps: visibleApps()}]
        .concat((r[1] || []).filter(Boolean), r[2] ? [r[2]] : []);
      store('homeCache', {hero: heroItems, base: base});
      var fresh = !cached; // keep the user's place if they already started moving around the cached screen
      buildRows(); showHero();
      if (fresh) { pos.r = 1; focus(); }
    });
  });
})();
