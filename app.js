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
  var S = {region: C.REGION, langs: ['fr'], services: C.SERVICES.filter(function (x) { return x.on; }).map(function (x) { return x.name; }),
    youtube: true, autoplay: true, clock24: true, weatherCity: 'Paris', iconShape: 'circle', mergeRows: true, newRow: true, liveTab: true, profileBtn: true, uiLang: 'fr'};
  Object.assign(S, store('settings') || {});
  document.body.classList.toggle('shape-rounded', S.iconShape === 'rounded');
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
  // Root helpers in the TV Home service (service/service.js), reached over the TV's loopback.
  function svc(name, params) {
    return fetch('http://127.0.0.1:45620/' + name, {method: 'POST', body: JSON.stringify(params || {})})
      .then(function (r) { return r.json(); });
  }
  // Icons are cached by app id and never refreshed, so the key carries a version: bump it whenever the icon the service picks
  // changes (e.g. a bigger size), or users keep the old copies for good. The unversioned key of earlier releases is deleted on load.
  var ICON_CACHE = 'appIcons.v2';
  function loadApps() {
    if (!onTV) { apps = C.APPS.slice(); return Promise.resolve(); }
    // Real installed apps and icons when the service is running (rooted TV); otherwise probe config.js's list.
    return svc('getApps').then(function (r) {
      if (!r.apps || !r.apps.length) throw new Error('no apps');
      var icons = {};
      try { icons = JSON.parse(localStorage.getItem(ICON_CACHE) || '{}'); localStorage.removeItem('appIcons'); } catch (e) { /* storage unavailable */ }
      apps = r.apps;
      return Promise.all(apps.map(function (a) {
        if (icons[a.id]) { a.img = icons[a.id]; return null; }
        return svc('getIcon', {id: a.id}).then(function (i) { if (i.icon) a.img = icons[a.id] = i.icon; }, function () {});
      })).then(function () { try { localStorage.setItem(ICON_CACHE, JSON.stringify(icons)); } catch (e) { /* too big or blocked */ } });
    }).catch(loadAppsFromHelper).catch(probeApps);
  }
  // The Launcher's helper service (rooted TV, port 45621) lists the installed apps and serves their real icons as
  // plain URLs, so no base64 copies are needed. The apps in config.js come first, in that order, with their short titles;
  // each keeps its bundled icon (a 130 px copy of the TV's own) as a fallback if the service stops answering.
  var HELPER = 'http://127.0.0.1:45621';
  function readIcons() { try { return JSON.parse(localStorage.getItem(ICON_CACHE) || '{}'); } catch (e) { return {}; } }
  function loadAppsFromHelper() {
    // what is plugged into each HDMI port (the service asks the TV); the last answer is kept for when the service is slow or away
    var names = {};
    try { names = JSON.parse(localStorage.getItem('inputNames') || '{}'); } catch (e) { /* storage unavailable */ }
    var inputs = fetch(HELPER + '/inputs').then(function (r) { return r.json(); }).then(function (r) {
      if (r.inputs) { names = {}; r.inputs.forEach(function (i) { names[i.appId] = i.name; }); try { localStorage.setItem('inputNames', JSON.stringify(names)); } catch (e) { /* ignore */ } }
    }).catch(function () {});
    return Promise.all([fetch(HELPER + '/apps').then(function (r) { return r.json(); }), inputs]).then(function (both) {
      var r = both[0];
      if (!r.apps || !r.apps.length) throw new Error('no apps');
      var known = {}, rank = {}, icons = readIcons(), missing = [];
      C.APPS.forEach(function (a, i) { known[a.id] = a; rank[a.id] = i; });
      apps = r.apps.map(function (a) {
        var k = known[a.id] || {}, url = a.icon ? HELPER + '/icon/' + encodeURIComponent(a.id) : undefined;
        if (url && !icons[a.id]) missing.push({id: a.id, url: url});
        return {id: a.id, title: names[a.id] || k.title || a.title, color: k.color || a.color || '#3c4043', icon: k.icon, img: icons[a.id] || url};
      }).sort(function (a, b) { return (rank[a.id] === undefined ? 1e4 : rank[a.id]) - (rank[b.id] === undefined ? 1e4 : rank[b.id]); });
      cacheIcons(missing); // keep them, so the icons are still there when the service is not
    });
  }
  // Fetches each icon once and stores it in the same cache as the service's own getIcon (a data URI by app id).
  function cacheIcons(list) {
    if (!list.length) return;
    var icons = readIcons();
    Promise.all(list.map(function (m) {
      return fetch(m.url).then(function (r) { return r.blob(); }).then(function (b) {
        return new Promise(function (ok) { var f = new FileReader(); f.onload = function () { icons[m.id] = String(f.result); ok(); }; f.onerror = ok; f.readAsDataURL(b); });
      }).catch(function () {});
    })).then(function () { try { localStorage.setItem(ICON_CACHE, JSON.stringify(icons)); } catch (e) { /* too big or blocked */ } });
  }
  function probeApps() {
    return Promise.all(C.APPS.map(function (a) {
      return luna('com.webos.applicationManager/getAppLoadStatus', {appId: a.id})
        .then(function (r) { return r.exist ? a : null; }, function () { return a; });
    })).then(function (list) { var icons = readIcons(); apps = list.filter(Boolean); apps.forEach(function (a) { if (icons[a.id]) a.img = icons[a.id]; }); });
  }
  // Apps row order and removed apps are per profile (store); profile.js's hideApps also applies.
  function visibleApps() {
    var hidden = (P.hideApps || []).concat(store('appHidden') || []), order = store('appOrder') || [];
    var rank = function (a) { var i = order.indexOf(a.id); return i < 0 ? 1e4 + apps.indexOf(a) : i; };
    return apps.filter(function (a) { return hidden.indexOf(a.id) < 0; }).sort(function (a, b) { return rank(a) - rank(b); });
  }
  function hiddenApps() {
    var gone = P.hideApps || [], hidden = store('appHidden') || [];
    return apps.filter(function (a) { return gone.indexOf(a.id) < 0 && hidden.indexOf(a.id) >= 0; });
  }
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
      img: IMG + 'w500' + pic, bg: IMG + 'w1280' + pic, blur: IMG + 'w154' + pic,
      src: svc ? svc.name : pickLabel(), svc: svc, tmdb: {type: type, id: m.id}, pop: m.popularity || 0
    };
  }
  function mix(a, b) { var out = []; for (var i = 0; i < 20; i++) [a[i], b[i]].forEach(function (m) { if (m && m.backdrop_path) out.push(m); }); return out; }
  function providerOf(svc, providers) {
    var name = function (x) { return x.provider_name.toLowerCase(); };
    return providers.filter(function (x) { return name(x) === svc.match; })[0] || providers.filter(function (x) { return name(x).indexOf(svc.match) >= 0; })[0];
  }
  // A service's titles, most popular first: only what is INCLUDED in the subscription ("flatrate"). Without that TMDB also returns
  // what the service only rents or sells. `extra` narrows it (the dates of "New on …").
  function serviceRow(svc, providers, extra, title) {
    var p = providerOf(svc, providers);
    if (!p) return Promise.resolve(null);
    var q = '&watch_region=' + C.REGION + '&with_watch_providers=' + p.provider_id + '&with_watch_monetization_types=flatrate&sort_by=popularity.desc' + langQ();
    return Promise.all([tmdb('discover/tv', q + ((extra && extra.tv) || '')), tmdb('discover/movie', q + ((extra && extra.movie) || ''))]).then(function (rs) {
      return {title: title || 'Popular on ' + svc.name, svc: svc, items: mix(rs[0].results, rs[1].results).map(function (m) { return fromTmdb(m, svc); })};
    });
  }
  // Settings → Streaming rows: the services with similar catalogues (Netflix, Disney+, Canal+...) share one row, the others (Crunchyroll...)
  // keep their own, wherever they were in the list.
  // A row with only a card or two (TMDB knows few titles for some services in some countries) is not worth a row of its own.
  var MIN_ROW_ITEMS = 4;
  function arrangeServiceRows(rows, mergedTitle) {
    rows = rows.filter(function (r) { return r && r.items.length >= MIN_ROW_ITEMS || (r && S.mergeRows && r.svc.merge !== false); });
    if (!S.mergeRows) return rows;
    var group = rows.filter(function (r) { return r.svc.merge !== false; });
    if (group.length < 2) return rows;
    var merged = mergeServiceRows(group, mergedTitle), out = [], placed = false;
    rows.forEach(function (r) {
      if (r.svc.merge === false) out.push(r);
      else if (!placed && merged) { out.push(merged); placed = true; }
    });
    return out;
  }
  // One row for all of your services instead of a row each. Every list is sorted by TMDB's own popularity, which is the common yardstick,
  // but movies and series are not on the same scale: each title is measured against the 10th most popular of its own kind, then all
  // are ranked together. A title on several services appears once and says so; opening it goes to the first of them in your list.
  function mergeServiceRows(rows, title) {
    var byKey = {}, all = [];
    rows.filter(Boolean).forEach(function (row) {
      row.items.forEach(function (it) {
        var k = it.tmdb.type + ':' + it.tmdb.id, seen = byKey[k];
        if (seen) { if (seen.svcs.indexOf(it.svc) < 0) seen.svcs.push(it.svc); return; }
        it.svcs = [it.svc]; byKey[k] = it; all.push(it);
      });
    });
    if (!all.length) return null;
    var ref = {};
    ['movie', 'tv'].forEach(function (t) {
      var pops = all.filter(function (x) { return x.tmdb.type === t; }).map(function (x) { return x.pop; }).sort(function (a, b) { return b - a; });
      ref[t] = pops.length ? pops[Math.min(9, pops.length - 1)] || 1 : 1;
    });
    all.forEach(function (x) { x.score = x.pop / ref[x.tmdb.type]; });
    all.sort(function (a, b) { return b.score - a.score; });
    all.forEach(function (x) { x.src = x.svcs.map(function (s) { return s.name; }).join(', '); x.svc = x.svcs[0]; });
    return {title: title || 'Popular on your services', items: all.slice(0, 36)};
  }
  // ---------- Picked for you ----------
  // Built from YOUR history: the titles you saved or opened from this screen. TMDB gives, for each, the titles people who liked it liked;
  // they are scored (newer and saved titles count more, a title suggested by several of yours counts more) and kept only if one of YOUR
  // services includes it in the subscription. Nothing you already opened or saved is suggested. With no history yet, it falls back to
  // the best-rated titles on your services (see topRated). Needs one call per candidate to learn where it streams; answers are kept
  // for a day (localStorage "availCache.v1") so the home screen does not ask again.
  var AVAIL_KEY = 'availCache.v1', AVAIL_TTL = 24 * 3600e3, avail = null;
  function readAvail() { if (!avail) { try { avail = JSON.parse(localStorage.getItem(AVAIL_KEY) || '{}'); } catch (e) { avail = {}; } } return avail; }
  function saveAvail() {
    var a = readAvail(), keys = Object.keys(a).sort(function (x, y) { return a[y].at - a[x].at; });
    keys.slice(500).forEach(function (k) { delete a[k]; });
    try { localStorage.setItem(AVAIL_KEY, JSON.stringify(a)); } catch (e) { /* full: asked again next time */ }
  }
  // ids of the providers that include a title in the subscription, in your region
  function flatrateIds(type, id) {
    var a = readAvail(), k = type + ':' + id, e = a[k];
    if (e && Date.now() - e.at < AVAIL_TTL) return Promise.resolve(e.ids);
    return tmdb(type + '/' + id + '/watch/providers').then(function (r) {
      var here = (r.results || {})[C.REGION] || {};
      var ids = (here.flatrate || []).map(function (p) { return p.provider_id; });
      a[k] = {at: Date.now(), ids: ids};
      return ids;
    });
  }
  // runs fn over list with at most `size` calls at a time; resolves with the results in order (null where one failed)
  function pool(list, size, fn) {
    var out = new Array(list.length), next = 0;
    function worker() {
      var i = next++;
      if (i >= list.length) return Promise.resolve();
      return fn(list[i], i).then(function (v) { out[i] = v; }, function () { out[i] = null; }).then(worker);
    }
    var ws = [];
    for (var k = 0; k < Math.min(size, list.length); k++) ws.push(worker());
    return Promise.all(ws).then(function () { return out; });
  }
  function keyOf(x) { return x.tmdb.type + ':' + x.tmdb.id; }
  function minePerProvider(providers) {
    var mine = {};
    SERVICES.forEach(function (s) { var p = providerOf(s, providers); if (p) mine[p.provider_id] = s; });
    return mine;
  }
  function forYou(providers) {
    var mine = minePerProvider(providers), saved = store('watchlist') || [], opened = store('recent') || [], seen = {}, seeds = [], owned = {}, savedKeys = {};
    saved.forEach(function (x) { if (x.tmdb) savedKeys[keyOf(x)] = 1; });
    opened.concat(saved).forEach(function (x) { if (x && x.tmdb) { owned[keyOf(x)] = 1; if (!seen[keyOf(x)]) { seen[keyOf(x)] = 1; seeds.push(x); } } });
    seeds = seeds.slice(0, 8);
    if (!seeds.length || !Object.keys(mine).length) return Promise.resolve([]);
    return pool(seeds, 4, function (sd) { return tmdb(sd.tmdb.type + '/' + sd.tmdb.id + '/recommendations').then(function (r) { return r.results || []; }); }).then(function (lists) {
      var cand = {};
      lists.forEach(function (res, si) {
        var weight = (1 - si * 0.08) * (savedKeys[keyOf(seeds[si])] ? 1.4 : 1);
        (res || []).forEach(function (m, rank) {
          var type = m.media_type || (m.title ? 'movie' : 'tv'), k = type + ':' + m.id;
          if (!m.backdrop_path || type === 'person' || owned[k]) return;
          var gain = weight * (1 - rank / 25) * (0.6 + Math.min(m.vote_average || 0, 9) / 15);
          var c = cand[k] || (cand[k] = {m: m, type: type, score: 0, best: 0, why: ''});
          c.score += gain;
          if (gain > c.best) { c.best = gain; c.why = seeds[si].title; }
        });
      });
      var ranked = Object.keys(cand).map(function (k) { return cand[k]; }).sort(function (x, y) { return y.score - x.score; }).slice(0, 45);
      return pool(ranked, 6, function (c) { return flatrateIds(c.type, c.m.id); }).then(function (ids) {
        saveAvail();
        var out = [];
        ranked.forEach(function (c, i) {
          var svcs = [];
          (ids[i] || []).forEach(function (pid) { if (mine[pid] && svcs.indexOf(mine[pid]) < 0) svcs.push(mine[pid]); });
          if (!svcs.length) return;           // not on any of your services
          var it = fromTmdb(c.m, svcs[0]);
          it.svcs = svcs; it.why = true; it.src = 'Because you viewed ' + c.why;
          out.push(it);
        });
        return out.slice(0, 30);
      });
    });
  }
  // The fallback (no history yet, or too few suggestions): the best-rated titles included in your subscriptions.
  function topRated(providers) {
    var ids = Object.keys(minePerProvider(providers));
    if (!ids.length) return Promise.resolve([]);
    var q = '&watch_region=' + C.REGION + '&with_watch_providers=' + ids.join('%7C') + '&with_watch_monetization_types=flatrate&sort_by=vote_average.desc' + langQ();
    return Promise.all([tmdb('discover/movie', q + '&vote_count.gte=1500'), tmdb('discover/tv', q + '&vote_count.gte=600')]).then(function (rs) {
      return mix(rs[0].results, rs[1].results).map(function (m) { var it = fromTmdb(m); it.why = true; it.src = 'Top rated on your services'; return it; });
    });
  }
  var NEW_DAYS = 150;
  function ago0(days) { return new Date(Date.now() - days * 864e5).toISOString().slice(0, 10); }
  function recentWindow() {
    return {tv: '&first_air_date.gte=' + ago0(NEW_DAYS) + '&first_air_date.lte=' + ago0(0) + '&vote_count.gte=3',
      movie: '&primary_release_date.gte=' + ago0(NEW_DAYS) + '&primary_release_date.lte=' + ago0(0) + '&vote_count.gte=3'};
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
    var keep = {title: it.title, sub: it.sub, meta: it.meta, img: it.img, bg: it.bg, blur: it.blur, src: it.src, svc: it.svc, params: it.params, tmdb: it.tmdb, at: Date.now()};
    recent = [keep].concat(recent.filter(function (x) { return x.title !== it.title; })).slice(0, 12);
    store('recent', recent);
    buildRows();
  }
  function ago(t) {
    var m = Math.round((Date.now() - t) / 60000);
    return m < 60 ? (m || 1) + ' min ago' : m < 1440 ? Math.round(m / 60) + ' hr ago' : Math.round(m / 1440) + ' days ago';
  }

  // OK on a title → open the service that streams it.
  // Deep links: Wikidata maps TMDB ids to a service's own title id (Netflix: P1874). Cached per title;
  // falls back to just opening the app when there's no match or Wikidata is slow.
  var DEEP = {
    netflix: {prop: 'P1874', params: function (id) { return {contentTarget: 'm=https://www.netflix.com/title/' + id + '&source_type=4'}; }},
    // JioHotstar: same link LG's voice search sends, minus /watch (that one needs an episode, this opens the show).
    hotstar: {prop: 'P11049', wait: 5000,
      lookup: function (it) { // JustWatch first (via the service), Wikidata if that finds nothing
        return svc('justwatchId', {title: it.title, tmdbId: it.tmdb.id, provider: 'hotstar'})
          .then(function (r) { return r.id || wikidataId(it, 'P11049'); }, function () { return wikidataId(it, 'P11049'); });
      },
      params: function (id) { return {contentTarget: 'https://livingroom.hotstar.com/' + id + '?utm_source=lgtv&utm_medium=partner_homepage'}; }},
    // Prime takes Amazon's title id (as LG's own voice search sends it); the service finds it by title.
    amazon: {wait: 5000, lookup: function (it) { return svc('primeGti', {title: it.title}).then(function (r) { return r.gti || null; }); },
      params: function (gti) { return {contentTarget: gti}; }}
  };
  function wikidataId(it, prop) {
    var q = 'SELECT ?v WHERE { ?i wdt:' + (it.tmdb.type === 'movie' ? 'P4947' : 'P4983') + ' "' + it.tmdb.id + '" ; wdt:' + prop + ' ?v } LIMIT 1';
    return get('https://query.wikidata.org/sparql?format=json&query=' + encodeURIComponent(q))
      .then(function (r) { var b = r.results.bindings[0]; return b ? b.v.value : null; });
  }
  function deepParams(it, app) {
    var d = DEEP[app];
    if (!d || !it.tmdb) return Promise.resolve(null);
    var key = 'v2:' + app + ':' + it.tmdb.type + ':' + it.tmdb.id, cache = {}; // v2: JustWatch added, retry old misses
    try { cache = JSON.parse(localStorage.deepIds || '{}'); } catch (e) { /* storage unavailable */ }
    if (key in cache) return Promise.resolve(cache[key] && d.params(cache[key]));
    var find = d.lookup ? d.lookup(it) : wikidataId(it, d.prop);
    var lookup = find.then(function (id) {
      cache[key] = id;
      try { localStorage.deepIds = JSON.stringify(cache); } catch (e) { /* storage unavailable */ }
      return id && d.params(id);
    });
    var timeout = new Promise(function (ok) { setTimeout(function () { ok(null); }, d.wait || 2500); });
    return Promise.race([lookup, timeout]).catch(function () { return null; });
  }
  function launchTitle(it, svc) {
    if (it.params) return launch(svc.app, it.params);
    deepParams(it, svc.app).then(function (params) { launch(svc.app, params || undefined); });
  }
  function openItem(it) {
    if (it.svc) { remember(it); return launchTitle(it, it.svc); }
    tmdb(it.tmdb.type + '/' + it.tmdb.id + '/watch/providers').then(function (r) {
      var reg = r.results[C.REGION] || {}, list = (reg.flatrate || []).concat(reg.ads || [], reg.free || []), svc;
      for (var i = 0; i < list.length && !svc; i++) { svc = svcFor(list[i].provider_name); if (svc && S.services.indexOf(svc.name) < 0) svc = null; }
      svc ? (remember(Object.assign({}, it, {svc: svc})), launchTitle(it, svc)) : toast('“' + it.title + '” isn’t on your services in ' + C.REGION);
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
      (a.img || a.icon ? '<img src="' + (a.img || 'icons/' + a.icon) + '" alt="" decoding="async">' : '<span class="txt">' + esc(a.title) + '</span>') + '</div><div class="cap">' + esc(a.title) + '</div>';
    var pic = t.querySelector('img');
    if (pic && a.img && a.icon) pic.onerror = function () { pic.onerror = null; pic.src = 'icons/' + a.icon; };
    t.onok = function () { editing ? editApp(a) : launch(a.id); };
    t.app = a;
    return t;
  }
  // Edit mode for the app lists: OK on an app opens Move / Remove instead of launching it.
  var editing = false;
  var PENCIL = '<svg viewBox="0 0 24 24" style="width:46px;height:46px"><path fill="currentColor" d="M3 17.25V21h3.75L17.8 9.94l-3.75-3.75L3 17.25zM20.7 7.04a1 1 0 0 0 0-1.41l-2.34-2.34a1 1 0 0 0-1.41 0l-1.83 1.83 3.75 3.75 1.83-1.83z"/></svg>';
  var CHECK = '<svg viewBox="0 0 24 24" style="width:50px;height:50px"><path fill="currentColor" d="M9 16.2 4.8 12l-1.4 1.4L9 19 21 7l-1.4-1.4z"/></svg>';
  // The Apps tab in edit mode: the apps of the home screen on top, the hidden ones below, and a bar to choose what OK does on a tile:
  // hide / show it, or pick it up to put it elsewhere in the order.
  var editMode = 'hide';
  function editTile() {
    var t = el('div', 'app f edit-tile', '<div class="disc">' + PENCIL + '</div><div class="cap">Edit apps</div>');
    t.onok = startEditing;
    return t;
  }
  function startEditing() { if (view !== 'apps') setView('apps'); setEditing(true); }
  function renderEditBar() {
    var bar = $('editbar'); bar.hidden = !editing; bar.innerHTML = '';
    if (!editing) return;
    [['hide', 'Hide / show'], ['order', 'Reorder']].forEach(function (m) {
      var c = el('span', 'chip f' + (editMode === m[0] ? ' sel' : ''), m[1]);
      c.onok = function () { endMove(); editMode = m[0]; renderEditBar(); buildNav(); focusEl(bar.children[m[0] === 'hide' ? 0 : 1]); };
      bar.appendChild(c);
    });
    var done = el('span', 'chip f', 'Done'); done.onok = function () { setEditing(false); }; bar.appendChild(done);
  }
  function setEditing(on) {
    editing = on;
    document.body.classList.toggle('editing', editing);
    if (!editing) endMove();
    editMode = 'hide';
    var keep = view; render(); if (keep !== view) setView(keep);
    if (editing) { pos.r = 1; pos.c = 0; focus(); }
    else { var tiles = document.querySelectorAll('.edit-tile'); for (var i = 0; i < tiles.length; i++) if (tiles[i].offsetParent) { focusEl(tiles[i]); break; } }
    toast(editing ? 'Edit mode: choose Hide / show or Reorder, then OK on an app' : 'Done');
  }
  // OK on an app in edit mode.
  function editApp(a) {
    if (editMode === 'hide') {
      var hidden = store('appHidden') || [], i = hidden.indexOf(a.id);
      if (i < 0) hidden.push(a.id); else hidden.splice(i, 1);
      store('appHidden', hidden); refreshApps();   // focus stays where it is: the next app slides into its place, handy to hide several in a row
      toast(i < 0 ? a.title + ' hidden from the home screen' : a.title + ' shown on the home screen');
    } else if (hiddenApps().some(function (h) { return h.id === a.id; })) {
      toast('Show it on the home screen first');
    } else {
      moving = a.id; focusApp(a.id); var t = document.querySelector('.focus'); if (t) t.classList.add('moving');
      toast('Left / right to move, OK when done');
    }
  }
  // How far a horizontal strip slides so that the focused tile is in the middle of the screen. The strip starts at the left margin and
  // stops sliding at both ends, so the first and last tiles do not leave an empty gap. Shared by every strip (rows, search, details).
  function stripShift(e) {
    var strip = e.parentNode, last = strip.lastElementChild, left = strip.parentNode.getBoundingClientRect().left, width = document.documentElement.clientWidth || 1920;
    var center = e.offsetLeft + e.offsetWidth / 2, end = last.offsetLeft + last.offsetWidth;
    return Math.max(0, Math.min(left + center - width / 2, left + end - (width - left)));
  }
  function focusEl(e) { for (var r = 0; r < nav.length; r++) { var c = nav[r].indexOf(e); if (c >= 0) { pos.r = r; pos.c = c; focus(); return; } } }
  function card(it) {
    var c = el('div', 'card f', '<div class="pic"><img src="' + it.img + '" alt="" loading="lazy" decoding="async">' +
      (it.src === 'YouTube' ? '' : '<b class="ttl">' + esc(it.title) + '</b>') + '</div>' +
      '<div class="cap">' + esc(it.at ? it.svc.name + '  ·  opened ' + ago(it.at) : it.src === 'YouTube' ? it.title : ((it.svcs || it.why) ? it.src + '  ·  ' : '') + it.meta) + '</div>');
    c.item = it; c.onok = function () { TV.itemOk(it); };
    return c;
  }
  function render() {
    var root = $('rows'); root.innerHTML = '';
    rowsData.forEach(function (row) {
      var r = el('section', 'row' + (row.apps ? ' apps-row' : '')), s = el('div', 'strip');
      r.appendChild(el('h3', '', esc(row.title)));
      (row.apps || row.items).forEach(function (x) { s.appendChild(row.apps ? appTile(x) : card(x)); });
      if (row.apps) s.appendChild(editTile());
      r.appendChild(s); root.appendChild(r);
    });
    var g = $('grid'); g.innerHTML = '';
    var shown = visibleApps(), hid = hiddenApps();
    if (editing) {
      g.appendChild(el('h3', 'gh', 'On the home screen'));
      shown.forEach(function (a) { g.appendChild(appTile(a)); });
      g.appendChild(el('h3', 'gh', 'Hidden apps'));
      if (hid.length) hid.forEach(function (a) { g.appendChild(appTile(a)); }); else g.appendChild(el('p', 'gh dim', 'No hidden app'));
    } else {
      // the Apps tab lists every app: the ones of the home screen, then (if any) the hidden ones in a list of their own
      shown.forEach(function (a) { g.appendChild(appTile(a)); });
      g.appendChild(editTile());
      if (hid.length) { g.appendChild(el('h3', 'gh', 'Hidden apps')); hid.forEach(function (a) { g.appendChild(appTile(a)); }); }
    }
    renderEditBar();
    buildNav();
  }

  var SROWS = [
    {key: 'uiLang', title: 'Interface language', hint: 'Menus and messages. The languages of the suggested films are set separately, below', opts: [['fr', 'Français'], ['en', 'English']]},
    {key: 'region', title: 'Country', hint: 'Where to look up what’s streaming', opts: COUNTRIES},
    {key: 'langs', title: 'Recommendation languages', hint: 'Languages of the suggested films and series, not of the menus. Pick any; none = every language', many: true, opts: LANGS},
    {key: 'services', title: 'Your streaming services', hint: 'Their popular titles show up in the rows below', many: true, opts: C.SERVICES.map(function (x) { return [x.name, x.name]; })},
    {key: 'mergeRows', title: 'Streaming rows', hint: 'Services with similar catalogues (Netflix, Disney+, Canal+...) in one row; Crunchyroll and YouTube keep their own', opts: [[true, 'Similar services together'], [false, 'One row per service']]},
    {key: 'newRow', title: 'New on your services row', hint: 'Recent releases included in your subscriptions', opts: [[true, 'On'], [false, 'Off']]},
    {key: 'youtube', title: 'Trending on YouTube row', opts: [[true, 'On'], [false, 'Off']]},
    {key: 'autoplay', title: 'Rotate featured titles', opts: [[true, 'On'], [false, 'Off']]},
    {key: 'liveTab', title: 'Live TV tab', hint: 'The Live tab at the top of the home screen', opts: [[true, 'Show'], [false, 'Hide']]},
    {key: 'profileBtn', title: 'Profile button', hint: 'The round button at the top left; profiles stay available in the settings', opts: [[true, 'Show'], [false, 'Hide']]},
    {key: 'clock24', title: 'Clock', opts: [[false, '12-hour'], [true, '24-hour']]},
    {key: 'iconShape', title: 'App icon shape', hint: 'A full circle, or a square with rounded corners', opts: [['circle', 'Circle'], ['rounded', 'Rounded square']]},
    {key: 'weatherCity', title: 'Weather city', hint: 'Auto finds your city from your internet connection', opts: [['auto', 'Auto'], ['Lyon', 'Lyon'], ['Paris', 'Paris'], ['Marseille', 'Marseille'], ['Toulouse', 'Toulouse'],
      ['Mumbai', 'Mumbai'], ['Delhi', 'Delhi'], ['Bengaluru', 'Bengaluru'], ['Hyderabad', 'Hyderabad'], ['Chennai', 'Chennai'],
      ['Kolkata', 'Kolkata'], ['Pune', 'Pune'], ['Ahmedabad', 'Ahmedabad'], ['Jaipur', 'Jaipur'], ['Lucknow', 'Lucknow'],
      ['Chandigarh', 'Chandigarh'], ['Kochi', 'Kochi'], ['off', 'Off']]},
    {key: 'unhide', title: 'Your apps', hint: 'Hold OK on an app to move or remove it', opts: [['unhide', 'Show hidden apps']]},
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
  // Settings can be reached from the quick settings panel. Back then goes one step back to that panel; the X button closes everything.
  var settingsFromQuick = false;
  function openSettings() {
    settingsFromQuick = false;
    draft = JSON.parse(JSON.stringify(S)); dirty = false; prevView = view;
    renderSettings(); $('spanel').hidden = $('sdim').hidden = false; pos.r = 1; pos.c = 0; mem = {}; view = 'settings'; buildNav();
  }
  // `back`: the Back key (one step back, to the quick settings if that is where we came from); otherwise the X button (close everything).
  function closeSettings(back) {
    var toQuick = back === true && settingsFromQuick;
    settingsFromQuick = false;
    if (dirty) {
      store('settings', draft); store('homeCache', null);
      // changed settings rebuild the home screen by reloading the page; remember to reopen the quick settings afterwards
      if (toQuick) { try { sessionStorage.setItem('reopenQuick', '1'); } catch (e) { /* storage unavailable: lands on the home screen */ } }
      location.reload(); return;
    }
    $('spanel').hidden = $('sdim').hidden = true; pos.r = 0; setView(prevView);
    if (toQuick) openQuick();
  }
  function openSettingsFromQuick() { closeQuick(); openSettings(); settingsFromQuick = true; }
  function choose(e) {
    var row = SROWS[+e.dataset.r], o = row.opts[+e.dataset.i], v = draft[row.key];
    if (row.key === 'unhide') { store('appHidden', []); refreshApps(); return toast('Hidden apps are back'); }
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
    setText('qdate', d.toLocaleDateString(window.UI_LOCALE || 'en-US', {weekday: 'short', month: 'short', day: 'numeric'}));
    setText('qtime', $('clock').textContent + (S.clock24 ? '' : d.getHours() < 12 ? ' AM' : ' PM'));
    if (!onTV) { setText('qwifi', 'Home Wi-Fi'); setText('qaudio', 'TV speaker'); setText('qbt', 'On'); setText('qvol', '37'); return; }
    luna('com.webos.service.connectionmanager/getStatus').then(function (r) {
      setText('qwifi', r.wifi && r.wifi.state === 'connected' ? r.wifi.displayName || r.wifi.ssid || 'Connected' : r.wired && r.wired.state === 'connected' ? 'Ethernet' : 'Not connected');
    }, function () { setText('qwifi', ''); });
    luna('com.webos.service.audio/getSoundOutput').then(function (r) { setText('qaudio', OUTPUTS[r.soundOutput] || r.soundOutput); }, function () {});
    luna('com.webos.service.bluetooth2/adapter/getStatus').then(function (r) { setText('qbt', r.adapters && r.adapters[0] && r.adapters[0].powered ? 'On' : 'Off'); }, function () {});
    luna('com.webos.audio/getVolume').then(function (r) { setText('qvol', r.muteStatus ? 'Muted' : r.volume); }, function () {});
    svc('getAv').then(function (r) {
      av.pic = r.picture.pictureMode; av.snd = r.sound.soundMode; av.bl = +r.picture.backlight;
      setText('qpic', label(PICS, av.pic)); setText('qsnd', label(SOUNDS, av.snd)); setText('qbl', isNaN(av.bl) ? '–' : av.bl);
    }, function () { setText('qpic', 'Needs root'); setText('qsnd', 'Needs root'); });
    svc('getInputs').then(function (r) {
      $('qinputs').innerHTML = r.inputs.filter(function (i) { return i.connected || /hdmi/i.test(i.id); }).map(function (i) {
        return '<span class="chip f' + (i.active ? ' sel' : '') + '" data-q="input" data-id="' + esc(i.id) + '">' + esc(i.label) + (i.connected ? '' : ' ·') + '</span>';
      }).join('');
      if (view === 'quick') buildNav();
    }, function () { $('qinputs').innerHTML = '<span class="chip f" data-q="inputs">Inputs</span>'; if (view === 'quick') buildNav(); });
  }
  // Picture / sound modes this TV offers (an unsupported one is skipped with a toast).
  var PICS = [['vivid', 'Vivid'], ['normal', 'Standard'], ['eco', 'Eco'], ['cinema', 'Cinema'], ['sports', 'Sports'], ['game', 'Game'], ['filmMaker', 'Filmmaker']];
  var SOUNDS = [['aiSoundPlus', 'AI Sound Pro'], ['standard', 'Standard'], ['movie', 'Cinema'], ['news', 'Clear Voice'], ['music', 'Music'], ['game', 'Game']];
  var av = {};
  function label(list, v) { for (var i = 0; i < list.length; i++) if (list[i][0] === v) return list[i][1]; return v || ''; }
  function next(list, v) { for (var i = 0; i < list.length; i++) if (list[i][0] === v) return list[(i + 1) % list.length][0]; return list[0][0]; }
  function setAv(method, params, ok) {
    svc(method, params).then(function (r) { r.returnValue === false ? toast('Not supported on this TV') : ok(); }, function () { toast('Needs the TV Home service (rooted TV)'); });
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
  function quickAct(q, btn) {
    var tvSettings = function (target) { launch('com.palm.app.settings', {target: target}); };
    ({
      settings: openSettingsFromQuick,
      tip: openSettingsFromQuick,
      close: closeQuick,
      screensaver: function () { launch('com.webos.app.screensaver'); },
      // webOS 25 has no visible inputcommon window (it is a transparent native card: a black screen). Its input picker is the
      // overlay app quickinputpicker; keep inputcommon for firmware that does not have it.
      inputs: function () {
        closeQuick();
        luna('com.webos.applicationManager/getAppLoadStatus', {appId: 'com.webos.app.quickinputpicker'})
          .then(function (r) { launch(r.exist ? 'com.webos.app.quickinputpicker' : 'com.webos.app.inputcommon'); }, function () { launch('com.webos.app.inputcommon'); });
      },
      wifi: function () { tvSettings('network'); },
      a11y: function () { tvSettings('accessibility'); },
      audio: function () { tvSettings('sound'); },
      bluetooth: function () { tvSettings('bluetooth'); },
      picture: function () { var m = next(PICS, av.pic); setAv('setPicture', {pictureMode: m}, function () { av.pic = m; setText('qpic', label(PICS, m)); }); },
      sound: function () { var m = next(SOUNDS, av.snd); setAv('setSound', {soundMode: m}, function () { av.snd = m; setText('qsnd', label(SOUNDS, m)); }); },
      bldown: function () { var b = Math.max(0, (av.bl || 0) - 10); setAv('setPicture', {backlight: b}, function () { av.bl = b; setText('qbl', b); }); },
      blup: function () { var b = Math.min(100, (av.bl || 0) + 10); setAv('setPicture', {backlight: b}, function () { av.bl = b; setText('qbl', b); }); },
      screenoff: function () { closeQuick(); svc('screenOff').then(function () {}, function () { toast('Needs the TV Home service (rooted TV)'); }); },
      input: function () { closeQuick(); launch(btn.dataset.id); },
      voldown: function () { volume('volumeDown'); },
      volup: function () { volume('volumeUp'); }
    })[q]();
  }

  // ---------- hero / background ----------
  var heroIdx = 0, bgFlip = false, blurFlip = false, lastBg, lastBlur, bgTimer;
  // Puts `src` in an <img> and calls `done` once it shows (Chrome fires `load` on every assignment, even of a src the element already had).
  function loadInto(img, src, done) { img.onload = done; img.src = src; }
  // The blurred background is BAKED: each picture is drawn once into a tiny canvas (128x72) with the blur, saturation and darkening applied
  // there, and the browser's smooth upscaling does the rest. Nothing is blurred on screen any more: a change of background is only the
  // opacity of two stacked layers, over textures a few KB big. The cards around the focus are baked ahead of time (see warm).
  var BAKE_W = 128, BAKE_H = 72, baked = {}, bakedOrder = [];
  function bake(src) {
    if (baked[src]) return baked[src];
    var p = baked[src] = new Promise(function (resolve, reject) {
      var im = new Image();
      im.onload = function () {
        var c = document.createElement('canvas'), x = c.getContext('2d');
        c.width = BAKE_W; c.height = BAKE_H;
        var pad = 10, W = BAKE_W + pad * 2, H = BAKE_H + pad * 2;                 // draw larger than the canvas so the blur has no pale edge
        var k = Math.max(W / im.naturalWidth, H / im.naturalHeight), w = im.naturalWidth * k, h = im.naturalHeight * k;
        if ('filter' in x) x.filter = 'blur(4px) saturate(1.4) brightness(.7)';
        x.drawImage(im, (BAKE_W - w) / 2, (BAKE_H - h) / 2, w, h);
        resolve(c);
      };
      im.onerror = reject; im.src = src;
    });
    p.catch(function () { delete baked[src]; });
    bakedOrder.push(src);
    if (bakedOrder.length > 60) delete baked[bakedOrder.shift()];
    return p;
  }
  function loadBlur(layer, src) {
    return bake(src).then(function (c) { var x = layer.getContext('2d'); x.clearRect(0, 0, BAKE_W, BAKE_H); x.drawImage(c, 0, 0); });
  }
  function loadImg(el, src) {
    return new Promise(function (resolve, reject) {
      el.onload = function () { el.onload = null; (el.decode ? el.decode() : Promise.resolve()).then(resolve, resolve); };
      el.onerror = reject; el.src = src;
    });
  }
  // Cross-fades between two stacked layers. The new picture is prepared off-screen on the hidden layer, then fades in ON TOP of the
  // old one, which stays opaque until it is covered (fading both leaves a moment when neither is opaque). A change asked for while a fade is
  // running waits for it to end and only the latest request is then shown, so a layer is never reused while still visible (that popped in
  // instantly) and a fast run of key presses costs one fade, not one per card.
  var FADE_MS = 400;
  function makeFader(a, b, load) {
    var front = b, shown, wanted, wantedLow, busy = false;
    function finish(src, back, cur) {
      setTimeout(function () {
        cur.style.transition = 'none'; cur.className = ''; cur.style.zIndex = 0;
        busy = false; front = back; shown = src; go();
      }, FADE_MS + 40);
    }
    function go() {
      if (busy || wanted === shown) return;
      var src = wanted, first = wantedLow || wanted, back = front === a ? b : a, cur = front;
      busy = true;
      back.style.transition = 'none'; back.className = ''; back.style.zIndex = 1; cur.style.zIndex = 0;
      var abandon = function () { busy = false; if (wanted !== shown) { shown = src; go(); } };
      var reveal = function () {
        if (wanted !== src) return abandon();       // moved on while loading: skip this one
        // Paint the new layer once, invisibly (opacity .01), before fading it in, so the first frame of the fade is not the costly one.
        back.style.transition = 'none'; back.style.opacity = '.01'; back.className = 'on';
        requestAnimationFrame(function () { requestAnimationFrame(function () {
          void back.offsetWidth; back.style.transition = ''; back.style.opacity = '';
          finish(src, back, cur);
        }); });
        if (first !== src && load === loadImg) { var big = new Image(); big.onload = function () { if (shown === src || (busy && wanted === src)) (big.decode ? big.decode() : Promise.resolve()).then(function () { back.src = src; }, function () {}); }; big.src = src; }
      };
      load(back, first).then(reveal, abandon);
    }
    return {show: function (src, low) { wanted = src; wantedLow = low; go(); }};
  }
  var bgFader = makeFader($('bgA'), $('bgB'), loadImg), blurFader = makeFader($('bgBlur'), $('bgBlur2'), loadBlur);
  function setBlur(src) { if (src && src !== lastBlur) { lastBlur = src; blurFader.show(src); } }
  // Swap backgrounds only once focus rests, so holding an arrow key doesn't decode/blur every card.
  function bgFor(it, scrolled) {
    clearTimeout(bgTimer);
    bgTimer = setTimeout(function () {
      if (scrolled) setBlur(it && it.blur); else { var h = it || heroItems[heroIdx]; if (h) setBg(h.bg, h.blur); }
    }, 170);
    clearTimeout(warmTimer); warmTimer = setTimeout(warm, 150);
  }
  // The background is blurred, so the cards around the focus only need the small picture, fetched ahead of the move: the next press then
  // finds it cached. The focused card gets the full-size one (it is the one likely to be opened, and its sharp background shows at the top).
  var warmTimer, warmed = {}, warmKeep = [];
  function fetchAhead(src) {
    if (!src || warmed[src]) return; warmed[src] = 1;
    var im = new Image(); im.src = src; warmKeep.push(im);
    if (warmKeep.length > 80) warmKeep.shift();
  }
  function bakeAhead(src) { if (src) bake(src).catch(function () {}); }
  function warm() {
    var cur = nav[pos.r] && nav[pos.r][pos.c]; if (!cur || !cur.item) return;
    bakeAhead(cur.item.blur); fetchAhead(cur.item.bg);
    [[0, 1], [0, -1], [0, 2], [0, -2], [1, 0], [-1, 0], [0, 3], [1, 1], [-1, 1], [0, 4], [0, 5], [0, 6], [0, -3], [0, -4]].forEach(function (d) {
      var row = nav[pos.r + d[0]]; if (!row) return;
      var c = d[0] ? Math.min(pos.c + d[1], row.length - 1) : pos.c + d[1], e = row[c];
      if (e && e.item) bakeAhead(e.item.blur);
    });
  }
  // `low` (the small picture, usually cached by warm) shows straight away, then the full-size one replaces it once loaded.
  function setBg(src, low) { if (src && src !== lastBg) { lastBg = src; bgFader.show(src, low); } }
  function showHero() {
    var it = heroItems[heroIdx]; if (!it) return;
    $('heroSrc').textContent = it.src;
    $('heroTitle').textContent = it.title;
    $('heroMeta').textContent = it.meta || '';
    $('heroSub').textContent = it.sub || '';
    $('heroBtn').textContent = it.svc ? 'Open in ' + it.svc.name : 'Where to watch';
    $('dots').innerHTML = heroItems.map(function (_, i) { return '<i' + (i === heroIdx ? ' class="on"' : '') + '></i>'; }).join('');
    setBg(it.bg, it.blur);
  }
  function stepHero(d) { heroIdx = (heroIdx + d + heroItems.length) % heroItems.length; showHero(); }
  var idleSince = Date.now();
  setInterval(function () { if (S.autoplay && view === 'home' && pos.r <= 1 && Date.now() - idleSince > 7000) stepHero(1); }, 8000);

  // ---------- navigation (keys + pointer) ----------
  var nav = [], pos = {r: 0, c: 0}, mem = {}, view = 'home', prevView = 'home';
  function all(sel) { return [].slice.call(document.querySelectorAll(sel)); }
  function buildNav() {
    var top = all('#top .f').filter(function (e) { return !e.classList.contains('off'); });
    if (views[view]) {
      nav = views[view].nav();
    } else if (view === 'quick') {
      nav = all('#quick .qrow').map(function (r) { return [].slice.call(r.querySelectorAll('.f')); });
    } else if (view === 'settings') {
      nav = [[$('sclose')]].concat(all('#settings .strip').map(function (s) { return [].slice.call(s.children); }));
    } else if (view === 'home') {
      nav = [top, [$('heroBtn')]].concat(all('#rows .strip').map(function (s) { return [].slice.call(s.children); }));
    } else {
      // rows are whatever the tiles actually wrap into (their top edge), not an assumed number of columns
      var tiles = all('#grid .app'), rowTop = null, line;
      nav = [top];
      if (editing) nav.push([].slice.call($('editbar').children));
      tiles.forEach(function (t) { if (t.offsetTop !== rowTop) { rowTop = t.offsetTop; line = []; nav.push(line); } line.push(t); });
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
    if (strip.classList.contains('strip') && view !== 'settings') strip.style.transform = 'translateX(' + -stripShift(e) + 'px)';
    else if (strip.classList.contains('strip')) strip.style.transform = 'translateX(' + -Math.max(0, e.offsetLeft - (pos.c ? 40 : 0)) + 'px)'; // chips of the settings sheet
    var section = e.closest('.row, .srow');
    var dy = 0, max = Math.max(0, $(view).scrollHeight - 1080 + 40);   // stop at the last row
    if (view === 'home') {
      // The focused row sits in the middle of the screen, but never higher up than the first row of cards (which hides the hero).
      var first = $('rows').querySelector('.row');
      if (section && section.previousElementSibling) dy = Math.max(first ? first.offsetTop - 90 : 0, section.offsetTop + section.offsetHeight / 2 - 540);
    } else {
      var box = section || e;
      dy = box.offsetTop + box.offsetHeight / 2 - 540;
    }
    dy = Math.max(0, Math.min(dy, max));
    $(view).style.transform = 'translateY(' + -dy + 'px)';
    if (view === 'settings') return;
    document.body.classList.toggle('scrolled', dy > 0);
    bgFor(e.item, dy > 0);
  }
  function setView(v) {
    // leaving a page ends the edit mode: it must not follow the user to the other page
    var wasEditing = editing && v !== view;
    if (wasEditing) { editing = false; document.body.classList.remove('editing'); endMove(); }
    view = v; $('home').hidden = v !== 'home'; $('apps').hidden = v !== 'apps';
    all('.tab').forEach(function (t) { t.classList.toggle('cur', t.dataset.tab === v); });
    $('bg').style.opacity = v === 'home' ? 1 : 0;
    ['bgBlur', 'bgBlur2'].forEach(function (id) { $(id).style.visibility = v === 'home' || v === 'settings' || v === 'quick' ? '' : 'hidden'; });
    document.body.classList.toggle('scrolled', v !== 'home');
    buildNav();
    if (wasEditing) render();
  }
  function activate(e) {
    if (e.dataset.tab) return setView(e.dataset.tab);
    if (e.dataset.view) return openView(e.dataset.view);
    if (e.dataset.act === 'live') return launch('com.webos.app.livetv');
    if (e.id === 'avatar') return TV.onAvatar();
    if (e.dataset.act === 'settings') return openQuick();
    if (e.dataset.act === 'weather') return openView('weather');
    if (e.dataset.q) return quickAct(e.dataset.q, e);
    if (e.dataset.r) return choose(e);
    if (e.id === 'sclose') return closeSettings();
    if (e.id === 'heroBtn') return TV.itemOk(heroItems[heroIdx]);
    if (e.onok) e.onok();
  }
  // Column to land on when moving to row `to`. Rows of cards each remember their own column; the grid of apps is a real grid,
  // so there the column stays the same (the focus() clamp handles a shorter last row).
  function columnFor(to) { return view === 'apps' && pos.r > 0 && to > 0 ? pos.c : (mem[to] || 0); }
  var holdTimer = 0, holdFired = false, moving = null;
  document.addEventListener('keyup', function (ev) {
    if (ev.keyCode !== 13) return;
    if (holdTimer) { clearTimeout(holdTimer); holdTimer = 0; var cur = nav[pos.r] && nav[pos.r][pos.c]; if (cur && cur.onok) cur.onok(); }
    holdFired = false;
  });
  document.addEventListener('keydown', function (ev) {
    if (document.activeElement && document.activeElement.tagName === 'INPUT') return;   // a text field has the TV keyboard: keys are its own
    if (moving && (ev.keyCode === 37 || ev.keyCode === 39)) { ev.preventDefault(); return moveApp(ev.keyCode === 39 ? 1 : -1); }
    if (moving && (ev.keyCode === 461 || ev.keyCode === 27 || ev.keyCode === 8)) { ev.preventDefault(); return endMove(); }
    var k = ev.keyCode, onHero = view === 'home' && pos.r === 1;
    idleSince = Date.now();
    if (views[view] && views[view].keydown && views[view].keydown(ev)) { ev.preventDefault(); return; } // view handled it
    if (k === 37) { if (onHero) stepHero(-1); else pos.c--; }
    else if (k === 39) { if (onHero) stepHero(1); else pos.c++; }
    else if (k === 38) { if (pos.r > 0) { pos.c = columnFor(pos.r - 1); pos.r--; } }
    else if (k === 40) { if (pos.r < nav.length - 1) { pos.c = columnFor(pos.r + 1); pos.r++; } }
    else if (k === 13) {
      ev.preventDefault();
      var cur = nav[pos.r][pos.c];
      if (moving) return endMove();
      if (cur && cur.app && !editing) { // app tile: launch on release, menu if held
        if (!ev.repeat && !holdTimer) holdTimer = setTimeout(function () { holdTimer = 0; holdFired = true; startEditing(); }, 550);
        return;
      }
      return activate(cur);
    }
    else if (k === 461 || k === 27 || k === 8) { if (editing && !views[view]) { ev.preventDefault(); return setEditing(false); } // Back cancels the edit mode first
      if (views[view]) return views[view].back ? views[view].back() : closeView(); if (view === 'settings') return closeSettings(true); if (view === 'quick') return closeQuick(); if (view !== 'home') setView('home'); else { pos.r = 1; pos.c = 0; } }
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
    else if (dy > 0 && pos.r < nav.length - 1) { pos.c = columnFor(pos.r + 1); pos.r++; }
    else if (dy < 0 && pos.r > 0) { pos.c = columnFor(pos.r - 1); pos.r--; }
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

  // ---------- weather (Open-Meteo, no key) ----------
  var WX = { // 24px stroke icons
    sun: '<circle cx="12" cy="12" r="4.5"/><path d="M12 2v2.5M12 19.5V22M2 12h2.5M19.5 12H22M4.9 4.9l1.8 1.8M17.3 17.3l1.8 1.8M4.9 19.1l1.8-1.8M17.3 6.7l1.8-1.8"/>',
    moon: '<path d="M20 14.5A8.5 8.5 0 0 1 9.5 4a8.5 8.5 0 1 0 10.5 10.5z"/>',
    cloud: '<path d="M7 18h10.5a4 4 0 0 0 .3-8A6 6 0 0 0 6.2 10.4 3.8 3.8 0 0 0 7 18z"/>',
    rain: '<path d="M7 15h10.5a4 4 0 0 0 .3-8A6 6 0 0 0 6.2 7.4 3.8 3.8 0 0 0 7 15zM9 18l-1 3M13 18l-1 3M17 18l-1 3"/>',
    snow: '<path d="M7 15h10.5a4 4 0 0 0 .3-8A6 6 0 0 0 6.2 7.4 3.8 3.8 0 0 0 7 15zM8.5 19h.01M12 21h.01M15.5 19h.01"/>',
    storm: '<path d="M7 15h10.5a4 4 0 0 0 .3-8A6 6 0 0 0 6.2 7.4 3.8 3.8 0 0 0 7 15zM13 15l-2.5 4h3L11 23"/>',
    fog: '<path d="M4 9h16M6 13h12M4 17h16"/>',
    partly: '<circle cx="8.5" cy="8.5" r="3.2"/><path d="M8.5 2.5v1.3M2.5 8.5h1.3M4.3 4.3l.9.9M12.7 4.3l-.9.9"/><path d="M9 20h8.5a3.6 3.6 0 0 0 .3-7.2A5.3 5.3 0 0 0 8.2 13.4 3.3 3.3 0 0 0 9 20z"/>'
  };
  function wxIcon(code, day) {
    return code <= 1 ? (day ? 'sun' : 'moon') : code === 2 ? (day ? 'partly' : 'cloud') : code <= 3 ? 'cloud' : code <= 48 ? 'fog' :
      (code >= 71 && code <= 77) || code === 85 || code === 86 ? 'snow' : code >= 95 ? 'storm' : 'rain';
  }
  function wxSvg(code, day) {
    return '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">' + WX[wxIcon(code, day)] + '</svg>';
  }
  function weatherLoc() {
    var city = S.weatherCity || 'auto', saved = store('weatherLoc');
    if (saved && saved.city === city) return Promise.resolve(saved);
    var find = city === 'auto'
      ? get('https://ipapi.co/json/').then(function (r) { return {lat: r.latitude, lon: r.longitude, name: r.city}; })
      : get('https://geocoding-api.open-meteo.com/v1/search?count=1&name=' + encodeURIComponent(city))
        .then(function (r) { var g = r.results[0]; return {lat: g.latitude, lon: g.longitude, name: g.name}; });
    return find.then(function (l) { l.city = city; store('weatherLoc', l); return l; });
  }
  function weather() {
    if (S.weatherCity === 'off') return;
    weatherLoc().then(function (l) {
      return get('https://api.open-meteo.com/v1/forecast?current=temperature_2m,is_day&daily=weather_code&forecast_days=1&timezone=auto&latitude=' + l.lat + '&longitude=' + l.lon)
        .then(function (r) {
          var c = r.current, w = $('weather');
          // the icon is the day's forecast (its most notable weather), the number the temperature now
          w.innerHTML = wxSvg(r.daily.weather_code[0], c.is_day) + Math.round(c.temperature_2m) + '°';
          w.title = l.name; w.hidden = false;
        });
    }).catch(function (e) { console.warn('weather', e); });
  }
  weather(); setInterval(weather, 15 * 60 * 1000);
  $('avatar').textContent = C.NAME;
  if (S.liveTab === false) document.querySelector('[data-act=live]').classList.add('off');
  if (S.profileBtn === false) $('avatar').classList.add('off');
  document.querySelector('.qav').textContent = C.NAME;
  $('qdim').onclick = function () { closeQuick(); };
  $('sdim').onclick = function () { closeSettings(); };

  // ---------- move / remove apps ----------
  function refreshApps() {
    base.forEach(function (row) { if (row.apps) row.apps = visibleApps(); });
    buildRows();
  }
  function focusApp(id) { // put focus back on an app tile after re-rendering
    for (var r = 0; r < nav.length; r++) for (var c = 0; c < nav[r].length; c++) if (nav[r][c].app && nav[r][c].app.id === id) { pos.r = r; pos.c = c; focus(); return; }
  }
  function moveApp(d) {
    var list = visibleApps().map(function (a) { return a.id; }), i = list.indexOf(moving), j = i + d;
    if (i < 0 || j < 0 || j >= list.length) return;
    list[i] = list[j]; list[j] = moving;
    store('appOrder', list); refreshApps(); focusApp(moving);
    var t = document.querySelector('.focus'); if (t) t.classList.add('moving');
  }
  function endMove() { if (!moving) return; moving = null; var t = document.querySelector('.moving'); if (t) t.classList.remove('moving'); toast('Saved'); }

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
    card: card, esc: esc, el: el, toast: toast, setBg: setBg, setBlur: setBlur, stripShift: stripShift,
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
  // ---------- weather side panel ----------
  var WXTEXT = {0: 'Clear', 1: 'Mostly clear', 2: 'Partly cloudy', 3: 'Cloudy', 45: 'Fog', 48: 'Fog', 51: 'Light drizzle', 53: 'Drizzle',
    55: 'Heavy drizzle', 61: 'Light rain', 63: 'Rain', 65: 'Heavy rain', 66: 'Freezing rain', 67: 'Freezing rain', 71: 'Light snow',
    73: 'Snow', 75: 'Heavy snow', 77: 'Snow grains', 80: 'Rain showers', 81: 'Rain showers', 82: 'Heavy showers', 85: 'Snow showers',
    86: 'Snow showers', 95: 'Thunderstorm', 96: 'Thunderstorm, hail', 99: 'Thunderstorm, hail'};
  var wxPanel = el('div', '', ''), wxDim = el('div', '', '');
  wxPanel.id = 'wxpanel'; wxDim.id = 'wxdim'; wxPanel.hidden = wxDim.hidden = true;
  document.body.appendChild(wxDim); document.body.appendChild(wxPanel);
  wxDim.onclick = function () { closeView(); };
  function hhmm(iso) { var h = +iso.slice(11, 13), m = iso.slice(14, 16); return S.clock24 ? iso.slice(11, 16) : (h % 12 || 12) + ':' + m + (h < 12 ? ' AM' : ' PM'); }
  function renderWx(l, r) {
    var c = r.current, d = r.daily, h = r.hourly, now = c.time.slice(0, 13), start = 0;
    while (start < h.time.length - 1 && h.time[start].slice(0, 13) < now) start++;
    var hours = '', days = '';
    for (var i = start; i < start + 12 && i < h.time.length; i++) {
      hours += '<div class="wxh"><span>' + (i === start ? 'Now' : hhmm(h.time[i]).replace(':00', '')) + '</span>' + wxSvg(h.weather_code[i], h.is_day[i]) + '<b>' + Math.round(h.temperature_2m[i]) + '°</b></div>';
    }
    for (var j = 0; j < d.time.length; j++) {
      var name = j === 0 ? 'Today' : new Date(d.time[j] + 'T12:00').toLocaleDateString(window.UI_LOCALE || 'en-US', {weekday: 'short'});
      days += '<div class="wxd"><span>' + name + '</span>' + wxSvg(d.weather_code[j], 1) + '<i>' + (d.precipitation_probability_max[j] ? d.precipitation_probability_max[j] + '%' : '') +
        '</i><b>' + Math.round(d.temperature_2m_max[j]) + '°</b><em>' + Math.round(d.temperature_2m_min[j]) + '°</em></div>';
    }
    wxPanel.innerHTML = '<div class="wxtop"><div><div class="wxcity">' + esc(l.name) + '</div><div class="wxnow">' + wxSvg(c.weather_code, c.is_day) +
      '<span>' + Math.round(c.temperature_2m) + '°</span></div><div class="wxcond">' + (WXTEXT[c.weather_code] || '') + '  ·  H ' + Math.round(d.temperature_2m_max[0]) +
      '°  L ' + Math.round(d.temperature_2m_min[0]) + '°</div></div><span class="wxbtn f" data-wx="close">&#10005;</span></div>' +
      '<div class="wxstats"><div><small>Feels like</small>' + Math.round(c.apparent_temperature) + '°</div><div><small>Humidity</small>' + c.relative_humidity_2m +
      '%</div><div><small>Wind</small>' + Math.round(c.wind_speed_10m) + ' km/h</div><div><small>Sunrise</small>' + hhmm(d.sunrise[0]) + '</div><div><small>Sunset</small>' + hhmm(d.sunset[0]) + '</div></div>' +
      '<h4>Next 12 hours</h4><div class="wxhours">' + hours + '</div><h4>Next ' + d.time.length + ' days</h4><div class="wxdays">' + days + '</div>' +
      '<div class="wxfoot"><span class="wxbtn wide f" data-wx="city">Change city</span><small>Open-Meteo</small></div>';
    wxPanel.querySelector('[data-wx=close]').onok = closeView;
    wxPanel.querySelector('[data-wx=city]').onok = function () { closeView(); openSettings(); };
    buildNav();
  }
  views.weather = {
    nav: function () { return [].slice.call(wxPanel.querySelectorAll('.f')).map(function (e) { return [e]; }); },
    show: function () {
      wxPanel.hidden = wxDim.hidden = false;
      wxPanel.innerHTML = '<div class="wxtop"><div class="wxload">Loading weather…</div><span class="wxbtn f" data-wx="close">&#10005;</span></div>';
      wxPanel.querySelector('[data-wx=close]').onok = closeView;
      weatherLoc().then(function (l) {
        return get('https://api.open-meteo.com/v1/forecast?timezone=auto&forecast_days=6&latitude=' + l.lat + '&longitude=' + l.lon +
          '&current=temperature_2m,apparent_temperature,relative_humidity_2m,wind_speed_10m,weather_code,is_day' +
          '&hourly=temperature_2m,weather_code,is_day&daily=weather_code,temperature_2m_max,temperature_2m_min,sunrise,sunset,precipitation_probability_max')
          .then(function (r) { if (TV.view() === 'weather') renderWx(l, r); });
      }).catch(function () { wxPanel.querySelector('.wxload').textContent = 'Couldn’t load the weather. Check the connection.'; });
    },
    hide: function () { wxPanel.hidden = wxDim.hidden = true; }
  };

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
  function booted() { // fade the loading screen once the (non-blocking) stylesheets have loaded too
    if (document.readyState !== 'complete') return window.addEventListener('load', booted, {once: true});
    var b = $('boot'); if (b) { b.classList.add('gone'); setTimeout(function () { b.remove(); }, 700); }
  }
  var cached = store('homeCache');
  if (cached && cached.base && cached.base.length) {
    heroItems = cached.hero; base = cached.base;
    buildRows(); showHero(); pos.r = 1; focus(); booted();
  }
  var tries = 0;
  function loadHome() { return loadApps().then(function () {
    var safe = function (p) { return p.catch(function (e) { console.warn(e); return null; }); };
    return safe(tmdb('watch/providers/tv', '&watch_region=' + C.REGION)).then(function (pr) {
      var providers = pr ? pr.results : [];
      var rowsFor = function (extra, titleOf) { return Promise.all(SERVICES.map(function (sv) { return safe(serviceRow(sv, providers, extra, titleOf && titleOf(sv))); })); };
      return Promise.all([
        providers.length ? safe(forYou(providers)) : null,
        providers.length ? safe(topRated(providers)) : null,
        rowsFor(),
        S.newRow ? rowsFor(recentWindow(), function (sv) { return 'New on ' + sv.name; }) : null,
        S.youtube ? safe(youtube()) : null
      ]);
    }).then(function (r) {
      var mine = r[0] || [], rated = r[1] || [], popular = arrangeServiceRows(r[2] || []), fresh = r[3] ? arrangeServiceRows(r[3], 'New on your services') : [];
      // "Picked for you": your own suggestions first, completed by the best-rated titles on your services when there are few
      var taken = {}, picks = [];
      mine.concat(rated).forEach(function (it) { var k = keyOf(it); if (!taken[k]) { taken[k] = 1; picks.push(it); } });
      // "New on your services" does not repeat what is picked for you; "Popular on your services" shows what is popular, wherever else it appears
      fresh = fresh.map(function (row) { return {title: row.title, svc: row.svc, items: row.items.filter(function (it) { return !taken[keyOf(it)]; })}; })
        .filter(function (row) { return row.items.length >= MIN_ROW_ITEMS; });
      if (!picks.length && !popular.length) { // nothing yet (early boot, network not up): retry
        if (!C.TMDB_KEY) { if (!cached) setText('bootmsg', 'Clé TMDB manquante : ajoutez-la dans keys.js'); return; } // no key: retrying cannot help
        if (++tries < 40) { if (!cached) setText('bootmsg', 'Waiting for the internet…'); setTimeout(loadHome, 5000); }
        return;
      }
      heroItems = picks.slice(0, 6);
      // services that keep their own row (Crunchyroll...) go last, new then popular; the shared rows stay grouped above them
      var own = function (row) { return row.svc && row.svc.merge === false; };
      base = [{title: 'Picked for you', items: picks.slice(6)}, {title: 'Your apps', apps: visibleApps()}]
        .concat(fresh.filter(function (x) { return !own(x); }), popular.filter(function (x) { return !own(x); }), r[4] ? [r[4]] : [],
          fresh.filter(own), popular.filter(own));
      store('homeCache', {hero: heroItems, base: base});
      var first = !cached; // keep the user's place if they already started moving around the cached screen
      buildRows(); showHero(); booted();
      base.slice(0, 5).forEach(function (row) { (row.items || []).slice(0, 6).forEach(function (it) { bakeAhead(it.blur); }); }); // first screens ready
      if (first) { pos.r = 1; focus(); }
    });
  }); }
  loadHome();
  // Back from the settings reloaded the page (a setting changed): put the quick settings back where the user left them.
  try { if (sessionStorage.getItem('reopenQuick')) { sessionStorage.removeItem('reopenQuick'); openQuick(); } } catch (e) { /* storage unavailable */ }
})();
