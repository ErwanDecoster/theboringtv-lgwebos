// washer feature - the washing machine in Home Assistant, shown as a pill next to the weather while it runs.
// Needs HA_URL, HA_TOKEN and HA_WASHER {status, end, total} in keys.js (git-ignored); without them nothing happens.
// Home Assistant is read over its WebSocket (its REST API refuses requests from the TV's files); the token never leaves keys.js.
(function () {
  var K = window.KEYS || {}, E = K.HA_WASHER;
  if (!K.HA_URL || !K.HA_TOKEN || !E) return;
  var fr = (window.TV && window.TV.S.uiLang) !== 'en';
  var pill = document.getElementById('washer');

  // The machine reports the phase of its cycle (not the programme), so the icon follows the phase.
  var I = {
    drum: '<rect x="4" y="2.5" width="16" height="19" rx="3"/><circle cx="12" cy="13.5" r="4.6"/><path d="M8.4 14.4c1.2-1.2 2.4 1.2 3.6 0s2.4 1.2 3.6 0M7.5 5.8h.01M10 5.8h.01"/>',
    drop: '<path d="M12 3s6 6.3 6 10.5a6 6 0 0 1-12 0C6 9.3 12 3 12 3z"/><path d="M9.2 14a3 3 0 0 0 2.3 2.7"/>',
    spin: '<path d="M20 12a8 8 0 0 1-14 5.3M4 12a8 8 0 0 1 14-5.3"/><path d="M18.5 3v4h-4M5.5 21v-4h4"/>',
    pause: '<rect x="6.5" y="5" width="3.6" height="14" rx="1"/><rect x="13.9" y="5" width="3.6" height="14" rx="1"/>',
    heat: '<path d="M7 20c-2-2.4 2-4 0-6.5S7 9 7 7M12.5 20c-2-2.4 2-4 0-6.5s0-4.5 0-6.5M18 20c-2-2.4 2-4 0-6.5s0-4.5 0-6.5"/>',
    snow: '<path d="M12 3v18M4.2 7.5l15.6 9M19.8 7.5l-15.6 9M9.5 4.5 12 7l2.5-2.5M9.5 19.5 12 17l2.5 2.5"/>',
    steam: '<path d="M8 4c-1.6 2 1.6 3 0 5M12.5 4c-1.6 2 1.6 3 0 5M17 4c-1.6 2 1.6 3 0 5"/><path d="M4 14h16M6 14l1 6h10l1-6"/>',
    spark: '<path d="M12 3l1.9 5.1L19 10l-5.1 1.9L12 17l-1.9-5.1L5 10l5.1-1.9zM18.5 16.5l.8 2 2 .8-2 .8-.8 2-.8-2-2-.8 2-.8z"/>',
    scan: '<circle cx="11" cy="11" r="6.2"/><path d="M15.6 15.6 20 20"/>',
    clock: '<circle cx="12" cy="12" r="8.5"/><path d="M12 7v5.2l3.2 2"/>',
    done: '<circle cx="12" cy="12" r="8.8"/><path d="M8 12.4l2.8 2.8L16.4 9.4"/>'
  };
  var PHASES = { // status -> [icon, French, English]
    running: ['drum', 'Lavage', 'Washing'], rinsing: ['drop', 'Rinçage', 'Rinsing'], spinning: ['spin', 'Essorage', 'Spinning'],
    pause: ['pause', 'En pause', 'Paused'], drying: ['heat', 'Séchage', 'Drying'], cool_down: ['snow', 'Refroidissement', 'Cooling'],
    steam_softening: ['steam', 'Vapeur', 'Steam'], rinse_hold: ['drop', 'Cuve pleine', 'Rinse hold'], refreshing: ['spark', 'Rafraîchissement', 'Refresh'],
    detecting: ['scan', 'Détection', 'Detecting'], reserved: ['clock', 'Départ différé', 'Delayed start'], end: ['done', 'Terminé', 'Done']
  };
  var DONE_SHOWN_MS = 60 * 60 * 1000; // "done" stays on for an hour: the laundry is waiting

  var states = {}, socket, stopped = false, attempts = 0, nextId = 1, subId = 0, lastMsg = 0, timer = 0;

  function span(min) { return min >= 60 ? Math.floor(min / 60) + ' h ' + ('0' + (min % 60)).slice(-2) : min + ' min'; }
  function render() {
    var st = states[E.status] && states[E.status].state, ph = PHASES[st];
    if (!ph) { pill.hidden = true; return; }
    var endAt = states[E.end] && Date.parse(states[E.end].state), total = parseFloat(states[E.total] && states[E.total].state);
    var left = isFinite(endAt) ? Math.max(0, Math.round((endAt - Date.now()) / 60000)) : null, text, bar = 0;
    if (st === 'end') {
      if (isFinite(endAt) && Date.now() - endAt > DONE_SHOWN_MS) { pill.hidden = true; return; }
      text = '', bar = 1;
    } else {
      text = left === null ? '' : span(left);
      if (left !== null && total) bar = Math.min(1, Math.max(0, 1 - left / total));
    }
    pill.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">' + I[ph[0]] + '</svg>' +
      (text ? text : '') + '<small>' + ph[fr ? 1 : 2] + '</small><i style="width:' + Math.round(bar * 100) + '%"></i>';
    pill.title = (fr ? 'Lave-linge : ' : 'Washing machine: ') + ph[fr ? 1 : 2] + (left !== null && st !== 'end' ? ' · ' + span(left) : '');
    pill.hidden = false;
  }

  function apply(ev) {
    var id;
    for (id in ev.a || {}) states[id] = {state: ev.a[id].s || ''};
    for (id in ev.c || {}) {
      var plus = ev.c[id]['+']; states[id] = states[id] || {state: ''};
      if (plus && plus.s !== undefined) states[id].state = plus.s;
    }
    (ev.r || []).forEach(function (r) { delete states[r]; });
  }
  function retry() {
    if (stopped) return;
    attempts++;
    setTimeout(open, Math.min(4000 * Math.pow(2, attempts - 1), 60000));
  }
  function open() {
    var ws;
    try { ws = new WebSocket(K.HA_URL.replace(/^http/, 'ws') + '/api/websocket'); } catch (e) { return retry(); }
    socket = ws; lastMsg = Date.now();
    ws.onmessage = function (m) {
      lastMsg = Date.now();
      var d; try { d = JSON.parse(m.data); } catch (e) { return; }
      if (d.type === 'auth_required') ws.send(JSON.stringify({type: 'auth', access_token: K.HA_TOKEN}));
      else if (d.type === 'auth_ok') { attempts = 0; states = {}; subId = nextId++; ws.send(JSON.stringify({id: subId, type: 'subscribe_entities', entity_ids: [E.status, E.end, E.total]})); }
      else if (d.type === 'auth_invalid') { stopped = true; ws.close(); }          // a wrong token never gets better by retrying
      else if (d.type === 'event' && d.id === subId && d.event) { apply(d.event); render(); }
    };
    ws.onclose = function () { if (socket === ws) { socket = null; retry(); } };
    ws.onerror = function () { /* onclose follows */ };
  }
  open();
  setInterval(function () { render(); if (socket && Date.now() - lastMsg > 70000) socket.close(); }, 30000);  // the countdown, and a link that went silent
  window.addEventListener('beforeunload', function () { stopped = true; });
})();
