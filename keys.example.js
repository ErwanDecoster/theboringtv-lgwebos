// Copy to keys.js and fill in. Both are free:
//   TMDB:    https://www.themoviedb.org/settings/api  (v3 API key)
//   YouTube: https://console.cloud.google.com -> enable YouTube Data API v3 -> API key
// keys.js is git-ignored: never commit it, and never serve this folder on your network (see README: Setup).
window.KEYS = {
  TMDB_KEY: '',
  YT_KEY: ''
  // Your own defaults, so nothing personal lives in the code: NAME: 'M' (avatar letter), WEATHER_CITY: 'Lyon' (a city of Settings → Weather city, or 'auto')

  // Optional, for the extras described in the README:
  // Home Assistant: the washing machine pill and (without STT_URL) voice dictation through an Assist pipeline.
  // , HA_URL: 'http://homeassistant.local:8123'
  // , HA_TOKEN: ''                                   // a long-lived access token (HA profile page)
  // , HA_PERSONS: {'person.alex': 'Alex', 'person.sam': 'Sam'}   // the profile follows who is home at power-on (name of a TV Home profile)
  // , HA_WASHER: {status: 'sensor.washer_machine_state', end: 'sensor.washer_completion_time', total: 'sensor.washer_total_time'}
  // , HA_STT_PIPELINE: 'Anna'                         // name of the Assist pipeline that has a speech-to-text engine
  // Trakt (optional, a watch history shared with your phone): create an app at https://trakt.tv/oauth/applications, redirect URI http://localhost (never used: sign-in is by code).
  // Only the Client ID is needed (Trakt no longer issues a secret to new apps; an older app may add TRAKT_SECRET).
  // , TRAKT_ID: ''
  // Your own speech server on the home network (preferred for dictation): POST <STT_URL>/transcribe?lang=fr with the raw audio
  // (16 kHz, 16 bit, mono) and "Authorization: Bearer <STT_TOKEN>"; it answers {"text": "..."}.
  // , STT_URL: 'http://192.168.1.20:10400'
  // , STT_TOKEN: ''
};
