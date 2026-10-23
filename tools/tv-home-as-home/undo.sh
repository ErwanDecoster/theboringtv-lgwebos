#!/bin/sh
# Puts the TV back as it was: LG's own home, LG's boot animation and the last input it remembered before TV Home took over.
# Run on the TV (or: ssh root@<tv-ip> sh /media/developer/tv-home-tools/undo.sh). Idempotent; ends by restarting the app manager.
rm -f /var/lib/webosbrew/init.d/40-tvhome-as-home
umount /usr/palm/applications/com.webos.app.home 2>/dev/null
umount /media/developer/apps/usr/palm/applications/com.boring.tvhome/appinfo.json 2>/dev/null
rm -rf /tmp/tvhome-as-home /tmp/tvhome-regular-appinfo.json
B=/var/lib/webosbrew/tvhome-settings.before
if [ -f "$B" ]; then
  . "$B"
  luna-send -n 1 luna://com.webos.settingsservice/setSystemSettings "{\"category\":\"general\",\"settings\":{\"lastInputApp\":\"$LAST\",\"physicalLastInputApp\":\"$PHYS\",\"homeAutoLaunch\":\"$AUTO\"}}" >/dev/null 2>&1
fi
systemctl restart sam
echo "TV Home is no longer the home app; LG's home is back."
