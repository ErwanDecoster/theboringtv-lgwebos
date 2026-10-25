// profiles feature - uses window.TV (see README "Feature files"). Loads BEFORE app.js.
// Profile list lives in raw localStorage (`profiles`, `profile`); everything else goes through TV.store, namespaced by prefix.
(function () {
  // Movies: US PG or lower. TV discover ignores certification, so both are limited to Family/Kids genres and drop horror/thriller/crime/war.
  var KIDS_Q = '&certification_country=US&certification.lte=PG&include_adult=false&with_genres=10751%7C10762&without_genres=27,53,80,10768';
  var KIDS_HIDE = ['com.webos.app.browser', 'com.zee5.app', 'com.webos.app.discovery', 'com.palm.app.settings'];
  var COLORS = ['#8ab4f8', '#f28b82', '#fdd663', '#81c995', '#c58af9', '#ff8bcb', '#78d9ec', '#fcad70'];
  var NAMES = ['Mom', 'Dad', 'Kids', 'Guest', 'Grandma', 'Grandpa', 'Friend', 'Me'];

  var list;
  try { list = JSON.parse(localStorage.profiles || '[]'); } catch (e) { list = []; }
  // id 'default' keeps prefix '' so settings/history saved before profiles existed stay with it
  if (!list.length) list = [{id: 'default', name: (window.CONFIG && CONFIG.NAME) || 'Me', color: COLORS[0], kids: false, hideApps: []}];
  function save() { localStorage.profiles = JSON.stringify(list); if (window.TV && window.TV.refreshAvatar) window.TV.refreshAvatar(); }   // the top button follows the number of profiles
  function byId(id) { return list.filter(function (p) { return p.id === id; })[0]; }
  function prefix(p) { return p.id === 'default' ? '' : p.id + '.'; }
  save();
  var cur = byId(localStorage.profile) || list[0];
  window.TV_PROFILE = {prefix: prefix(cur), name: cur.name, color: cur.color, extraQ: cur.kids ? KIDS_Q : '', hideApps: cur.hideApps || []};

  // The question "who is watching?" is asked once per session: choosing a profile reloads the page, which must not ask it again.
  function asked() { try { return sessionStorage.pAsked === '1'; } catch (e) { return false; } }
  function markAsked() { try { sessionStorage.pAsked = '1'; } catch (e) { /* storage unavailable */ } }
  function reload() { markAsked(); location.reload(); }
  var KB = {azerty: ['azertyuiop', 'qsdfghjklm', 'wxcvbn'], qwerty: ['qwertyuiop', 'asdfghjkl', 'zxcvbnm'], abc: ['abcdefghijklm', 'nopqrstuvwxyz']};
  var NAME_MAX = 12;
  // what a profile stores that is not under its own prefix (the first profile, "default", keeps the keys of before profiles existed)
  var DEFAULT_KEYS = ['settings', 'homeCache', 'recent', 'watchlist', 'appHidden', 'appOrder', 'weatherLoc', 'hintEdit', 'seen', 'skipped', 'syncedKeys', 'pending', 'trakt', 'traktSync', 'traktOut'];

  window.addEventListener('tvready', function () {
    var TV = window.TV, quick = TV.onAvatar;
    var box = document.createElement('div'); box.id = 'prof'; box.hidden = true; document.body.appendChild(box);
    // mode: pick (who is watching), edit (choose a profile to edit), form (name / colour / kids), name (free typing). `from`: where the form was opened.
    var mode = 'pick', from = 'pick', draft = null, rows = [], cardsRow = 1, typed = '', delArmed = false, delTimer = 0;

    function dn(name) { return window.I18N ? window.I18N.t(name) : name; }   // the standard names are stored in English and shown translated
    function btn(cls, html, onok) { var e = TV.el('span', cls + ' f', html); e.onok = onok; return e; }
    function av(p) { return '<span class="pav" style="background:' + p.color + '">' + TV.esc(dn(p.name).charAt(0).toUpperCase()) + '</span>'; }
    function taken(name, id) { return list.some(function (p) { return p.id !== id && p.name.toLowerCase() === name.toLowerCase(); }); }
    function chips(opts, val, set) {
      var row = TV.el('div', 'prow');
      opts.forEach(function (o) {
        var c = btn('pchip' + (o[0] === val ? ' on' : ''), o[1], function () { set(o[0]); render(); TV.rebuild(); });
        row.appendChild(c);
      });
      return row;
    }

    function names() { return NAMES.indexOf(draft.name) < 0 ? [draft.name].concat(NAMES) : NAMES; }
    function render() {
      box.innerHTML = ''; rows = []; delArmed = false; clearTimeout(delTimer);
      box.classList.toggle('pedit', mode === 'edit');
      box.classList.toggle('plist', mode === 'pick' || mode === 'edit');
      if (mode === 'form') return renderForm();
      if (mode === 'name') return renderName();
      if (mode === 'pick') {   // quick settings: only where it makes sense
        var head = TV.el('div', 'phead'), qs = btn('pbtn', 'Quick settings', function () { TV.closeView(); quick(); });
        head.appendChild(qs); box.appendChild(head); rows.push([qs]);
      }
      cardsRow = rows.length;
      box.appendChild(TV.el('h1', 'ptitle', mode === 'edit' ? 'Choose a profile to edit' : 'Who’s watching?'));
      var strip = TV.el('div', 'pstrip'), avs = [];
      list.forEach(function (pr) {
        var e = btn('pcard' + (pr.id === cur.id ? ' cur' : ''), av(pr) + '<b>' + TV.esc(dn(pr.name)) + '</b>' + (pr.kids ? '<i>Kids</i>' : ''), function () {
          if (mode === 'edit') { from = 'edit'; draft = Object.assign({}, pr); mode = 'form'; render(); return TV.rebuild(0, Math.max(0, names().indexOf(pr.name))); }
          if (pr.id === cur.id) return TV.closeView();
          localStorage.profile = pr.id; reload();
        });
        strip.appendChild(e); avs.push(e);
      });
      var add = btn('pcard', '<span class="pav padd">+</span><b>Add profile</b>', function () {
        from = mode;
        draft = {id: '', name: NAMES.filter(function (n) { return !taken(n, ''); })[0] || 'Profile ' + (list.length + 1),
          color: COLORS.filter(function (c) { return !list.some(function (pr) { return pr.color === c; }); })[0] || COLORS[list.length % COLORS.length], kids: false};
        mode = 'form'; render(); TV.rebuild(0, names().indexOf(draft.name));
      });
      strip.appendChild(add); avs.push(add);
      box.appendChild(strip); rows.push(avs);
      var foot = TV.el('div', 'pfoot'), ed = btn('pbtn', mode === 'edit' ? 'Done' : 'Edit profiles', function () { mode = mode === 'edit' ? 'pick' : 'edit'; render(); TV.rebuild(cardsRow, 0); });
      foot.appendChild(ed); box.appendChild(foot); rows.push([ed]);
    }

    function renderForm() {
      box.appendChild(TV.el('h1', 'ptitle', draft.id ? 'Edit profile' : 'Add profile'));
      box.appendChild(TV.el('div', 'pprev', av(draft)));
      var nameRow = chips(names().map(function (n) { return [n, TV.esc(n)]; }), draft.name, function (v) { draft.name = v; });
      nameRow.appendChild(btn('pchip', 'Other…', function () { typed = NAMES.indexOf(draft.name) < 0 ? draft.name : ''; mode = 'name'; render(); TV.rebuild(0, 0); }));
      [['Name', nameRow],
       ['Colour', chips(COLORS.map(function (c) { return [c, '<span class="pdot" style="background:' + c + '"></span>']; }), draft.color, function (v) { draft.color = v; })],
       ['Kids profile', chips([[true, 'On'], [false, 'Off']], draft.kids, function (v) { draft.kids = v; })]
      ].forEach(function (r) {
        box.appendChild(TV.el('div', 'plabel', r[0] + (r[0] === 'Kids profile' ? '<small>Family-friendly titles only; hides Browser, ZEE5, Apps Store and Settings</small>' : '')));
        box.appendChild(r[1]); rows.push([].slice.call(r[1].children));
      });
      var act = TV.el('div', 'prow pacts'), a = [];
      a.push(btn('pbtn', 'Save', function () {
        if (taken(draft.name, draft.id)) return TV.toast('This name is already taken');
        var pr = byId(draft.id);
        if (!pr) { pr = {id: 'p' + Date.now().toString(36)}; list.push(pr); }
        var kidsChanged = pr.kids !== draft.kids;
        pr.name = draft.name; pr.color = draft.color; pr.kids = draft.kids;
        if (kidsChanged || !pr.hideApps) pr.hideApps = pr.kids ? KIDS_HIDE.slice() : [];
        save();
        if (pr.id === cur.id) return reload(); // current profile's avatar/filters changed
        mode = from; render(); TV.rebuild(cardsRow, list.indexOf(pr));
      }));
      if (draft.id && list.length > 1) {
        var del = btn('pbtn pdel', 'Delete', function () {
          if (!delArmed) {   // a first OK only asks; the second one deletes
            delArmed = true; del.textContent = 'Confirm?';
            delTimer = setTimeout(function () { delArmed = false; del.textContent = 'Delete'; }, 4000);
            return;
          }
          list = list.filter(function (pr) { return pr.id !== draft.id; }); save();
          var pre = prefix(draft);
          if (pre) Object.keys(localStorage).forEach(function (k) { if (k.indexOf(pre) === 0) localStorage.removeItem(k); });
          else DEFAULT_KEYS.forEach(function (k) { localStorage.removeItem(k); });
          if (draft.id === cur.id) { localStorage.profile = list[0].id; return reload(); }
          mode = from; render(); TV.rebuild(cardsRow, 0);
        });
        a.push(del);
      }
      a.push(btn('pbtn', 'Cancel', back));
      a.forEach(function (e) { act.appendChild(e); }); box.appendChild(act); rows.push(a);
    }

    // Typing a name with the remote: the on-screen keyboard (same layout as the search), up to NAME_MAX letters.
    function showTyped() {
      var t = box.querySelector('.ptext'); if (!t) return;
      t.textContent = typed || 'Type a name'; t.classList.toggle('dim', !typed);
      var pav = box.querySelector('.pav'); if (pav) pav.textContent = (typed || '?').charAt(0).toUpperCase();
    }
    function press(ch) {
      if (typed.length >= NAME_MAX) return;
      typed += (!typed || typed.slice(-1) === ' ') ? ch.toUpperCase() : ch;   // a capital at the start of each word
      showTyped();
    }
    function acceptName() {
      var name = typed.replace(/\s+/g, ' ').trim();
      if (!name) return TV.toast('Type a name first');
      if (taken(name, draft.id)) return TV.toast('This name is already taken');
      draft.name = name; mode = 'form'; render(); TV.rebuild(0, names().indexOf(draft.name));
    }
    function renderName() {
      box.appendChild(TV.el('h1', 'ptitle', 'Profile name'));
      box.appendChild(TV.el('div', 'pprev', av({name: typed || '?', color: draft.color})));
      box.appendChild(TV.el('div', 'pfield', '<span class="ptext"></span><i class="caret"></i>'));
      var kb = TV.el('div', 'pkb');
      (KB[TV.S.keyboard] || KB.azerty).forEach(function (letters) {
        var r = TV.el('div', 'pkrow'), ks = [];
        letters.split('').forEach(function (ch) { var k = btn('pkey', ch, function () { press(ch); }); r.appendChild(k); ks.push(k); });
        kb.appendChild(r); rows.push(ks);
      });
      var r = TV.el('div', 'pkrow'), a = [
        btn('pkey pwide', '⌫', function () { typed = typed.slice(0, -1); showTyped(); }),
        btn('pkey pwide', 'Space', function () { if (typed && typed.slice(-1) !== ' ') press(' '); }),
        btn('pbtn', 'Cancel', back),
        btn('pbtn', 'Done', acceptName)];
      a.forEach(function (e) { r.appendChild(e); }); kb.appendChild(r); rows.push(a);
      box.appendChild(kb); showTyped();
    }
    // up / down on the keyboard go to the key that is above / below, not to the same position in the row
    function moveKey(d) {
      var row = rows[TV.pos().r], cur0 = row && row[TV.pos().c], to = rows[TV.pos().r + d];
      if (!cur0 || !to) return false;
      var cx = cur0.offsetLeft + cur0.offsetWidth / 2, best = 0, bestDist = 1e9;
      to.forEach(function (k, i) { var dist = Math.abs(k.offsetLeft + k.offsetWidth / 2 - cx); if (dist < bestDist) { bestDist = dist; best = i; } });
      TV.rebuild(TV.pos().r + d, best);
      return true;
    }

    function back() {
      if (mode === 'pick') return TV.closeView();
      if (mode === 'name') { mode = 'form'; render(); return TV.rebuild(0, Math.max(0, names().indexOf(draft.name))); }
      mode = mode === 'form' ? from : 'pick'; render(); TV.rebuild(cardsRow, 0);
    }

    TV.addView('profiles', {
      nav: function () { return rows; },
      show: function () { mode = 'pick'; box.hidden = false; document.body.classList.add('profiles-open'); render(); },
      hide: function () { box.hidden = true; document.body.classList.remove('profiles-open'); },
      back: back,
      keydown: function (ev) {
        if (mode !== 'name') return false;
        if (ev.keyCode === 38 || ev.keyCode === 40) return moveKey(ev.keyCode === 40 ? 1 : -1);
        if (ev.key && ev.key.length === 1 && /[a-zà-ÿ' -]/i.test(ev.key) && !ev.ctrlKey && !ev.metaKey) { press(ev.key); return true; }   // a USB / Bluetooth keyboard
        return false;
      }
    });
    function openSwitcher() { markAsked(); TV.openView('profiles'); TV.rebuild(cardsRow, list.indexOf(cur)); }
    TV.onAvatar = openSwitcher;
    TV.addSetting({key: 'askProfile', title: 'Ask who’s watching at start', opts: [[true, 'On'], [false, 'Off']]}, false);
    if (TV.S.askProfile && list.length > 1 && !asked()) openSwitcher();
  });
})();
