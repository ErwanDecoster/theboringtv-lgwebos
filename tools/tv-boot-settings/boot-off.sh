#!/bin/sh
# Back to profile A: LG's own boot (animation, then LG home for a few seconds before the service opens TV Home).
B=/var/lib/webosbrew/tvhome-settings.before
[ -f "$B" ] || { echo "no saved settings, nothing changed"; exit 1; }
. "$B"
luna-send -n 1 -f luna://com.webos.settingsservice/setSystemSettings "{\"category\":\"general\",\"settings\":{\"lastInputApp\":\"$LAST\",\"physicalLastInputApp\":\"$PHYS\",\"homeAutoLaunch\":\"$AUTO\"}}" </dev/null
