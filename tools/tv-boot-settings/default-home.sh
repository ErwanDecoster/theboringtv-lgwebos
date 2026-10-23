#!/bin/sh
# Makes TV Home the app the Home key opens (webOS 25: sam keeps the home app in the "defaultApps" setting), with no restart of the app manager.
# Run on the TV:  sh default-home.sh on      (TV Home)
#                 sh default-home.sh off     (back to LG's home)
# TV Home's appinfo.json must declare "appCategory": ["home"], or sam stores the setting and then fails every Home press.
# Over ssh luna-send prints nothing when its stdin is a pipe: keep the </dev/null.
case "$1" in
  on)  APP=com.boring.tvhome ;;
  off) APP=com.webos.app.home ;;
  *) echo "usage: sh default-home.sh on|off" >&2; exit 1 ;;
esac
luna-send -n 1 -f luna://com.webos.service.applicationmanager/setDefaultApp "{\"category\":\"home\",\"appId\":\"$APP\"}" </dev/null
