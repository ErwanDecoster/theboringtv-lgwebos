#!/bin/sh
# Makes webOS open TV Home wherever it would open LG's home (Home button, Back from apps, startup).
# Runs early at boot from the Homebrew Channel startup folder (/var/lib/webosbrew/init.d/).
# It copies the installed TV Home into RAM, gives the copy LG home's app id, and bind-mounts it over
# LG's home folder. Nothing on disk is changed: to undo, remove the init.d link and restart the TV.
SRC=/media/developer/apps/usr/palm/applications/com.boring.tvhome
DST=/usr/palm/applications/com.webos.app.home
TMP=/tmp/tvhome-as-home
LOG=/tmp/tvhome-as-home.log

[ -f "$SRC/index.html" ] || { echo "TV Home not installed, leaving LG home alone" >"$LOG"; exit 0; }
grep -q " $DST " /proc/mounts && { echo "already mounted" >"$LOG"; exit 0; }

rm -rf "$TMP" && mkdir -p "$TMP" && cp -a "$SRC/." "$TMP/" || exit 0
HIDE='s/"main": *"index.html",/&\n  "visible": false,/' # keep it out of the app list, like LG's home
sed -i 's/"id": *"com.boring.tvhome"/"id": "com.webos.app.home"/; s/"title": *"TV Home"/"title": "Home"/' "$TMP/appinfo.json"
sed -i "$HIDE" "$TMP/appinfo.json"
grep -q '"com.webos.app.home"' "$TMP/appinfo.json" || { echo "appinfo rewrite failed" >"$LOG"; exit 0; }
mount --bind "$TMP" "$DST" && echo "mounted TV Home over $DST" >"$LOG" || exit 0

# Hide the regular TV Home app too, so the app list doesn't show a second TV Home (RAM-only, like the above).
sed "$HIDE" "$SRC/appinfo.json" >/tmp/tvhome-regular-appinfo.json &&
  mount --bind /tmp/tvhome-regular-appinfo.json "$SRC/appinfo.json" && echo "hid regular TV Home" >>"$LOG"

# The app manager (sam) read the app list before this ran and still thinks home is LG's Flutter app.
# Restart it so it re-reads com.webos.app.home from the mount (systemd brings it straight back).
systemctl restart sam >>"$LOG" 2>&1 && echo "restarted sam" >>"$LOG"

# The TV starts on its last input (often Live TV, which shows a no-signal screen without an antenna).
# Open the home app (now TV Home) once the app manager is up; retries for ~90s in the background.
(
  i=0
  while [ $i -lt 45 ]; do
    if luna-send -n 1 -w 3000 luna://com.webos.applicationManager/launch '{"id":"com.webos.app.home"}' 2>/dev/null | grep -q '"returnValue": *true'; then
      echo "boot launch ok after $i tries" >>"$LOG"; break
    fi
    i=$((i + 1)); sleep 2
  done
) </dev/null >/dev/null 2>&1 &
exit 0
