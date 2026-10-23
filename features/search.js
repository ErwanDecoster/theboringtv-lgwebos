// search feature - uses window.TV (see README "Feature files").
// Search tab: on-screen keyboard -> TMDB search/multi -> cards with "where to watch" in your region.
(function () {
  var TV = window.TV, esc = TV.esc;
  // Settings → Keyboard layout: the letters. Around them the keyboard is always laid out like a real one: digits and backspace above, the space bar below.
  TV.addSetting({key: 'keyboard', title: 'Keyboard layout', hint: 'The on-screen keyboard of the search', opts: [['azerty', 'AZERTY'], ['qwerty', 'QWERTY'], ['abc', 'ABC (alphabetical)']]}, 'azerty');
  var LAYOUTS = {azerty: ['azertyuiop', 'qsdfghjklm', 'wxcvbn'], qwerty: ['qwertyuiop', 'asdfghjkl', 'zxcvbnm'], abc: ['abcdefghijklm', 'nopqrstuvwxyz']};
  var ROWS = LAYOUTS[TV.S.keyboard] || LAYOUTS.azerty;
  // the delete key is drawn, not typed: the character for it (U+232B) is missing from the TV's fonts and showed as an empty box
  var DELETE_ICON = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 5H9l-6 7 6 7h12a1 1 0 0 0 1-1V6a1 1 0 0 0-1-1z"/><path d="M16 9.5l-5 5M11 9.5l5 5"/></svg>';
  var q = '', seq = 0, timer, where = {}; // where: 'tv/123' -> label html (cache)

  var root = TV.el('div', '', '<div class="sq"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"><circle cx="10.5" cy="10.5" r="6.5"/><path d="M15.5 15.5 21 21"/></svg>' +
    '<span id="sqText"></span><i class="caret"></i><span id="sqClear" class="f" title="Clear" hidden>&#10005;</span></div><span id="sxclose" class="f" title="Close">&#10005;</span><div id="skb"></div><div id="syt"></div><h3 id="sresTitle"></h3><div id="sres" class="strip"></div>');
  root.id = 'search'; root.hidden = true;
  document.body.appendChild(root);
  var $ = function (id) { return document.getElementById(id); };
  $('sqClear').onok = function () { setQ(''); };

  // keyboard: a real keyboard's shape, as wide as the search field. The grid counts in quarter keys so each row can be shifted by a fraction of a key
  // (as on a physical keyboard), and every row is filled up to the right edge with punctuation keys instead of leaving holes.
  var COLS = Math.max(10, ROWS.reduce(function (m, r) { return Math.max(m, r.length); }, 0));
  var T = COLS * 4 + 6;                                                   // quarter keys across: the backspace after the digits takes six
  $('skb').style.setProperty('--cols', T);
  var STAGGER = TV.S.keyboard !== 'abc';                                  // AZERTY / QWERTY rows slide to the right as they go down; the alphabetical one stays square
  var PUNCT = ["'", '-', ',', '.', ':', '?', '!', ';', '&', '+', '/'], punct = 0;
  function keyRow(chars, indent, end) {                                   // end: quarter keys to leave free on the right (the backspace)
    var r = TV.el('div', 'skrow'), used = indent + chars.length * 4;
    chars.split('').forEach(function (ch) { r.appendChild(key(ch, ch, function () { type(ch); })); });
    if (indent) r.firstChild.style.gridColumn = (indent + 1) + ' / span 4';
    var left = T - end - used, n = left >= 3 ? Math.max(1, Math.floor(left / 4)) : 0;
    for (var i = 0; i < n; i++) {
      var p = PUNCT[punct++ % PUNCT.length], k = key(p, p, (function (c) { return function () { type(c); }; })(p));
      if (i === n - 1) k.style.gridColumn = 'span ' + (left - 4 * (n - 1));
      r.appendChild(k);
    }
    return r;
  }
  var digitsRow = keyRow('1234567890', 0, 6);
  $('skb').appendChild(digitsRow);
  var INDENT = [2, 3, 5];                                                 // a half, three quarters and one and a quarter keys, like a physical keyboard
  ROWS.forEach(function (row, i) { $('skb').appendChild(keyRow(row, STAGGER ? INDENT[i] || 0 : 0, 0)); });
  var actions = TV.el('div', 'skrow');
  // Dictation: the TV's microphone (streamed by the Launcher's service on the TV) -> Home Assistant's speech-to-text (Whisper) -> the search text.
  // It needs HA_URL / HA_TOKEN in keys.js, the "Anna" assistant (HA_STT_PIPELINE) in Home Assistant, and the service on the TV.
  var K = window.KEYS || {}, MIC = 'http://127.0.0.1:45621/mic';
  var LOCAL = !!(K.STT_URL && K.STT_TOKEN);                                // a speech server on the home network (preferred), else Home Assistant
  var canDictate = !!((LOCAL || (K.HA_URL && K.HA_TOKEN)) && TV.onTV);
  var MIC_ICON = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="3" width="6" height="11" rx="3"/><path d="M5.5 11a6.5 6.5 0 0 0 13 0M12 17.5V21"/></svg>';
  var delKey = key(DELETE_ICON, 'wide', back1); delKey.style.gridColumn = 'span 6'; digitsRow.appendChild(delKey);
  var spaceKey = key('Space', 'wide', function () { type(' '); }); spaceKey.style.gridColumn = (Math.round((T - 26) / 2) + 1) + ' / span 26'; actions.appendChild(spaceKey);
  var micKey = null;
  if (canDictate) { micKey = key(MIC_ICON, 'wide', function () { dictate(); }); micKey.style.gridColumn = (T - 5) + ' / span 6'; actions.appendChild(micKey); }
  $('skb').appendChild(actions);
  function key(label, cls, fn) { var k = TV.el('span', 'skey f' + (cls.length > 1 ? ' ' + cls : ''), label); k.onok = fn; return k; }
  var yt = TV.el('span', 'schip f');
  yt.onok = function () { TV.launch('youtube.leanback.v4', {contentTarget: 'https://www.youtube.com/tv#/search?q=' + encodeURIComponent(q.trim())}); };
  $('syt').appendChild(yt);
  $('sxclose').onok = function () { TV.closeView(); };

  // ---- dictation ----
  var dict = null;     // the running dictation: {ws, abort, phase}
  function dictPhase(p) {   // 'listening' | 'transcribing' | null
    if (dict) dict.phase = p;
    if (micKey) micKey.classList.toggle('listening', p === 'listening');
    $('sqText').textContent = q || (p === 'listening' ? 'Listening…' : p === 'transcribing' ? 'Transcribing…' : 'Search movies & shows');
    $('sqText').className = q ? '' : 'ph';
  }
  function dictEnd(text, problem) {
    var d = dict; if (!d) return;
    dict = null;
    try { d.abort.abort(); } catch (e) { /* done */ }
    try { d.ws.close(); } catch (e) { /* closed */ }
    clearTimeout(d.limit);
    dictPhase(null);
    if (text) setQ(text.replace(/^[\s.…]+|[\s.…]+$/g, '').slice(0, 40));
    else if (problem) TV.toast(problem);
  }
  // Own server: the TV's microphone is cut into a sentence here (silence ends it), sent in one go, and the answer is snapped to a title we know.
  function norm(t) { return String(t).toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9 ]+/g, ' ').replace(/\s+/g, ' ').trim(); }
  function bigrams(t) { var o = {}, n = 0; for (var i = 0; i < t.length - 1; i++) { o[t.substr(i, 2)] = (o[t.substr(i, 2)] || 0) + 1; n++; } return {map: o, n: n}; }
  function similarity(a, b) {                                                // Dice coefficient on letter pairs: tolerant of a wrong word or two
    var x = bigrams(a), y = bigrams(b), hit = 0;
    for (var k in x.map) if (y.map[k]) hit += Math.min(x.map[k], y.map[k]);
    return x.n + y.n ? 2 * hit / (x.n + y.n) : 0;
  }
  function knownTitles() {
    var seen = {}, list = [];
    [].forEach.call(document.querySelectorAll('.ttl'), function (e) { var t = e.textContent.trim(); if (t && !seen[t]) { seen[t] = 1; list.push(t); } });
    return list.slice(0, 60);
  }
  function snap(text, titles) {
    var n = norm(text), best = '', score = 0;
    titles.forEach(function (t) { var sc = similarity(n, norm(t)); if (sc > score) { score = sc; best = t; } });
    return score >= 0.6 ? best : text;
  }
  function dictateLocal() {
    var abort = new AbortController(), chunks = [], total = 0, t0 = Date.now(), floor = [], thr = 0, speech = 0, loud = 0, quietMs = 0, done = false, peak = 0;
    dict = {abort: abort, phase: null, ws: {close: function () {}}};
    dictPhase('listening');
    var stop = function (reason) {
      if (done) return; done = true; try { abort.abort(); } catch (e) { /* done */ }
      window.__dictLast = {reason: reason, thr: thr, peak: Math.round(peak), bytes: total, secs: +(total / 32000).toFixed(1), speech: speech};   // for diagnosing a dictation that heard nothing
      if (!speech) return dictEnd('', 'Nothing heard');
      dictPhase('transcribing');
      var body = new Uint8Array(total), o = 0; chunks.forEach(function (c) { body.set(c, o); o += c.length; });
      var titles = knownTitles();
      fetch(K.STT_URL + '/transcribe?lang=' + (TV.S.uiLang === 'en' ? 'en' : 'fr'), {method: 'POST', body: body,
        headers: {Authorization: 'Bearer ' + K.STT_TOKEN, 'X-Prompt': encodeURIComponent(titles.join(', '))}})
        .then(function (r) { if (!r.ok) throw new Error(r.status); return r.json(); })
        .then(function (r) { var t = (r.text || '').trim(); dictEnd(t ? snap(t, titles) : '', t ? '' : 'Nothing heard'); })
        .catch(function () { dictEnd('', 'The speech server is not available'); });
    };
    dict.limit = setTimeout(function () { stop('time'); }, speech ? 10000 : 9000);
    dict.finish = stop;
    fetch(MIC, {signal: abort.signal}).then(function (r) {
      if (!r.ok) throw new Error('mic ' + r.status);
      var reader = r.body.getReader();
      (function read() {
        reader.read().then(function (x) {
          if (x.done || done) return stop('end');
          var v = x.value, samples = v.length >> 1, sum = 0, dv = new DataView(v.buffer, v.byteOffset, v.length);
          for (var i = 0; i < samples; i++) { var a = dv.getInt16(i * 2, true); sum += a * a; }
          var rms = Math.sqrt(sum / Math.max(samples, 1)), ms = samples / 16;
          chunks.push(v); total += v.length; if (rms > peak) peak = rms;
          if (!thr) { floor.push(rms); if (total >= 16000 * 2 * 0.4) { floor.sort(function (p, q) { return p - q; }); thr = Math.max(floor[floor.length >> 1] * 2.5, 220); } }
          else if (rms > thr) { loud++; quietMs = 0; if (loud >= 3) speech = 1; }
          else { loud = 0; if (speech) { quietMs += ms; if (quietMs >= 800) return stop('silence'); } }
          if (!speech && Date.now() - t0 > 7000) return stop('nospeech');
          read();
        }, function () { /* aborted */ });
      })();
    }).catch(function (e) { if (!done) dictEnd('', e && /409/.test(e.message) ? 'The microphone is busy' : 'The TV service is not available'); });
  }
  function dictate() {
    if (dict) { if (dict.finish) return dict.finish('manual'); return dictEnd('', ''); }   // a second OK ends the sentence now
    if (LOCAL) return dictateLocal();                                         // a second OK ends it: what was heard so far is transcribed
    var ws, handler = null, finished = false, abort = new AbortController();
    dict = {abort: abort, phase: null};
    try { ws = new WebSocket(K.HA_URL.replace(/^http/, 'ws') + '/api/websocket'); } catch (e) { dict = null; return TV.toast('Voice dictation could not start'); }
    ws.binaryType = 'arraybuffer';
    dict.ws = ws;
    dictPhase('listening');
    var id = 0, runId = 0, send = function (o) { o.id = ++id; ws.send(JSON.stringify(o)); return id; };
    var finish = function () { if (finished) return; finished = true; try { abort.abort(); } catch (e) { /* done */ } if (handler !== null && ws.readyState === 1) ws.send(new Uint8Array([handler])); dictPhase('transcribing'); };
    dict.limit = setTimeout(finish, 12000);
    var pump = function () {                                                   // the TV's microphone, forwarded to Home Assistant as it comes in
      fetch(MIC, {signal: abort.signal}).then(function (r) {
        if (!r.ok) throw new Error('mic ' + r.status);
        var reader = r.body.getReader();
        (function read() {
          reader.read().then(function (x) {
            if (x.done) return finish();
            if (!finished && ws.readyState === 1) { var b = new Uint8Array(x.value.length + 1); b[0] = handler; b.set(x.value, 1); ws.send(b); }
            read();
          }, function () { /* aborted */ });
        })();
      }).catch(function (e) { if (!finished) dictEnd('', e && /409/.test(e.message) ? 'The microphone is busy' : 'The TV service is not available'); });
    };
    ws.onmessage = function (m) {
      var d = JSON.parse(m.data);
      if (d.type === 'auth_required') ws.send(JSON.stringify({type: 'auth', access_token: K.HA_TOKEN}));
      else if (d.type === 'auth_invalid') dictEnd('', 'Voice dictation is not allowed on this TV');
      else if (d.type === 'auth_ok') send({type: 'assist_pipeline/pipeline/list'});
      else if (d.type === 'result' && d.id === 1) {
        var pl = d.success && d.result.pipelines.filter(function (p) { return p.name === (K.HA_STT_PIPELINE || 'Anna'); })[0];
        if (!pl) return dictEnd('', 'Voice dictation could not start');
        runId = send({type: 'assist_pipeline/run', start_stage: 'stt', end_stage: 'stt', input: {sample_rate: 16000}, pipeline: pl.id});
      } else if (d.type === 'event' && d.id === runId) {
        var e = d.event;
        if (e.type === 'run-start') handler = e.data.runner_data.stt_binary_handler_id;
        else if (e.type === 'stt-start') pump();
        else if (e.type === 'stt-vad-end') finish();                           // Home Assistant heard the end of the sentence
        else if (e.type === 'stt-end') dictEnd(e.data.stt_output && e.data.stt_output.text || '', (e.data.stt_output && e.data.stt_output.text) ? '' : 'Nothing heard');
        else if (e.type === 'error') dictEnd('', 'Voice dictation failed');
      }
    };
    ws.onerror = function () { dictEnd('', 'Voice dictation could not reach Home Assistant'); };
  }

  function type(ch) { if (q.length < 40) setQ(q + ch); }
  function back1() { setQ(q.slice(0, -1)); }
  function setQ(v) {
    q = v;
    $('sqText').textContent = q || (dict && dict.phase === 'listening' ? 'Listening…' : 'Search movies & shows');
    $('sqText').className = q ? '' : 'ph';
    var showX = !!q, hadX = !$('sqClear').hidden;
    $('sqClear').hidden = !showX;
    if (showX !== hadX && TV.view() === 'search') TV.rebuild();
    root.firstChild.classList.toggle('empty', !q);       // empty: the caret goes before the placeholder, where typing will start
    yt.innerHTML = '<b>&#9654;</b> Search YouTube' + (q.trim() ? ' for “' + esc(q.trim()) + '”' : '');
    clearTimeout(timer);
    timer = setTimeout(run, 350);
  }

  function run() {
    var s = q.trim(), my = ++seq;
    var req = s.length < 2 ? TV.tmdb('trending/all/day') : TV.tmdb('search/multi', '&include_adult=false&query=' + encodeURIComponent(s));
    $('sresTitle').textContent = s.length < 2 ? 'Trending searches' : 'Searching…';
    req.then(function (r) {
      if (my !== seq) return; // a newer query won
      var list = r.results.filter(function (m) { return m.media_type !== 'person' && (m.poster_path || m.backdrop_path); }).slice(0, 20);
      $('sresTitle').textContent = s.length < 2 ? 'Trending searches' : list.length ? 'Results for “' + s + '”' : 'No results for “' + s + '”';
      show(list);
    }).catch(function () { if (my === seq) { $('sresTitle').textContent = 'Search failed, check the connection'; show([]); } });
  }

  function show(list) {
    var strip = $('sres'); strip.innerHTML = ''; strip.style.transform = '';
    list.forEach(function (m, i) {
      var it = TV.fromTmdb(m), c = TV.card(it);              // the same card as on the home screen
      strip.appendChild(c);
      if (i < 8) watch(it, c.querySelector('.cap')); // ponytail: providers for first 8 only, the rest keep the usual caption
    });
    if (TV.view() === 'search') TV.rebuild();
  }

  // "Where can I watch it": your services first, then other streamers, else rent/buy. It leads the card's caption, which shows under the
  // focused card exactly as on the home screen.
  var fr = TV.S.uiLang !== 'en';
  function watch(it, cap) {
    var t = it.tmdb, k = t.type + '/' + t.id;
    var put = function (label) { cap.textContent = label ? label + '  ·  ' + it.meta : it.meta; };
    if (where[k] != null) return put(where[k]);
    TV.tmdb(k + '/watch/providers').then(function (r) {
      var reg = r.results[TV.C.REGION] || {}, mine = [], other = [];
      (reg.flatrate || []).concat(reg.free || [], reg.ads || []).forEach(function (p) {
        var s = TV.svcFor(p.provider_name), name = s ? s.name : p.provider_name.replace(/ (Amazon|Apple TV) Channel$/, '');
        if (s && TV.S.services.indexOf(s.name) >= 0) { if (mine.indexOf(name) < 0) mine.push(name); }
        else if (other.indexOf(name) < 0 && mine.indexOf(name) < 0) other.push(name);
      });
      var rent = (reg.rent || reg.buy || [])[0];
      put(where[k] = mine.length ? mine.join(', ') + (other.length ? ', ' + other[0] : '') :
        other.length ? other.slice(0, 2).join(', ') :
        rent ? (reg.rent ? (fr ? 'Location : ' : 'Rent: ') : (fr ? 'Achat : ' : 'Buy: ')) + rent.provider_name :
        (fr ? 'Pas en streaming en ' : 'Not streaming in ') + TV.C.REGION);
    }).catch(function () { /* the usual caption stays */ });
  }

  // Up / down by position, not by rank: the rows of keys are staggered and have different numbers of keys, so the key above or below is the one
  // whose centre is the nearest to the centre of the focused key. (The row of results keeps the usual behaviour.)
  function centerX(e) { var r = e.getBoundingClientRect(); return r.left + r.width / 2; }
  function vertical(d) {
    var cur = document.querySelector('.focus'), rows = searchRows(), r = -1;
    rows.forEach(function (row, i) { if (row.indexOf(cur) >= 0) r = i; });
    var to = rows[r + d];
    if (r < 0 || !to || cur.parentNode.id === 'sres' || to[0].parentNode.id === 'sres') return false;
    var x = centerX(cur), best = 0, gap = 1e9;
    to.forEach(function (e, i) { var g = Math.abs(centerX(e) - x); if (g < gap) { gap = g; best = i; } });
    TV.rebuild(r + d, best);
    return true;
  }
  function searchRows() {
    return [[].concat($('sqClear').hidden ? [] : [$('sqClear')], [$('sxclose')])].concat([].slice.call(root.querySelectorAll('.skrow')).map(function (r) { return [].slice.call(r.children); }))
      .concat([[yt], [].slice.call($('sres').children)]);
  }

  TV.addView('search', {
    nav: searchRows,
    show: function () { root.hidden = false; if (!$('sres').children.length) setQ(q); TV.rebuild(1, 0); }, // start on the keyboard, not the close button
    hide: function () { root.hidden = true; if (dict) dictEnd('', ''); },
    back: function () { if (dict) return dictEnd('', ''); TV.closeView(); },
    // Physical keyboard (desktop testing / USB keyboards). Backspace deletes while there's text, else it's Back.
    keydown: function (ev) {
      if (ev.ctrlKey || ev.metaKey || ev.altKey) return false;
      if (ev.keyCode === 38 || ev.keyCode === 40) return vertical(ev.keyCode === 38 ? -1 : 1);
      if (ev.key && ev.key.length === 1 && /[\w ]/.test(ev.key)) type(ev.key.toLowerCase());
      else if (ev.keyCode === 8 && q) back1();
      else return false;
      return true;
    },
    onFocus: function (e, pos) {
      if (e.parentNode.id === 'sres') e.parentNode.style.transform = 'translateX(' + -TV.stripShift(e) + 'px)';
    }
  });
  // Voice search, the way YouTube gets it: appinfo.json's inAppSearchParams / inAppVoiceIntent tell webOS to hand the recognised words to
  // this app, as launch parameters, when the user speaks to the remote while TV Home is in front. Both arrive here: at a cold start and on relaunch.
  function spoken() {
    var raw; try { raw = window.PalmSystem && window.PalmSystem.launchParams; } catch (e) { return ''; }
    if (!raw) return '';
    try { localStorage.setItem('voiceLast', String(raw).slice(0, 500)); } catch (e) { /* storage unavailable */ }      // kept to see what webOS sent
    var p; try { p = typeof raw === 'string' ? JSON.parse(raw) : raw; } catch (e) { return ''; }
    var t = p && p.contentTarget, text = '';
    if (typeof t === 'string') text = /^q=/.test(t) ? decodeURIComponent(t.slice(2).replace(/\+/g, ' ')) : '';
    else if (t && typeof t === 'object' && /search|play|find/i.test(t.intent || '')) text = String(t.intentParam || '');
    return text.trim();
  }
  function voiceSearch() {
    var text = spoken(); if (!text) return;
    if (TV.view() !== 'search') TV.openView('search');
    setQ(text.slice(0, 40));
  }
  setTimeout(voiceSearch, 400);       // cold start: app.js has already fired 'tvready' by the time this file loads
  document.addEventListener('webOSRelaunch', voiceSearch);

  TV.addTab('Search', 'search');
})();
