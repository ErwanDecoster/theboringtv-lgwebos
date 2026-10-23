#!/bin/sh
# Run by the Homebrew Channel at every boot: puts TV Home in place of LG's home, WITHOUT changing the TV's boot settings
# (last input, Home Auto Launch). Undo: sh /media/developer/tv-home-tools/undo.sh
TVHOME_SKIP_SETTINGS=1 exec sh /media/developer/tv-home-tools/as-home.sh
