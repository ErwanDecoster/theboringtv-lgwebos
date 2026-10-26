#!/bin/sh
# Puts a Home Assistant webhook id into the helper's events.json on the TV, without the id ever being typed on a command line or shown.
#   TV_HOST=root@192.168.1.50 tools/tv-service/set-webhook.sh heartbeatWebhook      (or keysWebhook, or webhook)
# Home Assistant makes a random id when you add a webhook trigger to an automation: copy it, run this, paste it (nothing is echoed).
# The URL keeps the host and port of the existing "webhook" entry. The helper reads the file at start: restart it afterwards:
#   ssh "$TV_HOST" 'kill $(cat /tmp/launcher-service.pid); sleep 1; rm -f /tmp/launcher-service.pid; sh /media/developer/tv-service/start.sh'
set -e
KEY=${1:?usage: set-webhook.sh webhook|keysWebhook|heartbeatWebhook}
case "$KEY" in webhook|keysWebhook|heartbeatWebhook) ;; *) echo "unknown entry: $KEY" >&2; exit 1 ;; esac
[ -n "$TV_HOST" ] || [ -n "$EVENTS_FILE" ] || { echo "TV_HOST is not set (e.g. TV_HOST=root@192.168.1.50)" >&2; exit 1; }
printf 'Webhook id for %s (hidden): ' "$KEY" >&2
stty -echo 2>/dev/null || true; read -r ID; stty echo 2>/dev/null || true; echo >&2
case "$ID" in ''|*[!A-Za-z0-9_-]*) echo "an id is letters, digits, - and _ only" >&2; exit 1 ;; esac
PY='import json, re, sys
p, key = sys.argv[1], sys.argv[2]
c = json.load(open(p))
m = re.match(r"^(https?://[^/]+)/api/webhook/", c.get("webhook", ""))
if not m: sys.exit("the existing webhook URL has an unexpected shape")
c[key] = m.group(1) + "/api/webhook/" + sys.stdin.read().strip()
json.dump(c, open(p, "w"), indent=2)
print(key + " set in " + p)'
if [ -n "$EVENTS_FILE" ]; then printf '%s' "$ID" | python3 -c "$PY" "$EVENTS_FILE" "$KEY"
else printf '%s' "$ID" | ssh "$TV_HOST" "python3 -c '$PY' /media/developer/tv-service/events.json $KEY"; fi
