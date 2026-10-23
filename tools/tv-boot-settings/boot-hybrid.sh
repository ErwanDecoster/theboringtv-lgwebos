#!/bin/sh
# Profile C: last input = TV Home (waking from standby lands on TV Home) but Home Auto Launch stays on (a full boot shows LG's home,
# with its boot animation, instead of a black screen until the Homebrew Channel starts the service). Needs boot-on.sh to have run once
# so that the original values are saved. Undo: sh boot-off.sh
luna-send -n 1 -f luna://com.webos.settingsservice/setSystemSettings '{"category":"general","settings":{"lastInputApp":"com.boring.tvhome","physicalLastInputApp":"com.boring.tvhome","homeAutoLaunch":"on"}}' </dev/null
