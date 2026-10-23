#!/bin/sh
# Profile B: boot straight into TV Home. Points the TV's "last input" at TV Home and turns Home Auto Launch off, so LG's home is never
# shown at power-on (trade-off: LG's boot animation no longer plays). The original values are saved once in
# /var/lib/webosbrew/tvhome-settings.before. Only settings are written: no file, no restart of the app manager.
# Undo: sh boot-off.sh
B=/var/lib/webosbrew/tvhome-settings.before
if [ ! -f "$B" ]; then
  luna-send -n 1 -f luna://com.webos.settingsservice/getSystemSettings '{"category":"general","keys":["lastInputApp","physicalLastInputApp","homeAutoLaunch"]}' </dev/null >/tmp/tvhome-orig.json 2>&1
  L=$(grep -o '"lastInputApp": *"[^"]*"' /tmp/tvhome-orig.json | sed 's/.*: *"//;s/"//')
  P=$(grep -o '"physicalLastInputApp": *"[^"]*"' /tmp/tvhome-orig.json | sed 's/.*: *"//;s/"//')
  A=$(grep -o '"homeAutoLaunch": *"[^"]*"' /tmp/tvhome-orig.json | sed 's/.*: *"//;s/"//')
  [ -n "$L" ] && [ -n "$P" ] && [ -n "$A" ] || { echo "could not read the current settings, nothing changed"; exit 1; }
  echo "LAST=$L PHYS=$P AUTO=$A" >"$B"
fi
luna-send -n 1 -f luna://com.webos.settingsservice/setSystemSettings '{"category":"general","settings":{"lastInputApp":"com.boring.tvhome","physicalLastInputApp":"com.boring.tvhome","homeAutoLaunch":"off"}}' </dev/null
