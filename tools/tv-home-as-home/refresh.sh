#!/bin/sh
# After installing a new TV Home: update the RAM copy that stands in for LG's home, IN PLACE.
# It must not restart the app manager (sam): doing so while the TV is on makes the TV forget its soundbar's ARC link
# (the volume keys then show a "forbidden" sign until a cold start). The home app is a web app: new files are picked up by reopening it.
SRC=/media/developer/apps/usr/palm/applications/com.boring.tvhome
TMP=/tmp/tvhome-as-home
DST=/usr/palm/applications/com.webos.app.home
grep -q " $DST " /proc/mounts || { echo "TV Home is not the home app: nothing to refresh"; exit 0; }
[ -f "$SRC/index.html" ] || { echo "TV Home is not installed"; exit 1; }
umount "$SRC/appinfo.json" 2>/dev/null                       # the real appinfo must be readable
cp -a "$SRC/." "$TMP/" || exit 1
HIDE='s/"main": *"index.html",/&\n  "visible": false,/'
sed -i 's/"id": *"com.boring.tvhome"/"id": "com.webos.app.home"/; s/"title": *"TV Home"/"title": "Home"/' "$TMP/appinfo.json"
sed -i "$HIDE" "$TMP/appinfo.json"
grep -q '"com.webos.app.home"' "$TMP/appinfo.json" || { echo "appinfo rewrite failed"; exit 1; }
sed "$HIDE" "$SRC/appinfo.json" >/tmp/tvhome-regular-appinfo.json && mount --bind /tmp/tvhome-regular-appinfo.json "$SRC/appinfo.json"   # hide the regular copy again
echo "TV Home refreshed in place"
