#!/bin/sh
# Installs the helper service on a rooted TV, outside of any app, and makes it start at boot. Needs TV_HOST (an ssh alias or root@<tv-ip>).
set -e
cd "$(dirname "$0")"
[ -n "$TV_HOST" ] || { echo "TV_HOST is not set (e.g. TV_HOST=root@192.168.1.50)" >&2; exit 1; }
DEST=/media/developer/tv-service
ssh "$TV_HOST" "mkdir -p $DEST"
scp -q tv-service.js start.sh "$TV_HOST:$DEST/"
ssh "$TV_HOST" "
	[ -f /tmp/launcher-service.pid ] && kill \$(cat /tmp/launcher-service.pid) 2>/dev/null
	rm -f /tmp/launcher-service.pid
	ln -sf $DEST/start.sh /var/lib/webosbrew/init.d/20-launcher-service
	sh $DEST/start.sh
	sleep 2
	curl -s -m 5 http://127.0.0.1:45621/status && echo
"
