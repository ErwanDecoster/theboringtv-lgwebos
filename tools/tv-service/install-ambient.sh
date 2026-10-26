#!/bin/sh
# Installs the light idle screen (../../ambient, app com.boring.tvhome.ambient) on a rooted TV. It is a second, tiny app: a window of LG's "screenSaver" kind
# that the helper service puts over whatever app is in front, instead of starting the whole of TV Home there (see the README: "LG's screensaver, replaced").
# Needs the webOS CLI (ares-package) on this computer, and TV_HOST (an ssh alias or root@<tv-ip>). Nothing is launched.
set -e
cd "$(dirname "$0")/../.."
[ -n "$TV_HOST" ] || { echo "TV_HOST is not set (e.g. TV_HOST=root@192.168.1.50)" >&2; exit 1; }
OUT=$(mktemp -d)
ares-package ambient -o "$OUT" --no-minify | tail -1
scp -q "$OUT"/com.boring.tvhome.ambient_*_all.ipk "$TV_HOST:/tmp/tvhome-ambient.ipk"
ssh -tt "$TV_HOST" "luna-send -w 90000 -i luna://com.webos.appInstallService/dev/install '{\"id\":\"com.ares.defaultName\",\"ipkUrl\":\"/tmp/tvhome-ambient.ipk\",\"subscribe\":true}' | grep -oE '\"state\":\"installed\"|install failed' | uniq; rm -f /tmp/tvhome-ambient.ipk" | tr -d '\r'
rm -rf "$OUT"
