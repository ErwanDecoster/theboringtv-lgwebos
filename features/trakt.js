// trakt feature - uses window.TV (see README "Feature files").
// Connects a profile to a Trakt account (device code: you type a code on trakt.tv from your phone), pulls what you watched so it is never
// suggested again, and tells Trakt about the titles you mark as seen. Needs TRAKT_ID in keys.js (without it the page only explains how to get one).
// No client secret: Trakt no longer issues one to new apps (sign-in is by code or PKCE); an old app's TRAKT_SECRET is still sent if present.
(function () {
  var TV = window.TV, esc = TV.esc, K = window.KEYS || {};
  var configured = !!K.TRAKT_ID;
  var API = K.TRAKT_API || 'https://api.trakt.tv', SYNC_EVERY = 6 * 3600e3;
  var box = TV.el('div'), tok = TV.store('trakt'), poll = 0, state = 'idle', code = null, msg = '';
  box.id = 'trakt'; box.hidden = true;
  document.body.appendChild(box);

  // ---------- API ----------
  // On the TV the page's origin is "null", which Trakt's CORS rules do not accept: the helper service (rooted TV) makes the call for the page.
  // Anywhere else (a browser, a TV without the helper) the page calls Trakt directly; for a browser add its address to the app's JavaScript origins.
  function viaHelper(method, path, body, token) {
    return fetch('http://127.0.0.1:45621/trakt', {method: 'POST', body: JSON.stringify({method: method, path: path, body: body, token: token, clientId: K.TRAKT_ID})})
      .then(function (r) { return r.json(); }).then(function (r) {
        if (!r.returnValue) { var er = new Error(r.errorText || 'helper'); er.fromHelper = true; throw er; }
        var j = null; try { j = r.text ? JSON.parse(r.text) : null; } catch (e) { /* not JSON */ }
        return {status: r.status, data: j, pages: +r.pages || 0};
      });
  }
  function direct(method, path, body, token) {
    var h = {'Content-Type': 'application/json', 'trakt-api-version': '2', 'trakt-api-key': K.TRAKT_ID};
    if (token) h.Authorization = 'Bearer ' + token;
    return fetch(API + path, {method: method, headers: h, body: body ? JSON.stringify(body) : undefined}).then(function (r) {
      return r.text().then(function (t) { var j = null; try { j = t ? JSON.parse(t) : null; } catch (e) { /* not JSON */ } return {status: r.status, data: j, pages: +r.headers.get('X-Pagination-Page-Count') || 0}; });
    });
  }
  var helperOk = TV.onTV && !K.TRAKT_API;   // TRAKT_API is for tests: a different server, called directly
  function raw(method, path, body, token) {
    if (!helperOk) return direct(method, path, body, token);
    return viaHelper(method, path, body, token).catch(function (e) {
      if (e.fromHelper) throw e;   // the helper answered (Trakt unreachable, refused path): not a missing helper
      helperOk = false; return direct(method, path, body, token);   // no helper (not rooted): try directly
    });
  }
  function save(t) { tok = t; TV.store('trakt', t); }
  function fresh() { return tok && tok.created_at + tok.expires_in - 3600 > Date.now() / 1000; }
  function withSecret(body) { if (K.TRAKT_SECRET) body.client_secret = K.TRAKT_SECRET; return body; }
  var refreshing = null;
  function token() {   // a valid access token, refreshed when it is about to expire
    if (!tok) return Promise.reject(new Error('not connected'));
    if (fresh()) return Promise.resolve(tok.access_token);
    // refresh tokens are single-use: two refreshes at once would cancel each other, so everyone waits for the same one
    if (!refreshing) refreshing = raw('POST', '/oauth/token', withSecret({refresh_token: tok.refresh_token, client_id: K.TRAKT_ID,
      redirect_uri: K.TRAKT_REDIRECT || 'http://localhost', grant_type: 'refresh_token'})).then(function (r) {
      refreshing = null;
      if (r.status !== 200) { if (r.status === 400 || r.status === 401) save(null); throw new Error('refresh ' + r.status); }
      save(Object.assign({}, tok, r.data)); return tok.access_token;
    }, function (e) { refreshing = null; throw e; });
    return refreshing;
  }
  function authedR(method, path, body) {
    return token().then(function (t) { return raw(method, path, body, t); }).then(function (r) {
      if (r.status >= 400) throw new Error(r.status); return r;
    });
  }
  function authed(method, path, body) { return authedR(method, path, body).then(function (r) { return r.data; }); }
  // Trakt pages its long lists (100 by default): read them all, at most 40 pages of 250
  function getAll(path) {
    var all = [], sep = path.indexOf('?') < 0 ? '?' : '&';
    function page(n) {
      return authedR('GET', path + sep + 'page=' + n + '&limit=250').then(function (r) {
        var list = Array.isArray(r.data) ? r.data : [];
        all = all.concat(list);
        var more = r.pages ? n < r.pages : list.length >= 250 && n < 5;   // no page count: a full page may be followed by another
        return more && n < 40 ? page(n + 1) : all;
      });
    }
    return page(1);
  }

  // ---------- sync ----------
  function iso(t) { return new Date(t).toISOString(); }
  function tid(x) { return x && x.ids && x.ids.tmdb; }
  function epLabel(e) { return e && e.season != null && e.number != null ? 'S' + e.season + ' E' + e.number : ''; }
  // a card for a Trakt title: TMDB gives the pictures and the text
  function card(type, id, extra) {
    return TV.tmdb(type + '/' + id).then(function (m) { return Object.assign(TV.fromTmdb(m), extra || {}); }, function () { return null; });
  }

  // History, "Recently finished", "Continue watching". Everything watched becomes a "seen" key (never suggested again). For the 15 most recent
  // series, Trakt's progress tells whether it is finished (a card in "Recently finished") or in the middle (a card in "Continue watching",
  // with its next episode); the movies you paused come from the playback list. (Trakt's own "Up Next" is not open to every app, so it is rebuilt from the progress.)
  function pull() {
    return Promise.all([getAll('/sync/watched/movies'), getAll('/sync/watched/shows')]).then(function (r) {
      var map = {}, found = [];
      r[0].forEach(function (x) { var id = tid(x.movie); if (id) { var at = Date.parse(x.last_watched_at) || Date.now(); map['movie:' + id] = at; found.push({type: 'movie', id: id, at: at}); } });
      r[1].forEach(function (x) { var id = tid(x.show); if (id) { var at = Date.parse(x.last_watched_at) || Date.now(); map['tv:' + id] = at; found.push({type: 'tv', id: id, trakt: x.show.ids.trakt, at: at}); } });
      var n = TV.seen.merge(map);
      TV.store('traktSync', {at: Date.now(), count: Object.keys(map).length});
      found.sort(function (a, b) { return b.at - a.at; });
      var listed = {}; TV.seen.list().forEach(function (x) { listed[x.tmdb.type + ':' + x.tmdb.id] = 1; });
      var finishedCards = [], continueCards = [], work2 = [];
      var movies = found.filter(function (e) { return e.type === 'movie' && !listed['movie:' + e.id]; }).slice(0, 12);
      var shows = found.filter(function (e) { return e.type === 'tv'; }).slice(0, 15);
      var work = movies.map(function (e) { return card('movie', e.id, {seenAt: e.at}).then(function (c) { if (c) finishedCards.push(c); }); });
      shows.forEach(function (e) {
        if (!e.trakt) return;
        work.push(authed('GET', '/shows/' + e.trakt + '/progress/watched').then(function (p) {
          if (!p || !(p.aired > 0)) return;
          if (p.completed >= p.aired) { if (listed['tv:' + e.id]) return; return card('tv', e.id, {seenAt: e.at}).then(function (c) { if (c) finishedCards.push(c); }); }
          var next = epLabel(p.next_episode);
          return card('tv', e.id, {at: e.at, cont: true, src: 'Trakt', cap: 'Up next' + (next ? '  ·  ' + next : '')}).then(function (c) { if (c) continueCards.push(c); });
        }, function () { /* this one is skipped */ }));
      });
      // movies and episodes paused part-way (kept by Trakt's scrobbling: only what a player reported)
      work.push(authed('GET', '/sync/playback').then(function (list) {
        (Array.isArray(list) ? list : []).filter(function (x) { return x.progress >= 1 && x.progress < 95; }).slice(0, 15).forEach(function (x) {
          var at = Date.parse(x.paused_at) || Date.now(), cap = 'Resume  ·  ' + Math.round(x.progress) + '%';
          if (x.movie && tid(x.movie)) work2.push(card('movie', tid(x.movie), {at: at, cont: true, src: 'Trakt', cap: cap}));
          else if (x.show && tid(x.show)) work2.push(card('tv', tid(x.show), {at: at, cont: true, src: 'Trakt', cap: 'Resume  ·  ' + (epLabel(x.episode) || Math.round(x.progress) + '%')}));
        });
      }, function () { /* playback is optional */ }));
      return Promise.all(work).then(function () { return Promise.all(work2); }).then(function (extra) {
        extra.forEach(function (c) { if (c) continueCards.unshift(c); });
        TV.seen.importCards(finishedCards);
        continueCards.sort(function (a, b) { return b.at - a.at; });
        TV.setContinue(continueCards);
        // titles marked here before the account was connected (or while offline) are not on Trakt yet
        var missing = TV.seen.list().filter(function (x) { return !map[x.tmdb.type + ':' + x.tmdb.id]; }).slice(0, 100), body = {movies: [], shows: []};
        missing.forEach(function (x) { body[x.tmdb.type === 'movie' ? 'movies' : 'shows'].push({ids: {tmdb: x.tmdb.id}, watched_at: iso(x.seenAt || Date.now())}); });
        if (!missing.length) return n;
        Object.keys(body).forEach(function (k) { if (!body[k].length) delete body[k]; });
        return authed('POST', '/sync/history', body).then(function () { return n; }, function () { return n; });   // sent again at the next sync
      });
    });
  }
  // what you mark as seen here is sent to Trakt (a series counts as watched in full: all its episodes); failures wait in an outbox for the next sync
  function out(list) { return list ? TV.store('traktOut', list) : (TV.store('traktOut') || []); }
  function send(op) {
    var path = op.on ? '/sync/history' : '/sync/history/remove', m = {ids: {tmdb: op.id}}, body = {};
    if (op.on) m.watched_at = iso(op.at);
    body[op.type === 'tv' ? 'shows' : 'movies'] = [m];   // outbox entries from before series were sent have no type: they are movies
    return authed('POST', path, body);
  }
  function flush() {
    var q = out(), left = [];
    return q.reduce(function (p, op) { return p.then(function () { return send(op); }).catch(function () { left.push(op); }); }, Promise.resolve()).then(function () { out(left); });
  }
  TV.seen.onChange(function (it, on) {
    if (!tok) return;
    var op = {type: it.tmdb.type, id: it.tmdb.id, on: on, at: Date.now()};
    send(op).catch(function () { out(out().concat([op])); TV.toast('Trakt: will retry later'); });
  });

  // Watchlist ("À voir"), both ways. `traktWl` holds the keys both sides agreed on at the last sync: a title new on one side is added to the other,
  // a title that left one side is removed from the other, so a removal is never mistaken for something not yet added.
  function wkey(type, id) { return type + ':' + id; }
  function wbody(keys) {
    var b = {movies: [], shows: []};
    keys.forEach(function (k) { var p = k.split(':'); b[p[0] === 'movie' ? 'movies' : 'shows'].push({ids: {tmdb: +p[1]}}); });
    Object.keys(b).forEach(function (t) { if (!b[t].length) delete b[t]; });
    return b;
  }
  function syncWatchlist() {
    return Promise.all([getAll('/sync/watchlist/movies'), getAll('/sync/watchlist/shows')]).then(function (r) {
      var R = {}, L = {}, P = {}, mine = TV.watchlist.list();
      r[0].forEach(function (x) { var id = tid(x.movie); if (id) R[wkey('movie', id)] = 1; });
      r[1].forEach(function (x) { var id = tid(x.show); if (id) R[wkey('tv', id)] = 1; });
      mine.forEach(function (x) { L[wkey(x.tmdb.type, x.tmdb.id)] = x; });
      (TV.store('traktWl') || []).forEach(function (k) { P[k] = 1; });
      var addLocal = Object.keys(R).filter(function (k) { return !P[k] && !L[k]; }).slice(0, 60);
      var delLocal = Object.keys(P).filter(function (k) { return !R[k] && L[k]; });
      var addRemote = Object.keys(L).filter(function (k) { return !R[k] && !P[k]; });
      var delRemote = Object.keys(P).filter(function (k) { return R[k] && !L[k]; });
      delLocal.forEach(function (k) { TV.watchlist.put(L[k], false, true); delete L[k]; });
      var steps = [];
      if (addRemote.length) steps.push(authed('POST', '/sync/watchlist', wbody(addRemote)));
      if (delRemote.length) steps.push(authed('POST', '/sync/watchlist/remove', wbody(delRemote)));
      addLocal.forEach(function (k) {
        var p = k.split(':');
        steps.push(card(p[0], p[1]).then(function (c) { if (c) { TV.watchlist.put(c, true, true); L[k] = c; } }));
      });
      return Promise.all(steps).then(function () { TV.store('traktWl', Object.keys(L)); });
    });
  }
  TV.watchlist.onChange(function (it, on) {
    if (!tok) return;
    authed('POST', on ? '/sync/watchlist' : '/sync/watchlist/remove', wbody([wkey(it.tmdb.type, it.tmdb.id)])).catch(function () { /* the next sync reconciles it */ });
  });

  // "Not finished" on a series Trakt does not know yet: tell it you started, without marking anything watched. TV Home does not know which episode you played, so it is
  // noted as a pause at 3 % of the first one (a playback progress: it shows in Trakt's "Continue watching" and in our own, and nothing enters the watched history).
  // A series Trakt already knows (something of it watched) is left alone: it is in progress there already.
  TV.traktStarted = function (it) {
    if (!tok || !it || !it.tmdb || it.tmdb.type !== 'tv' || TV.seen.has(it)) return;
    authed('POST', '/scrobble/pause', {show: {ids: {tmdb: it.tmdb.id}}, episode: {season: 1, number: 1}, progress: 3}).then(function () {
      var m = {}; m['tv:' + it.tmdb.id] = Date.now(); TV.seen.merge(m);            // known to Trakt now (started): not suggested again
      TV.toast('Noted as started on Trakt');
    }, function () { TV.toast('Trakt: could not note it'); });
  };

  function sync(quiet) {
    return flush().then(pull).then(function (n) {
      return syncWatchlist().then(function () { return n; }, function () { return n; });   // the watchlist is a nicety: its failure does not fail the sync
    }).then(function (n) {
      if (!quiet) TV.toast(n ? n + ' new titles from Trakt' : 'Trakt is up to date');
      msg = ''; if (TV.view() === 'trakt') paint();
    }).catch(function (e) { if (!quiet) TV.toast('Trakt: sync failed'); msg = 'Sync failed (' + e.message + ')'; if (TV.view() === 'trakt') paint(); });
  }

  // ---------- connect (device code) ----------
  function stop() { clearTimeout(poll); poll = 0; }
  function connect() {
    if (!configured) return;
    stop(); msg = '';
    raw('POST', '/oauth/device/code', {client_id: K.TRAKT_ID}).then(function (r) {
      if (r.status !== 200) throw new Error(r.status);
      code = r.data; state = 'waiting'; paint();
      var until = Date.now() + code.expires_in * 1000, every = Math.max(code.interval || 5, 1) * 1000;
      (function again() {
        poll = setTimeout(function () {
          if (state !== 'waiting' || TV.view() !== 'trakt') return;
          if (Date.now() > until) { state = 'idle'; msg = 'The code expired'; return paint(); }
          raw('POST', '/oauth/device/token', withSecret({code: code.device_code, client_id: K.TRAKT_ID})).then(function (t) {
            if (t.status === 200) { save(t.data); state = 'idle'; TV.toast('Trakt connected'); who(); sync(true); return paint(); }
            if (t.status === 429) every += 1000;                      // asked too often: slow down
            if (t.status === 400 || t.status === 429) return again();   // not approved yet
            state = 'idle'; msg = t.status === 418 ? 'Refused on Trakt' : t.status === 410 || t.status === 404 ? 'The code expired' : 'Trakt error ' + t.status; paint();
          }, again);
        }, every);
      })();
    }).catch(function (e) { state = 'idle'; msg = 'Could not reach Trakt (' + e.message + ')'; paint(); });
    state = 'waiting'; code = null; paint();
  }
  function who() { authed('GET', '/users/settings').then(function (d) { if (d && d.user) { save(Object.assign({}, tok, {user: d.user.username})); if (TV.view() === 'trakt') paint(); } }, function () { /* the name is a nicety */ }); }
  function disconnect() {
    var t = tok && tok.access_token; save(null); out([]); state = 'idle'; msg = 'Disconnected';
    if (t) raw('POST', '/oauth/revoke', withSecret({token: t, client_id: K.TRAKT_ID})).catch(function () { /* the token expires anyway */ });
    paint();
  }

  // ---------- screen ----------
  function btn(label, fn) { var b = TV.el('span', 'dbtn f', label); b.onok = fn; return b; }
  function paint() {
    if (!configured) {   // nothing to connect with yet: say what to do
      box.innerHTML = '<div class="dbody"><div class="dsrc">Trakt</div><div class="thead">Set up Trakt</div>' +
        '<p class="tsub">Trakt keeps one watch history for all your streaming services. TV Home needs your own free Trakt app for that, which takes two minutes:</p>' +
        '<p class="tsub">1. On a computer, open trakt.tv/oauth/applications and create an app (redirect address: http://localhost, leave the rest empty).</p>' +
        '<p class="tsub">2. Copy its Client ID.</p><p class="tsub">3. Put it in keys.js as TRAKT_ID, then install the app again. The README has the details.</p><div class="dbtns"></div></div>';
      box.querySelector('.dbtns').appendChild(btn('Close', function () { TV.closeView(); }));
      if (window.I18N) window.I18N.done(box);
      return TV.rebuild();
    }
    var last = TV.store('traktSync'), h = '<div class="dbody"><div class="dsrc">Trakt</div><div class="thead">' + (tok ? 'Connected' : 'Connect Trakt') + '</div>';
    if (state === 'waiting') {
      h += code ? '<p class="tsub">On your phone or computer, open</p><div class="turl">' + esc((code.verification_url || 'trakt.tv/activate').replace(/^https?:\/\//, '')) +
        '</div><p class="tsub">and enter this code:</p><div class="tcode">' + esc(code.user_code) + '</div><p class="tsub">This page connects by itself once you have approved.</p>'
        : '<p class="tsub">Asking Trakt for a code…</p>';
    } else if (tok) {
      h += (tok.user ? '<p class="tsub">Account: ' + esc(tok.user) + '</p>' : '') +
        '<p class="tsub">What you watched on Trakt is never suggested again, and what you mark as seen here is sent to Trakt (a series as fully watched).</p>' +
        (last ? '<p class="tsub tdim">Last sync: ' + esc(new Date(last.at).toLocaleString(window.UI_LOCALE)) + ' · ' + last.count + ' titles</p>' : '');
    } else {
      h += '<p class="tsub">Link your Trakt account to keep one watch history across all your streaming services. You will get a short code to enter from your phone.</p>';
    }
    if (msg) h += '<div class="dextra">' + esc(msg) + '</div>';
    box.innerHTML = h + '<div class="dbtns"></div></div>';
    var b = box.querySelector('.dbtns');
    if (state === 'waiting') b.appendChild(btn('Cancel', function () { stop(); state = 'idle'; paint(); TV.rebuild(0, 0); }));
    else if (tok) { b.appendChild(btn('Sync now', function () { msg = 'Syncing…'; paint(); TV.rebuild(0, 0); sync(false); })); b.appendChild(btn('Disconnect', function () { disconnect(); TV.rebuild(0, 0); })); }
    else b.appendChild(btn('Connect', function () { connect(); TV.rebuild(0, 0); }));
    b.appendChild(btn('Close', function () { TV.closeView(); }));
    if (window.I18N) window.I18N.done(box);
    TV.rebuild();
  }
  TV.addView('trakt', {
    nav: function () { return [[].slice.call(box.querySelectorAll('.dbtns .f'))]; },
    show: function () { state = state === 'waiting' ? 'waiting' : 'idle'; box.hidden = false; paint(); },
    hide: function () { stop(); if (state === 'waiting') state = 'idle'; box.hidden = true; box.innerHTML = ''; }
  });
  TV.addSetting({key: 'trakt', title: 'Trakt', hint: 'Keeps your watch history across services', action: function () { TV.openView('trakt'); },
    opts: [['open', 'Open']]}, '');

  // once in a while at start-up, when connected
  var last0 = TV.store('traktSync');
  if (configured && tok && (!last0 || Date.now() - last0.at > SYNC_EVERY)) setTimeout(function () { sync(true); }, 8000);
})();
