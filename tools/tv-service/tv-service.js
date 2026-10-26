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
var os = require('os');
var https = require('https');
var urlLib = require('url');

var HOST = '127.0.0.1';
var PORT = 45621;
var VERSION = 3;
var LOG = '/tmp/launcher-service.log';
var SELF_APP = 'works.partridge.webos-launcher';

var SETTINGS = 'luna://com.webos.settingsservice/';
var AUDIO = 'luna://com.webos.service.audio/master/';
var POWER = 'luna://com.webos.service.tvpower/power/';
var APPMGR = 'luna://com.webos.applicationManager/';

// Two logs. /tmp (above) is the working one and is emptied at every boot; KEEP is the same story minus the start-up timings, on the TV's flash, so it survives a reboot:
// after a boot where the helper never ran, the previous boot's lines are still there (service.log, and service.log.1 when it has rolled over at 100 KB).
var KEEP = __dirname + '/service.log';
// The sizes are counted here: a stat() of both files at every line was two more system calls on flash for each of them.
var logSize = 0, keepSize = 0;
try { keepSize = fs.statSync(KEEP).size; } catch (e) { /* none yet */ }
function log (message) {
	try {
		var line = new Date().toISOString() + ' ' + message + '\n';
		fs.appendFileSync(LOG, line);
		if ((logSize += line.length) > 40000) { fs.writeFileSync(LOG, ''); logSize = 0; }
		if (message.indexOf('perf ') !== 0) {
			fs.appendFileSync(KEEP, line);
			if ((keepSize += line.length) > 100000) { fs.renameSync(KEEP, KEEP + '.1'); keepSize = 0; }
		}
	} catch (e) { /* the log is a convenience */ }
}

log('start: helper v' + VERSION + ', pid ' + process.pid + ', the TV has been up ' + Math.round(os.uptime()) + ' s');       // tells a boot where this line is missing from one where the helper never started
['SIGTERM', 'SIGINT', 'SIGHUP'].forEach(function (sig) { process.on(sig, function () { log('stop: ' + sig); flushAmbient(); process.exit(0); }); });
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

// Which apps may be uninstalled from TV Home: the ones the TV itself says are removable and are not part of the system, minus the ones this setup depends on
// (TV Home, its idle screen, the Homebrew Channel that starts this service at every boot). Value: where it is installed (the removal call differs for developer-mode apps).
var KEEP_APPS = ['com.boring.tvhome', 'com.boring.tvhome.ambient', 'org.webosbrew.hbchannel', SELF_APP];
function removableApps () {
	return luna(APPMGR + 'listApps', {}).then(function (r) {
		var can = {};
		(r.apps || []).forEach(function (a) {
			if (a.removable === true && a.systemApp !== true && a.id && a.id.indexOf('com.webos.') !== 0 && KEEP_APPS.indexOf(a.id) < 0) can[a.id] = /^\/media\/developer\//.test(a.folderPath || '') ? 'dev' : 'store';
		});
		return can;
	});
}

function listApps () {
	if (Date.now() - appsCache.at < APPS_TTL_MS && appsCache.apps.length) return Promise.resolve(appsCache.apps);
	return Promise.all([luna(APPMGR + 'listLaunchPoints', {}), removableApps()]).then(function (both) {
		var r = both[0], can = both[1];
		if (!r.launchPoints) return appsCache.apps;
		var paths = {};
		var apps = r.launchPoints
			.filter(function (p) { return p.id && p.title && !p.hidden && p.id !== SELF_APP && p.id !== 'com.webos.app.discovery' && p.id.indexOf('google.assistant') !== 0; })
			.map(function (p) {
				// the biggest the TV offers first (192 px, sometimes more): the tiles are drawn at 150-170 px
				var icon = [p.extraLargeIcon, p.largeIcon, p.mediumLargeIcon, p.icon].filter(usablePath)[0];
				if (icon) paths[p.id] = icon.replace('/./', '/');
				return {id: p.id, title: p.title, color: p.bgColor || p.iconColor || null, icon: !!icon, removable: !!can[p.id]};
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

// The screen can be turned off while the sound keeps playing. Any remote key then turns it back on (see onKeyDown).
var screenOff = false;

function screenOn () {
	screenOff = false;
	return luna(POWER + 'turnOnScreen', {});
}

// ---------- the remote's keys ----------

// One reader of /dev/input for everything that reacts to a key (wake from "screen off", Home, colour buttons, leaving the idle screen): the devices are opened once and
// polled by one timer. The events are only READ (nothing is grabbed or changed). A device that stops answering (unplugged) is dropped instead of failing at every tick.
var EV_KEY = 1;
var EVENT_SIZE = 16;           // 32-bit struct input_event
var KEY_POLL_MS = 50;

function watchKeys () {
	var fds = [];
	try {
		fs.readdirSync('/dev/input').filter(function (f) { return f.indexOf('event') === 0; }).forEach(function (f) {
			try { fds.push(fs.openSync('/dev/input/' + f, fs.constants.O_RDONLY | fs.constants.O_NONBLOCK)); } catch (e) { /* skip */ }
		});
	} catch (e) { return log('keys: cannot read /dev/input: ' + e.message); }
	log('keys: watching ' + fds.length + ' input devices');
	var buf = Buffer.alloc(EVENT_SIZE * 64);
	setInterval(function () {
		for (var i = fds.length - 1; i >= 0; i--) {
			var n = 0;
			try { n = fs.readSync(fds[i], buf, 0, buf.length, null); }
			catch (e) {
				if (e.code !== 'EAGAIN') { try { fs.closeSync(fds[i]); } catch (e2) { /* closed */ } fds.splice(i, 1); }   // EAGAIN: nothing waiting
				continue;
			}
			for (var o = 0; o + EVENT_SIZE <= n; o += EVENT_SIZE) {
				if (buf.readUInt16LE(o + 8) === EV_KEY && buf.readInt32LE(o + 12) === 1) onKeyDown(buf.readUInt16LE(o + 10));      // a key going down
			}
		}
	}, KEY_POLL_MS);
}

function onKeyDown (code) {
	if (screenOff) { log('key pressed, screen on'); screenOn(); }
	if (code === HOME_CODE) { log('home key pressed'); onHome(); } else onColorKey(code);
	onAnyKey(code);
}

function setScreen (on) {
	if (on) return screenOn().then(function (r) { return r.returnValue === false ? r : state(); });
	return luna(POWER + 'turnOffScreen', {}).then(function (r) {
		if (r.returnValue === false) return r;
		screenOff = true;
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

// ---------- the colour buttons (red, green, yellow, blue) ----------
// The remote's four colour buttons do nothing in TV Home. With "keys" in events.json (same file and webhook as the power events) a press is sent to Home Assistant as
// {"event":"key","key":"red",...}, whichever app is in front, and an automation does what it likes with it. "keyCodes" overrides the Linux key codes if a remote differs.
var COLOR_CODES = {red: 398, green: 399, yellow: 400, blue: 401};   // KEY_RED, KEY_GREEN, KEY_YELLOW, KEY_BLUE
var colorByCode = {}, colorCfg = null, colorLast = {};

// events.json is read once (it holds webhook addresses; the helper is restarted to change it): the power events and the colour buttons share it.
var eventsCfg;
function events () {
	if (eventsCfg === undefined) {
		try { eventsCfg = JSON.parse(fs.readFileSync(__dirname + '/events.json', 'utf8')); } catch (e) { eventsCfg = null; }
	}
	return eventsCfg;
}
function isUrl (u) { return typeof u === 'string' && /^https?:\/\//.test(u); }

// A long-lived `luna-send -i` subscription, one message per line, started again 5 s after it ends (the service restarted, or luna-send could not start).
function followLuna (uri, params, onLine) {
	var buf = '', restarted = false;
	function again () { if (!restarted) { restarted = true; setTimeout(function () { followLuna(uri, params, onLine); }, 5000); } }
	var child = cp.spawn('luna-send', ['-i', uri, JSON.stringify(params)], {stdio: ['ignore', 'pipe', 'ignore']});
	child.stdout.on('data', function (d) {
		buf += d;
		var end;
		while ((end = buf.indexOf('\n')) !== -1) { var line = buf.slice(0, end); buf = buf.slice(end + 1); onLine(line); }
		if (buf.length > 8192) buf = '';
	});
	child.on('exit', again);
	child.on('error', again);
}

function configureColorKeys () {
	var cfg = events();
	var url = cfg && (cfg.keysWebhook || cfg.webhook);                // the buttons may have a webhook of their own (a webhook id serves one automation trigger)
	if (!cfg || !isUrl(url) || !Array.isArray(cfg.keys)) return;
	var codes = Object.assign({}, COLOR_CODES, cfg.keyCodes || {});
	cfg.keys.forEach(function (k) { if (codes[k]) colorByCode[codes[k]] = k; });
	colorCfg = cfg;
	log('colour buttons: ' + cfg.keys.filter(function (k) { return codes[k]; }).join(', ') + ' go to ' + (cfg.keysWebhook ? 'their own webhook' : 'the webhook'));
}
function onColorKey (code) {
	var k = colorByCode[code];
	if (!k || !colorCfg) return;
	var now = Date.now();
	if (colorLast[k] && now - colorLast[k] < 500) return;            // one press is one event
	colorLast[k] = now;
	log('colour button ' + k + ' pressed');
	postJson(colorCfg.keysWebhook || colorCfg.webhook, {event: 'key', key: k, name: colorCfg.name || 'tv', at: new Date().toISOString()}, 0);
}

// ---------- Back to TV Home ----------

// Without the substitution, TV Home is only the target of the Home key (defaultApps.home, see the README). Everything else that lands on
// LG's home (startup, wake from standby, Back out of an app) still opens LG's home: this follows the foreground app and opens TV Home when it
// is LG's. It never touches the app manager itself (restarting it makes the TV lose the soundbar's ARC). At most 3 launches in 30 s, so a
// failing launch can never turn into a loop.
var TV_HOME_APP = 'com.boring.tvhome';
var lgHomeUntil = 0;               // while it is in the future, LG's home is let stay in front (the Apps tab's shortcut asked for it)
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
	followLuna(APPMGR + 'getForegroundAppInfo', {subscribe: true}, function (msg) {
		var m = /"appId"\s*:\s*"([^"]*)"/.exec(msg);
		if (m && m[1] === HOME_APP && Date.now() > lgHomeUntil) openTvHome();
	});
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

function what(body) { return body.event === 'key' ? 'button ' + body.key : 'power event ' + body.event; }   // for the log
function postJson(urlString, body, tries) {
	var u = urlLib.parse(urlString), data = JSON.stringify(body);
	var req = (u.protocol === 'https:' ? https : http).request({
		hostname: u.hostname, port: u.port, path: u.path, method: 'POST', timeout: 4000,
		headers: {'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(data)}
	}, function (res) {
		res.resume();
		if (res.statusCode >= 200 && res.statusCode < 300) return log(what(body) + ' sent (' + res.statusCode + ')');
		retry('HTTP ' + res.statusCode);
	});
	req.on('timeout', function () { req.destroy(new Error('timeout')); });
	req.on('error', function (e) { retry(e.message); });
	req.end(data);
	function retry(why) {
		if (tries >= 3) return log(what(body) + ' not delivered: ' + why);
		setTimeout(function () { postJson(urlString, body, tries + 1); }, tries * 2500);   // a TV waking up may not have its network yet
	}
}

function isOn (state) { return state === 'Active' || state === 'ScreenSaver'; }

function watchPower() {
	var cfg = events(), handler = null;
	if (!cfg) log('power events: no events.json, nothing is sent');
	else if (!isUrl(cfg.webhook)) log('power events: events.json needs a "webhook" URL');
	else {
		var wanted = Array.isArray(cfg.events) ? cfg.events : ['off_requested', 'off', 'on_requested', 'on'];
		handler = makePowerHandler(function (ev) {
			if (wanted.indexOf(ev.event) < 0) return;
			ev.name = cfg.name || 'tv'; ev.at = new Date().toISOString();
			log('power event ' + ev.event + ' (' + ev.power_state + (ev.processing ? ' / ' + ev.processing : '') + ')');
			postJson(cfg.webhook, ev, 0);
		});
		log('power events: watching, sending to ' + cfg.webhook.replace(/\/api\/webhook\/.*/, '/api/webhook/…'));
	}
	// Followed even without events.json: standby must close the light idle screen whatever is configured.
	var wasOn = true;
	followLuna(POWER + 'getPowerState', {subscribe: true}, function (line) {
		var m;
		try { m = JSON.parse(line); } catch (e) { return; }      // not a message
		if (m && typeof m.state === 'string') {
			var on = isOn(m.state.replace(/\s+/g, ''));
			if (!on && (wasOn || liteUp)) closeLite(true);       // standby: nothing must be left up for the next power-on (also when this service was restarted while the screen was up)
			wasOn = on;
		}
		if (handler) handler(m);
	});
}

// ---------- HTTP ----------

var ALLOWED_HOSTS = [HOST + ':' + PORT, 'localhost:' + PORT];
var ALLOWED_ORIGINS = ['null', 'file://'];

function reply (res, status, body) {
	res.writeHead(status, {'Content-Type': 'application/json'});
	res.end(JSON.stringify(body));
}

var MAX_BODY = 262144;       // the biggest legitimate body is the idle screen's picture list, ~60 KB

function readBody (req, res, cb) {
	var chunks = [], size = 0, over = false;
	req.on('data', function (c) {
		if (over) return;
		size += c.length;
		if (size > MAX_BODY) { over = true; chunks = []; return reply(res, 413, {returnValue: false, errorText: 'body too large'}); }
		chunks.push(c);
	});
	req.on('end', function () {
		if (over) return;
		var params = {};
		try { params = JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}'); } catch (e) { /* no parameters */ }
		cb(params && typeof params === 'object' ? params : {});
	});
}

// Trakt for the page: the TV page has no web origin ("null"), so Trakt's CORS rules would refuse its calls. The page sends them here instead.
// Only api.trakt.tv, only the paths the page needs, and the page's own client id and token ride along: nothing is stored here.
var TRAKT_URL = process.env.TRAKT_URL || 'https://api.trakt.tv';
function traktCall (p) {
	return new Promise(function (ok) {
		var path = String(p.path || ''), method = p.method === 'GET' ? 'GET' : 'POST';
		if (path.indexOf('..') >= 0 || !/^\/(oauth|sync|users|shows|scrobble)\/[A-Za-z0-9_\/?=&.-]*$/.test(path)) return ok({returnValue: false, errorText: 'path not allowed'});
		var u = urlLib.parse(TRAKT_URL + path), data = method === 'POST' ? JSON.stringify(p.body || {}) : '';
		var h = {'Content-Type': 'application/json', 'User-Agent': 'TVHome/' + VERSION + ' (webOS)', 'trakt-api-version': '2', 'trakt-api-key': String(p.clientId || '')};   // Trakt's front door refuses requests without a User-Agent
		if (p.token) h.Authorization = 'Bearer ' + p.token;
		if (data) h['Content-Length'] = Buffer.byteLength(data);
		var req = (u.protocol === 'https:' ? https : http).request({hostname: u.hostname, port: u.port, path: u.path, method: method, headers: h, timeout: 15000}, function (res) {
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
// What the idle screen shows (pictures, titles, clock settings) is sent by TV Home's page along with /ambient, and kept here for the light idle screen (ambient/ in the repo,
// app com.boring.tvhome.ambient): a small app declared as a "screenSaver" window, like LG's. TV Home itself is a whole web app (rows, pictures, scripts): started in front of
// another app it takes the memory of the TV (2 GB, nearly all used) and the system suspends the app that was there; a music app stops playing. The light one is a slideshow and a clock
// and nothing else, and like LG's screensaver it gets the keys, so the press that wakes the screen does not reach the music app either.
var LITE_APP = 'com.boring.tvhome.ambient';
var ambientData = null, ambientSig = '', liteUp = 0;
var AMBIENT_FILE = __dirname + '/ambient.json';       // the same, on the flash: TV Home is not always running (the system closes it in the background when memory is short) nor is this service the same one as before a restart
try { var saved = JSON.parse(fs.readFileSync(AMBIENT_FILE, 'utf8')); ambientData = saved.data || null; ambientSig = saved.sig || ''; ambientTakeover = saved.on === true; } catch (e) { /* nothing yet */ }
// Flash is written when something changed, at most every 30 minutes (the pictures change slowly), and at once when the setting changes or the service is stopped.
var AMBIENT_SAVE_MS = 30 * 60e3, ambientSaved = Date.now(), ambientDirty = false, ambientSaveT = 0;
function flushAmbient () {
	clearTimeout(ambientSaveT); ambientSaveT = 0;
	if (!ambientDirty) return;
	ambientDirty = false; ambientSaved = Date.now();
	try { fs.writeFileSync(AMBIENT_FILE, JSON.stringify({on: ambientTakeover, sig: ambientSig, data: ambientData})); } catch (e) { /* convenience */ }
}
function saveAmbient (now) {
	ambientDirty = true;
	if (ambientSaveT && !now) return;
	clearTimeout(ambientSaveT);
	ambientSaveT = setTimeout(flushAmbient, now ? 0 : Math.max(0, ambientSaved + AMBIENT_SAVE_MS - Date.now()));
}
function closeLite (force) {
	if (!liteUp && !force) return Promise.resolve();
	liteUp = 0;
	return luna(APPMGR + 'closeByAppId', {id: LITE_APP}).then(function (r) { log('screensaver: light idle screen closed (' + r.returnValue + ')'); });
}
function onAnyKey (code) {
	if (!liteUp) return;
	if (code === HOME_CODE) return void closeLite();
	if (Date.now() - liteUp > 4000) setTimeout(function () { if (liteUp) closeLite(); }, 1500);   // the page leaves by itself on a key (/ambient/leave); this is only the net under it
}
function launchAmbient () {
	return luna(APPMGR + 'getForegroundAppInfo', {}).then(function (f) {
		var items = ambientData && ambientData.items;
		var tvHome = function () { return luna(APPMGR + 'launch', {id: TV_HOME_APP, params: {ambient: true, at: Date.now()}}); };
		if (!items || !items.length || (f && f.appId === TV_HOME_APP)) return tvHome();       // TV Home already in front: nothing to suspend, its own page shows the screen
		liteUp = Date.now();
		return luna(APPMGR + 'launch', {id: LITE_APP, params: {at: Date.now()}}).then(function (r) {
			log('screensaver: light idle screen over ' + (f && f.appId) + ' -> ' + r.returnValue + (r.errorText ? ', ' + r.errorText : ''));
			if (!r.returnValue) { liteUp = 0; return tvHome(); }
		});
	});
}
function onScreenSaverRequest (msg) {
	log('screensaver: message ' + msg.replace(/\s+/g, ' ').slice(0, 220));   // everything the power service sends, to see its whole protocol
	var ts = /"timestamp"\s*:\s*"?(\d+)"?/.exec(msg), st = /"state"\s*:\s*"([^"]*)"/.exec(msg);
	if (!ts || !st || st[1] !== 'Active') return;
	var ours = ambientTakeover && Date.now() > lgAllowUntil;
	luna(POWER + 'responseScreenSaverRequest', {clientName: 'tvhome', ack: !ours, timestamp: ts[1]}).then(function (r) {
		log('screensaver: request ' + ts[1] + ' -> ' + (ours ? 'TV Home' : 'LG') + ' (' + r.returnValue + (r.errorText ? ', ' + r.errorText : '') + ')');
		if (!(ours && r.returnValue)) return;
		launchAmbient();
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
	'/inputs': inputs,
	'/ambient/data': function () { return Promise.resolve(ambientData ? Object.assign({returnValue: true}, ambientData) : {returnValue: false}); }
};

var POST = {
	'/picture': function (p) { return p.backlight !== undefined ? setBacklight(p.backlight) : setChoice('picture', 'pictureMode', p.mode); },
	'/sound': function (p) { return setChoice('sound', 'soundMode', p.mode); },
	'/output': function (p) { return setChoice('sound', 'soundOutput', p.output); },
	'/volume': function (p) { return volume(p.action); },
	'/screen': function (p) { return setScreen(p.on === true); },
	'/trakt': traktCall,
	// LG's own home, on request: the foreground watcher would send straight back to TV Home, so it is told to leave it alone for a minute and a half
	'/lghome': function () {
		lgHomeUntil = Date.now() + 90000;
		log('LG home requested');
		return luna(APPMGR + 'launch', {id: HOME_APP});
	},
	// Uninstalls an app, only one of removableApps() (never a system app, TV Home, or what starts this service). The page asks for a second OK before it calls this. The removal
	// goes on after the call returns: this waits until the app is gone from the TV's list, so the page can redraw.
	'/uninstall': function (p) {
		var id = String(p.id || '');
		return removableApps().then(function (can) {
			var kind = can[id];
			if (!kind) { log('uninstall: ' + id + ' refused'); return {returnValue: false, errorText: 'this app cannot be uninstalled'}; }
			log('uninstall: ' + id + ' (' + kind + ')');
			return luna('luna://com.webos.appInstallService/' + (kind === 'dev' ? 'dev/' : '') + 'remove', {id: id}).then(function (r) {
				if (!r.returnValue) { log('uninstall: ' + id + ' failed: ' + r.errorText); return r; }
				return new Promise(function (done) {
					var tries = 0;
					(function gone () {
						luna(APPMGR + 'getAppInfo', {id: id}).then(function (info) {
							if (!info.returnValue) { appsCache = {at: 0, apps: []}; log('uninstall: ' + id + ' removed'); return done({returnValue: true, removed: true}); }
							if (++tries >= 30) { log('uninstall: ' + id + ' still there after 30 s'); return done({returnValue: false, errorText: 'still installed'}); }
							setTimeout(gone, 1000);
						});
					})();
				});
			});
		});
	},
	// the page says whether TV Home's idle screen should replace LG's screensaver (Settings → Ambient mode is not Off); said again at each start and each change.
	// The pictures are sent only when they changed: the page sends a short signature of its list ("sig") every couple of minutes, and the answer says "need" when the helper has
	// no pictures yet (it was restarted) or another list: only then does the page build and send them (~60 KB).
	'/ambient': function (p) {
		var on = p.on === true, hasData = p.data && Array.isArray(p.data.items) && p.data.items.length, sig = typeof p.sig === 'string' ? p.sig.slice(0, 64) : '';
		var setting = on !== ambientTakeover, pictures = hasData && (!sig || sig !== ambientSig || !ambientData);
		ambientTakeover = on;
		if (pictures) { ambientData = p.data; ambientSig = sig; }
		if (setting || pictures) {
			saveAmbient(setting);                                                // a change of the setting is written at once
			log('screensaver: TV Home takes over = ' + ambientTakeover + (hasData ? ', ' + p.data.items.length + ' pictures' : ''));
		}
		return Promise.resolve({returnValue: true, takeover: ambientTakeover, need: on && (!ambientData || (!!sig && sig !== ambientSig))});
	},
	// the light idle screen is done: a key was pressed (open: the number of the title on screen when OK was pressed on it, to open its page in TV Home, which gets the whole title)
	'/ambient/leave': function (p) {
		return closeLite().then(function () {
			var it = typeof p.open === 'number' && ambientData && ambientData.items[p.open];
			if (!it || !it.it) return {returnValue: true};
			return luna(APPMGR + 'launch', {id: TV_HOME_APP, params: {ambientOpen: true, item: it.it, at: Date.now()}});
		});
	},
	// the page could not show its idle screen: LG's one may start (the next request goes through)
	'/ambient/failed': function () {
		lgAllowUntil = Date.now() + 60000; log('screensaver: TV Home could not show its idle screen, LG\'s one is allowed');
		return closeLite().then(function () { return luna(POWER + 'turnOnScreenSaver', {}); });
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
	// a handler that throws or fails must still answer, or the page waits for its timeout
	function answer (promise) { promise.then(function (r) { reply(res, 200, r); }, function (e) { log('handler failed: ' + (e && e.message || e)); reply(res, 500, {returnValue: false, errorText: 'failed'}); }); }
	if (req.method === 'GET' && icon) { try { return sendIcon(decodeURIComponent(icon[1]), res); } catch (e) { return reply(res, 400, {returnValue: false, errorText: 'bad icon id'}); } }
	if (req.method === 'GET' && GET[path]) return answer(Promise.resolve().then(GET[path]));
	if (req.method === 'POST' && POST[path]) return readBody(req, res, function (params) { answer(Promise.resolve().then(function () { return POST[path](params); })); });
	reply(res, 404, {returnValue: false, errorText: 'unknown method'});
}).on('error', function (e) {
	log('server error: ' + e.message);
	process.exit(e.code === 'EADDRINUSE' ? 0 : 1);      // already running elsewhere: nothing to do
}).listen(PORT, HOST, function () {
	try { fs.writeFileSync('/tmp/launcher-service.pid', String(process.pid)); } catch (e) { /* ignore */ }
	watchKeys();
	watchForeground();
	watchPower();
	configureColorKeys();
	watchScreenSaver();
	bootLaunch(0, 0);
	log('listening on ' + HOST + ':' + PORT + ' (pid ' + process.pid + ')');
});
