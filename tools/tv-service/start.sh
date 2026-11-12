#!/bin/sh
# Starts TV Home's helper service (app list and icons, input names, the TV's microphone). The Homebrew Channel runs it at every boot
# when it is linked into /var/lib/webosbrew/init.d/ (see install.sh). Returns at once so boot is never held up.
# Undo: remove that link and stop the process (kill $(cat /tmp/launcher-service.pid)), then delete /media/developer/tv-service.
DIR=/media/developer/tv-service
# The Homebrew Channel clears its failsafe flag only after every init.d script has returned. One hook that hangs (a luna-send with
# no reply) leaves the flag set, and the next boot, e.g. after a nightly power cut, runs without sshd or this service. Clear it ourselves.
setsid sh -c 'sleep 30; rm -f /var/luna/preferences/webosbrew_failsafe; sync -f /var/luna/preferences' >/dev/null 2>&1 </dev/null &
[ -f "$DIR/tv-service.js" ] || exit 0
if [ -f /tmp/launcher-service.pid ] && kill -0 "$(cat /tmp/launcher-service.pid)" 2>/dev/null; then exit 0; fi
setsid nohup /usr/bin/node "$DIR/tv-service.js" >/dev/null 2>&1 </dev/null &
exit 0
