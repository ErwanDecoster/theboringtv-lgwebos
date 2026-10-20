// TV Home launcher service, adapted from zzeppieri/webos-custom-home (MIT).
// A registered webOS service inside the TV Home package, so applicationManager/launch is allowed.
// Reads the remote's key events without grabbing them, and opens TV Home:
//   --boot   at startup (retries until the app manager is ready)
//   --watch  whenever HOME is pressed; also after waking from standby
var Service = require('webos-service');
var fs = require('fs');

// With as-home.sh, TV Home *is* com.webos.app.home. Native apps like Netflix don't hand the Home key to the
// system, so we still watch the remote and open the home app ourselves.
var TAKEOVER = fs.existsSync('/usr/palm/applications/com.webos.app.home/index.html');
var APP_ID = TAKEOVER ? 'com.webos.app.home' : 'com.boring.tvhome';
var HOME_CODE = 773; // HOME on LG Magic Remotes (confirmed on the 55UR8040)
var EV_KEY = 1, EVENT_SIZE = 16; // 32-bit struct input_event
var LOG = '/tmp/tvhome-svc.log';
var ARGS = process.argv.slice(2);
function log(msg) { try { fs.appendFileSync(LOG, '[' + new Date().toISOString() + '] ' + msg + '\n'); } catch (e) { /* ignore */ } }

// webos-service exits after ~5s idle unless timeouts are disabled.
if (process.argv.indexOf('--disable-timeouts') === -1) process.argv.push('--disable-timeouts');
var service = new Service('com.boring.tvhome.service');
try { fs.writeFileSync('/tmp/tvhome-svc.pid', String(process.pid)); } catch (e) { /* ignore */ }
log('start pid=' + process.pid + ' args=' + ARGS.join(' ') + ' app=' + APP_ID);
service.register('status', function (m) { m.respond({returnValue: true, running: true, pid: process.pid}); });

function launch(reason, cb) {
  service.call('luna://com.webos.applicationManager/launch', {id: APP_ID}, function (m) {
    log('launch (' + reason + '): ' + JSON.stringify(m && m.payload));
    if (cb) cb(m && m.payload && m.payload.returnValue === true);
  });
}
// LG's own home still opens on HOME (we only read the key) and finishes animating in after our
// first launch, covering TV Home. So launch again once it has appeared. Tune the delays if needed.
var HOME_DELAYS = TAKEOVER ? [150] : [400, 1300]; // with the takeover there is no LG home to wait for
var busy = false;
function onHome() {
  if (busy) return;
  busy = true; setTimeout(function () { busy = false; }, 1600);
  HOME_DELAYS.forEach(function (ms, i) { setTimeout(function () { launch('home-key #' + (i + 1)); }, ms); });
}

// Boot: the app manager isn't ready straight away, so retry for up to ~60s.
function bootLaunch(n) { launch('boot #' + n, function (ok) { if (!ok && n < 30) setTimeout(function () { bootLaunch(n + 1); }, 2000); }); }

// Poll every input device without blocking (blocking reads would use up libuv's thread pool).
function watchAll() {
  var fds = [];
  try {
    fs.readdirSync('/dev/input').filter(function (f) { return f.indexOf('event') === 0; }).forEach(function (f) {
      try { fds.push(fs.openSync('/dev/input/' + f, fs.constants.O_RDONLY | fs.constants.O_NONBLOCK)); } catch (e) { /* skip */ }
    });
  } catch (e) { log('readdir /dev/input: ' + e.message); return; }
  log('watching ' + fds.length + ' input devices');
  var buf = Buffer.alloc(EVENT_SIZE * 64);
  setInterval(function () {
    for (var i = 0; i < fds.length; i++) {
      var n = 0;
      try { n = fs.readSync(fds[i], buf, 0, buf.length, null); } catch (e) { continue; } // EAGAIN = nothing waiting
      for (var off = 0; off + EVENT_SIZE <= n; off += EVENT_SIZE) {
        if (buf.readUInt16LE(off + 8) !== EV_KEY || buf.readInt32LE(off + 12) !== 1) continue;
        var code = buf.readUInt16LE(off + 10);
        if (code === HOME_CODE) { log('HOME key'); onHome(); }
      }
    }
  }, 16);
}

if (ARGS.indexOf('--boot') !== -1) setTimeout(function () { bootLaunch(1); }, 1000);
if (ARGS.indexOf('--watch') !== -1) watchAll();

// Waking from standby doesn't rerun the startup hook, but this process is frozen during standby,
// so a big gap in a 1s heartbeat means the TV just woke: reopen TV Home a few times as the UI returns.
var last = Date.now();
setInterval(function () {
  var now = Date.now(), gap = now - last; last = now;
  if (gap > 10000) {
    log('wake after ~' + Math.round(gap / 1000) + 's');
    var tries = 0, iv = setInterval(function () { launch('wake ' + (++tries)); if (tries >= 4) clearInterval(iv); }, 1500);
  }
}, 1000);
