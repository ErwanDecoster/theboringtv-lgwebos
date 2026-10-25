'use strict';
// Helper service for the Launcher, for rooted TVs. It runs as root and does what a normal web app
// is not allowed to: list every installed app with its real icon, and change picture / sound /
// volume / screen settings. The Launcher talks to it over HTTP on the TV's own loopback.
//
// Safety:
//  - listens on 127.0.0.1 only, and only answers pages loaded from the TV's local files (the
//    Launcher itself): web pages from the browser app, or any DNS-rebinding trick, are refused
//  - a fixed list of operations, never a pass-through: every value is checked against the list
//    the TV itself offers, and icons are served only from paths the app manager reported
//  - no dependencies, nothing written to disk except a small log in /tmp
//
// Run: node tv-service.js   (see start.sh, which the Homebrew Channel runs at boot)

var http = require('http');
var fs = require('fs');
var cp = require('child_process');
var net = require('net');

var HOST = '127.0.0.1';
var PORT = 45621;
var VERSION = 3;
var LOG = '/tmp/launcher-service.log';
var SELF_APP = 'works.partridge.webos-launcher';

var SETTINGS = 'luna://com.webos.settingsservice/';
var AUDIO = 'luna://com.webos.service.audio/master/';
var POWER = 'luna://com.webos.service.tvpower/power/';
var APPMGR = 'luna://com.webos.applicationManager/';

function log (message) {
	try {
		fs.appendFileSync(LOG, new Date().toISOString() + ' ' + message + '\n');
		if (fs.statSync(LOG).size > 40000) fs.writeFileSync(LOG, '');
	} catch (e) { /* the log is a convenience */ }
}

process.on('uncaughtException', function (e) { log('uncaught: ' + (e && e.stack || e)); });
process.on('unhandledRejection', function (e) { log('unhandled: ' + (e && e.stack || e)); });

// ---------- luna ----------

function luna (uri, params) {
	return new Promise(function (resolve) {
		cp.execFile('luna-send', ['-n', '1', '-w', '5000', uri, JSON.stringify(params || {})],
			{timeout: 8000, maxBuffer: 4 << 20}, function (err, out) {
				try { resolve(JSON.parse(out)); }
				catch (e) { resolve({returnValue: false, errorText: String(err ? err.message : 'unreadable reply').slice(0, 160)}); }
			});
	});
}

function readSettings (category, keys) {
	return luna(SETTINGS + 'getSystemSettings', {category: category, keys: keys}).then(function (r) { return r.settings || {}; });
}

/** The values the TV currently offers for a setting (visible and enabled ones). */
function offered (category, key) {
	return luna(SETTINGS + 'getSystemSettingDesc', {category: category, keys: [key]}).then(function (r) {
		var values = (r.results && r.results[0] && r.results[0].values) || {};
		var list = values.arrayExt || (values.array || []).map(function (v) { return {value: v}; });
		return list.filter(function (a) { return a.visible !== false && a.active !== false; }).map(function (a) { return String(a.value); });
	});
}

// ---------- apps and icons ----------

var APPS_TTL_MS = 30000;
var appsCache = {at: 0, apps: []};
var iconPaths = {};            // app id -> icon file, from the last list; the only files ever served

function usablePath (p) {
	return typeof p === 'string' && /^\/[A-Za-z0-9._\/+@ -]+\.(png|jpg|jpeg|svg|webp)$/i.test(p) && p.indexOf('..') === -1;
}

function listApps () {
	if (Date.now() - appsCache.at < APPS_TTL_MS && appsCache.apps.length) return Promise.resolve(appsCache.apps);
	return luna(APPMGR + 'listLaunchPoints', {}).then(function (r) {
		if (!r.launchPoints) return appsCache.apps;
		var paths = {};
		var apps = r.launchPoints
			.filter(function (p) { return p.id && p.title && !p.hidden && p.id !== SELF_APP && p.id !== 'com.webos.app.discovery' && p.id.indexOf('google.assistant') !== 0; })
			.map(function (p) {
				// the biggest the TV offers first (192 px, sometimes more): the tiles are drawn at 150-170 px
				var icon = [p.extraLargeIcon, p.largeIcon, p.mediumLargeIcon, p.icon].filter(usablePath)[0];
				if (icon) paths[p.id] = icon.replace('/./', '/');
				return {id: p.id, title: p.title, color: p.bgColor || p.iconColor || null, icon: !!icon};
			});
		iconPaths = paths;
		appsCache = {at: Date.now(), apps: apps};
		return apps;
	});
}

// ---------- microphone ----------

// The TV's far-field microphone, as a stream the Launcher apps can read: 16 kHz, 16 bit, mono, raw. webOS hands the audio out of a unix socket
// (five interleaved channels: the microphones and the speaker reference); one of them is passed on. Only one listener at a time, for at most
// MIC_MAX_MS; the stream ends when the client hangs up. Nothing is stored or sent anywhere by this service.
var MIC_MAX_MS = 15000;
var MIC_CHANNELS = 5;
var MIC_CHANNEL = 2;
var micBusy = false;

function mic (req, res) {
	if (micBusy) return reply(res, 409, {returnValue: false, errorText: 'microphone busy'});
	micBusy = true;
	luna('luna://com.webos.service.voiceinput/startStreaming', {deviceType: 'internal'}).then(function (r) {
		if (!r.socketPath) { micBusy = false; return reply(res, 502, {returnValue: false, errorText: r.errorText || 'no audio'}); }
		res.writeHead(200, {'Content-Type': 'application/octet-stream', 'Cache-Control': 'no-store'});
		var frame = MIC_CHANNELS * 2, pending = Buffer.alloc(0), finished = false, timer = 0;
		var sock = net.connect(r.socketPath);
		function stop () {
			if (finished) return;
			finished = true;
			clearTimeout(timer);
			try { sock.destroy(); } catch (e) { /* closed */ }
			try { res.end(); } catch (e) { /* closed */ }
			luna('luna://com.webos.service.voiceinput/stopStreaming', {deviceType: 'internal'}).then(function () { micBusy = false; });
		}
		sock.on('data', function (b) {
			pending = Buffer.concat([pending, b]);
			var n = Math.floor(pending.length / frame), out = Buffer.alloc(n * 2);
			for (var i = 0; i < n; i++) out.writeInt16LE(pending.readInt16LE(i * frame + MIC_CHANNEL * 2), i * 2);
			pending = pending.slice(n * frame);
			if (!finished) res.write(out);
		});
		sock.on('close', stop);
		sock.on('error', stop);
		req.on('close', stop);
		timer = setTimeout(stop, MIC_MAX_MS);
		log('microphone on');
	});
}

// ---------- inputs ----------

// What is plugged into each HDMI port, by name: the TV learns it from the device itself (HDMI-CEC: "Nintendo Switch", "Sonos Beam"...).
// A name the user gave the input on the TV wins; an empty port keeps "HDMI n".
function inputs () {
	return luna('luna://com.webos.service.eim/getAllInputStatus', {}).then(function (r) {
		if (!r.devices) return {returnValue: false, errorText: 'inputs unavailable'};
		return {returnValue: true, inputs: r.devices.map(function (d) {
			var brand = '', osd = '';
			(d.subList || []).forEach(function (s) { if (s.brandName) brand = String(s.brandName); if (s.osdName) osd = String(s.osdName); });
			var name = d.label;
			if (d.connected && !d.modified) name = (osd && brand && osd.toLowerCase().indexOf(brand.toLowerCase()) === 0 ? osd : brand || osd) || d.label;
			return {appId: d.appId, name: String(name).slice(0, 40), connected: !!d.connected, active: !!d.activate};
		})};
	});
}

var MIME = {png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', svg: 'image/svg+xml', webp: 'image/webp'};

function sendIcon (id, res) {
	var path = iconPaths[id];
	if (!path) return reply(res, 404, {returnValue: false, errorText: 'no such icon'});
	fs.readFile(path, function (err, data) {
		if (err) return reply(res, 404, {returnValue: false, errorText: 'unreadable icon'});
		res.writeHead(200, {'Content-Type': MIME[path.split('.').pop().toLowerCase()] || 'application/octet-stream', 'Cache-Control': 'max-age=3600'});
		res.end(data);
	});
}

// ---------- picture, sound, volume, screen ----------

function state () {
	return Promise.all([
		readSettings('picture', ['pictureMode', 'backlight']),
		readSettings('sound', ['soundMode', 'soundOutput']),
		offered('picture', 'pictureMode'),
		offered('sound', 'soundMode'),
		offered('sound', 'soundOutput'),
		luna(AUDIO + 'getVolume', {})
	]).then(function (r) {
		var v = r[5].volumeStatus || {};
		return {
			returnValue: true,
			screenOff: screenOff,
			picture: {mode: r[0].pictureMode || null, backlight: r[0].backlight === undefined ? null : r[0].backlight, modes: r[2]},
			sound: {mode: r[1].soundMode || null, modes: r[3], output: r[1].soundOutput || null, outputs: r[4]},
			volume: {level: v.volume === undefined ? null : v.volume, muted: !!v.muteStatus, output: v.soundOutput || null}
		};
	});
}

/** Sets one value after checking the TV offers it, then returns the new state. */
function setChoice (category, key, value) {
	return offered(category, key).then(function (allowed) {
		if (typeof value !== 'string' || allowed.indexOf(value) === -1) return {returnValue: false, errorText: 'value not offered by the TV'};
		var settings = {};
		settings[key] = value;
		return luna(SETTINGS + 'setSystemSettings', {category: category, settings: settings}).then(function (r) {
			log('set ' + category + '.' + key + '=' + value + ' -> ' + r.returnValue);
			return r.returnValue ? state() : r;
		});
	});
}

function setBacklight (value) {
	var level = Math.round(Number(value));
	if (isNaN(level)) return Promise.resolve({returnValue: false, errorText: 'backlight must be a number'});
	level = Math.max(0, Math.min(100, level));
	return luna(SETTINGS + 'setSystemSettings', {category: 'picture', settings: {backlight: String(level)}}).then(function (r) {
		log('set picture.backlight=' + level + ' -> ' + r.returnValue);
		return r.returnValue ? state() : r;
	});
}

function volume (action) {
	var calls = {
		up: [AUDIO + 'volumeUp', {}],
		down: [AUDIO + 'volumeDown', {}],
		mute: [AUDIO + 'setMuted', {muted: true}],
		unmute: [AUDIO + 'setMuted', {muted: false}]
	};
	if (!calls[action]) return Promise.resolve({returnValue: false, errorText: 'unknown volume action'});
	return luna(calls[action][0], calls[action][1]).then(function (r) { return r.returnValue === false ? r : state(); });
}

// The screen can be turned off while the sound keeps playing. Any remote key then turns it back on;
// the input devices are only watched while the screen is off.
var screenOff = false;
var watcher = null;
var EV_KEY = 1;
var EVENT_SIZE = 16;           // 32-bit struct input_event

function stopWatching () {
	if (watcher) { clearInterval(watcher.timer); watcher.fds.forEach(function (fd) { try { fs.closeSync(fd); } catch (e) { /* closed */ } }); watcher = null; }
}

function screenOn () {
	screenOff = false;
	stopWatching();
	return luna(POWER + 'turnOnScreen', {});
}

function watchKeys () {
	stopWatching();
	var fds = [];
	try {
		fs.readdirSync('/dev/input').filter(function (f) { return f.indexOf('event') === 0; }).forEach(function (f) {
			try { fds.push(fs.openSync('/dev/input/' + f, fs.constants.O_RDONLY | fs.constants.O_NONBLOCK)); } catch (e) { /* skip */ }
		});
	} catch (e) { log('cannot read /dev/input: ' + e.message); }
	var buf = Buffer.alloc(EVENT_SIZE * 64);
	var timer = setInterval(function () {
		for (var i = 0; i < fds.length; i++) {
			var n = 0;
			try { n = fs.readSync(fds[i], buf, 0, buf.length, null); } catch (e) { continue; }   // EAGAIN: nothing waiting
			for (var o = 0; o + EVENT_SIZE <= n; o += EVENT_SIZE) {
				if (buf.readUInt16LE(o + 8) === EV_KEY && buf.readInt32LE(o + 12) === 1) { log('key pressed, screen on'); screenOn(); return; }
			}
		}
	}, 50);
	watcher = {fds: fds, timer: timer};
}

function setScreen (on) {
	if (on) return screenOn().then(function (r) { return r.returnValue === false ? r : state(); });
	return luna(POWER + 'turnOffScreen', {}).then(function (r) {
		if (r.returnValue === false) return r;
		screenOff = true;
		watchKeys();
		log('screen off');
		return state();
	});
}

// ---------- Home key ----------

// When TV Home stands in for LG's home (as-home.sh), apps that handle the Home key themselves (Netflix...) never hand it to the system, so
// the press does nothing. This only READS the remote's key events (it does not grab or change them) and opens the home app on each press.
// Without that substitution it does nothing, so LG's own home is never disturbed.
var HOME_CODE = 773;                // HOME on LG Magic Remotes
var HOME_APP = 'com.webos.app.home';
var homeBusy = false;

function homeIsTvHome () {
	try { return fs.readFileSync('/proc/mounts', 'utf8').indexOf(' /usr/palm/applications/' + HOME_APP + ' ') !== -1; } catch (e) { return false; }
}

function onHome () {
	if (homeBusy || !homeIsTvHome()) return;
	homeBusy = true;
	setTimeout(function () { homeBusy = false; }, 1600);
	setTimeout(function () {
		luna(APPMGR + 'launch', {id: HOME_APP}).then(function (r) { log('home key: launch ' + HOME_APP + ' -> ' + r.returnValue); });
	}, 150);
}

function watchHome () {
	var fds = [];
	try {
		fs.readdirSync('/dev/input').filter(function (f) { return f.indexOf('event') === 0; }).forEach(function (f) {
			try { fds.push(fs.openSync('/dev/input/' + f, fs.constants.O_RDONLY | fs.constants.O_NONBLOCK)); } catch (e) { /* skip */ }
		});
	} catch (e) { log('home key: cannot read /dev/input: ' + e.message); return; }
	log('home key: watching ' + fds.length + ' input devices');
	var buf = Buffer.alloc(EVENT_SIZE * 64);
	setInterval(function () {
		for (var i = 0; i < fds.length; i++) {
			var n = 0;
			try { n = fs.readSync(fds[i], buf, 0, buf.length, null); } catch (e) { continue; }   // EAGAIN: nothing waiting
			for (var o = 0; o + EVENT_SIZE <= n; o += EVENT_SIZE) {
				if (buf.readUInt16LE(o + 8) === EV_KEY && buf.readInt32LE(o + 12) === 1 && buf.readUInt16LE(o + 10) === HOME_CODE) { log('home key pressed'); onHome(); }
			}
		}
	}, 30);
}

// ---------- Back to TV Home ----------

// Without the substitution, TV Home is only the target of the Home key (defaultApps.home, see the README). Everything else that lands on
// LG's home (startup, wake from standby, Back out of an app) still opens LG's home: this follows the foreground app and opens TV Home when it
// is LG's. It never touches the app manager itself (restarting it makes the TV lose the soundbar's ARC). At most 3 launches in 30 s, so a
// failing launch can never turn into a loop.
var TV_HOME_APP = 'com.boring.tvhome';
var launches = [];

function openTvHome () {
	var now = Date.now();
	launches = launches.filter(function (t) { return now - t < 30000; });
	if (launches.length >= 3) return log('foreground: too many launches, leaving LG home alone');
	launches.push(now);
	setTimeout(function () {
		luna(APPMGR + 'launch', {id: TV_HOME_APP}).then(function (r) { log('foreground: LG home -> launch ' + TV_HOME_APP + ' -> ' + r.returnValue); });
	}, 250);
}

function watchForeground () {
	if (homeIsTvHome()) return;         // the substitution already makes LG's home id open TV Home
	var buf = '';
	var child = cp.spawn('luna-send', ['-i', APPMGR + 'getForegroundAppInfo', '{"subscribe":true}'], {stdio: ['ignore', 'pipe', 'ignore']});
	child.stdout.on('data', function (d) {
		buf += d;
		var end;
		while ((end = buf.indexOf('\n')) !== -1) {      // one JSON message per line
			var msg = buf.slice(0, end);
			buf = buf.slice(end + 1);
			var m = /"appId"\s*:\s*"([^"]*)"/.exec(msg);
			if (m && m[1] === HOME_APP) openTvHome();
		}
		if (buf.length > 8192) buf = '';
	});
	child.on('exit', function () { setTimeout(watchForeground, 5000); });
	log('foreground: following the foreground app');
}

// With "last input" set to TV Home and Home Auto Launch off (tools/tv-boot-settings), LG's home never shows at power-on, so nothing would
// open TV Home. Open it ourselves once the TV is ready, but only in the first minutes after the TV started, so restarting this service
// later never pulls anyone out of the app they are watching.
// webOS reports TV Home "in front" (it is the last input) while its window is still not shown, leaving a black screen: launching it
// again brings it up. So it is launched twice, about 12 s apart, even when it is reported in front.
function bootLaunch (tries, launched) {
	var up = 0;
	try { up = parseFloat(fs.readFileSync('/proc/uptime', 'utf8')); } catch (e) { return; }
	if (up > 240 || tries > 40 || launched >= 2) return;
	luna(APPMGR + 'getForegroundAppInfo', {}).then(function (r) {
		if (r.returnValue && r.appId && r.appId !== TV_HOME_APP && r.appId !== HOME_APP && r.appId !== 'com.webos.app.livetv') return log('boot: ' + r.appId + ' is in front, leaving it');
		return luna(APPMGR + 'launch', {id: TV_HOME_APP}).then(function (l) {
			log('boot: launch ' + TV_HOME_APP + ' -> ' + l.returnValue);
			if (!l.returnValue) setTimeout(function () { bootLaunch(tries + 1, launched); }, 3000);
			else setTimeout(function () { bootLaunch(tries + 1, launched + 1); }, launched === 0 ? 12000 : 0);
		});
	});
}

// ---------- power events ----------

// Tells Home Assistant (or any URL) when the TV goes off or comes on. Polling the TV is unreliable: with Quick Start+ it keeps its network up in
// standby, so integrations that ping it think it is still on. The power service says exactly what happens, and in this order (seen on an LG C4):
//   {state:'Active', processing:'Request Power Off', onOff:'off', reason:'remoteKey'}   the remote's key was pressed, the screen is still on
//   {state:'Active Standby'}                                                              standby reached (~0.5 s later with lgLogoDisplay off)
//   {state:'Active Standby', processing:'Prepare Power On', onOff:'on', reason:'remoteKey'}
//   {state:'Active'}                                                                      back on
// Configured by /media/developer/tv-service/events.json (see events.example.json); without that file nothing is sent.
// <power-handler>
function makePowerHandler(emit) {
	var tv = null, lastEvent = '', lastAt = 0;
	function fire(event, msg) {
		var now = Date.now();
		if (event === lastEvent && now - lastAt < 2000) return;       // the power service repeats itself
		lastEvent = event; lastAt = now;
		emit({event: event, state: tv, power_state: msg.state || '', processing: msg.processing || '', reason: msg.reason || ''});
	}
	return function (msg) {
		if (!msg || typeof msg.state !== 'string') return;
		var st = msg.state.replace(/\s+/g, '');                       // the subscription says "Screen Saver", the one-shot call "ScreenSaver"
		var now = (st === 'Active' || st === 'ScreenSaver') ? 'on' : 'off';
		var first = tv === null;
		if (msg.processing === 'Request Power Off' && msg.onOff === 'off') fire('off_requested', msg);
		else if (msg.processing === 'Prepare Power On' && msg.onOff === 'on') fire('on_requested', msg);
		if (now !== tv) {
			tv = now;
			if (!first) fire(now, msg);                                // the first message only says where we are, it is not a change
		}
	};
}
// </power-handler>

function postJson(urlString, body, tries) {
	var u = require('url').parse(urlString), data = JSON.stringify(body);
	var req = (u.protocol === 'https:' ? require('https') : http).request({
		hostname: u.hostname, port: u.port, path: u.path, method: 'POST', timeout: 4000,
		headers: {'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(data)}
	}, function (res) {
		res.resume();
		if (res.statusCode >= 200 && res.statusCode < 300) return log('power event ' + body.event + ' sent (' + res.statusCode + ')');
		retry('HTTP ' + res.statusCode);
	});
	req.on('timeout', function () { req.destroy(new Error('timeout')); });
	req.on('error', function (e) { retry(e.message); });
	req.end(data);
	function retry(why) {
		if (tries >= 3) return log('power event ' + body.event + ' not delivered: ' + why);
		setTimeout(function () { postJson(urlString, body, tries + 1); }, tries * 2500);   // a TV waking up may not have its network yet
	}
}

function watchPower() {
	var cfg;
	try { cfg = JSON.parse(fs.readFileSync(__dirname + '/events.json', 'utf8')); } catch (e) { return log('power events: no events.json, nothing is sent'); }
	if (!cfg || typeof cfg.webhook !== 'string' || !/^https?:\/\//.test(cfg.webhook)) return log('power events: events.json needs a "webhook" URL');
	var wanted = Array.isArray(cfg.events) ? cfg.events : ['off_requested', 'off', 'on_requested', 'on'];
	var handler = makePowerHandler(function (ev) {
		if (wanted.indexOf(ev.event) < 0) return;
		ev.name = cfg.name || 'tv'; ev.at = new Date().toISOString();
		log('power event ' + ev.event + ' (' + ev.power_state + (ev.processing ? ' / ' + ev.processing : '') + ')');
		postJson(cfg.webhook, ev, 0);
	});
	var buf = '';
	var child = cp.spawn('luna-send', ['-i', POWER + 'getPowerState', '{"subscribe":true}'], {stdio: ['ignore', 'pipe', 'ignore']});
	child.stdout.on('data', function (d) {
		buf += d;
		var end;
		while ((end = buf.indexOf('\n')) !== -1) {      // one JSON message per line
			var line = buf.slice(0, end); buf = buf.slice(end + 1);
			try { handler(JSON.parse(line)); } catch (e) { /* not a message */ }
		}
		if (buf.length > 8192) buf = '';
	});
	child.on('exit', function () { setTimeout(watchPower, 5000); });
	log('power events: watching, sending to ' + cfg.webhook.replace(/\/api\/webhook\/.*/, '/api/webhook/…'));
}

// ---------- HTTP ----------

var ALLOWED_HOSTS = [HOST + ':' + PORT, 'localhost:' + PORT];
var ALLOWED_ORIGINS = ['null', 'file://'];

function reply (res, status, body) {
	res.writeHead(status, {'Content-Type': 'application/json'});
	res.end(JSON.stringify(body));
}

function readBody (req, cb) {
	var body = '';
	req.on('data', function (c) { body += c; if (body.length > 32768) req.destroy(); });
	req.on('end', function () { try { cb(JSON.parse(body || '{}')); } catch (e) { cb({}); } });
}

// Trakt for the page: the TV page has no web origin ("null"), so Trakt's CORS rules would refuse its calls. The page sends them here instead.
// Only api.trakt.tv, only the paths the page needs, and the page's own client id and token ride along: nothing is stored here.
var TRAKT_URL = process.env.TRAKT_URL || 'https://api.trakt.tv';
function traktCall (p) {
	return new Promise(function (ok) {
		var path = String(p.path || ''), method = p.method === 'GET' ? 'GET' : 'POST';
		if (path.indexOf('..') >= 0 || !/^\/(oauth|sync|users|shows|scrobble)\/[A-Za-z0-9_\/?=&.-]*$/.test(path)) return ok({returnValue: false, errorText: 'path not allowed'});
		var u = require('url').parse(TRAKT_URL + path), data = method === 'POST' ? JSON.stringify(p.body || {}) : '';
		var h = {'Content-Type': 'application/json', 'User-Agent': 'TVHome/' + VERSION + ' (webOS)', 'trakt-api-version': '2', 'trakt-api-key': String(p.clientId || '')};   // Trakt's front door refuses requests without a User-Agent
		if (p.token) h.Authorization = 'Bearer ' + p.token;
		if (data) h['Content-Length'] = Buffer.byteLength(data);
		var req = (u.protocol === 'https:' ? require('https') : http).request({hostname: u.hostname, port: u.port, path: u.path, method: method, headers: h, timeout: 15000}, function (res) {
			var text = '';
			res.setEncoding('utf8');
			res.on('data', function (c) { if (text.length < 2e6) text += c; });
			res.on('end', function () { ok({returnValue: true, status: res.statusCode, pages: res.headers['x-pagination-page-count'] || 0, text: text}); });
		});
		req.on('timeout', function () { req.destroy(new Error('timeout')); });
		req.on('error', function (e) { ok({returnValue: false, errorText: e.message}); });
		req.end(data);
	});
}

// LG's own screensaver, replaced by TV Home's idle screen. The power service (tvpowerd) tells its clients just before the screensaver starts: {state: "Active",
// timestamp: "..."} to whoever registered with registerScreenSaverRequest, and waits for their answer (responseScreenSaverRequest, the timestamp sent back AS TEXT). An
// answer of ack:false stops it (undocumented by LG; the method names are in tvpowerd, the behaviour was seen on webOS 25). When the page has said it wants to take over,
// the request is refused and TV Home is launched with {ambient: true}: it shows its idle screen from whatever app was in front (the page leaves it with any key).
// If the page cannot show it (no pictures yet), it says so and the next request is let through for a minute, so the screen never stays still and bare.
var ambientTakeover = false, lgAllowUntil = 0;
function onScreenSaverRequest (msg) {
	log('screensaver: message ' + msg.replace(/\s+/g, ' ').slice(0, 220));   // everything the power service sends, to see its whole protocol
	var ts = /"timestamp"\s*:\s*"?(\d+)"?/.exec(msg), st = /"state"\s*:\s*"([^"]*)"/.exec(msg);
	if (!ts || !st || st[1] !== 'Active') return;
	var ours = ambientTakeover && Date.now() > lgAllowUntil;
	luna(POWER + 'responseScreenSaverRequest', {clientName: 'tvhome', ack: !ours, timestamp: ts[1]}).then(function (r) {
		log('screensaver: request ' + ts[1] + ' -> ' + (ours ? 'TV Home' : 'LG') + ' (' + r.returnValue + (r.errorText ? ', ' + r.errorText : '') + ')');
		if (!(ours && r.returnValue)) return;
		luna(APPMGR + 'launch', {id: TV_HOME_APP, params: {ambient: true, at: Date.now()}});
		// A refusal alone does not stop it: the power service goes on to "Screen Saver Ready" and starts LG's app about 4 s later, unless something cancels it ("Received
		// turnOnScreen at Screen Saver Ready. Go to Active" in tvpowerd). Launching TV Home does it when TV Home was behind another app; when its idle screen is already up
		// nothing happens and LG's screensaver came on anyway (seen: twice). So the screen is "turned on" (it is already on: it only cancels the launch) a few times
		// during that window, and if LG's app still got up it is closed.
		[600, 1800, 3000].forEach(function (ms) { setTimeout(function () { luna(POWER + 'turnOnScreen', {}); }, ms); });
		setTimeout(function () {
			luna(POWER + 'getPowerState', {}).then(function (p) {
				if (p && String(p.state).replace(/\s+/g, '') === 'ScreenSaver') {
					log('screensaver: LG\'s one came up anyway, closing it');
					luna(APPMGR + 'closeByAppId', {id: 'com.webos.app.screensaver'}).then(function () { luna(POWER + 'turnOnScreen', {}); });
				}
			});
		}, 5500);
	});
}
function watchScreenSaver () {
	var buf = '';
	var child = cp.spawn('luna-send', ['-i', POWER + 'registerScreenSaverRequest', JSON.stringify({subscribe: true, clientName: 'tvhome'})], {stdio: ['ignore', 'pipe', 'ignore']});
	child.stdout.on('data', function (d) {
		buf += d;
		var end;
		while ((end = buf.indexOf('\n')) !== -1) { var msg = buf.slice(0, end); buf = buf.slice(end + 1); onScreenSaverRequest(msg); }
		if (buf.length > 8192) buf = '';
	});
	child.on('exit', function () { setTimeout(watchScreenSaver, 5000); });
	log('screensaver: following the requests');
}

var GET = {
	'/status': function () { return Promise.resolve({returnValue: true, service: 'launcher', version: VERSION}); },
	'/apps': function () { return listApps().then(function (apps) { return {returnValue: true, apps: apps}; }); },
	'/state': state,
	'/inputs': inputs
};

var POST = {
	'/picture': function (p) { return p.backlight !== undefined ? setBacklight(p.backlight) : setChoice('picture', 'pictureMode', p.mode); },
	'/sound': function (p) { return setChoice('sound', 'soundMode', p.mode); },
	'/output': function (p) { return setChoice('sound', 'soundOutput', p.output); },
	'/volume': function (p) { return volume(p.action); },
	'/screen': function (p) { return setScreen(p.on === true); },
	'/trakt': traktCall,
	// the page says whether TV Home's idle screen should replace LG's screensaver (Settings → Ambient mode is not Off); said again at each start and each change
	'/ambient': function (p) { ambientTakeover = p.on === true; log('screensaver: TV Home takes over = ' + ambientTakeover); return Promise.resolve({returnValue: true, takeover: ambientTakeover}); },
	// the page could not show its idle screen: LG's one may start (the next request goes through)
	'/ambient/failed': function () {
		lgAllowUntil = Date.now() + 60000; log('screensaver: TV Home could not show its idle screen, LG\'s one is allowed');
		return luna(POWER + 'turnOnScreenSaver', {});
	},
	'/log': function (p) { log('perf ' + JSON.stringify(p.perf || {}).slice(0, 1500)); return Promise.resolve({returnValue: true}); }
};

http.createServer(function (req, res) {
	var origin = req.headers.origin;
	if (ALLOWED_HOSTS.indexOf(req.headers.host) === -1 || (origin !== undefined && ALLOWED_ORIGINS.indexOf(origin) === -1)) {
		log('refused ' + req.method + ' ' + req.url + ' host=' + req.headers.host + ' origin=' + origin);
		return reply(res, 403, {returnValue: false, errorText: 'forbidden'});
	}
	if (origin !== undefined) res.setHeader('Access-Control-Allow-Origin', origin);
	if (req.method === 'OPTIONS') {
		res.setHeader('Access-Control-Allow-Methods', 'GET, POST');
		res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
		res.writeHead(204);
		return res.end();
	}
	var path = req.url.split('?')[0];
	if (req.method === 'GET' && path === '/mic') return mic(req, res);
	var icon = /^\/icon\/(.+)$/.exec(path);
	if (req.method === 'GET' && icon) return sendIcon(decodeURIComponent(icon[1]), res);
	if (req.method === 'GET' && GET[path]) return GET[path]().then(function (r) { reply(res, 200, r); });
	if (req.method === 'POST' && POST[path]) {
		return readBody(req, function (params) { POST[path](params).then(function (r) { reply(res, 200, r); }); });
	}
	reply(res, 404, {returnValue: false, errorText: 'unknown method'});
}).on('error', function (e) {
	log('server error: ' + e.message);
	process.exit(e.code === 'EADDRINUSE' ? 0 : 1);      // already running elsewhere: nothing to do
}).listen(PORT, HOST, function () {
	try { fs.writeFileSync('/tmp/launcher-service.pid', String(process.pid)); } catch (e) { /* ignore */ }
	watchHome();
	watchForeground();
	watchPower();
	watchScreenSaver();
	bootLaunch(0, 0);
	log('listening on ' + HOST + ':' + PORT + ' (pid ' + process.pid + ')');
});
