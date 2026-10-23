window.CONFIG = {
  TMDB_KEY: (window.KEYS || {}).TMDB_KEY,  // keys live in keys.js (not committed)
  YT_KEY: (window.KEYS || {}).YT_KEY,
  REGION: 'FR',
  LANG: 'fr-FR',
  NAME: 'N',
  // Services the app knows. `on` = shown as a "Popular on …" row by default (changeable in Settings). `match` = TMDB provider name; `app` = webOS app id; `jw` = JustWatch package code.
  SERVICES: [
    {name: 'Netflix', match: 'netflix', app: 'netflix', jw: 'nfx', on: true},
    {name: 'Prime Video', match: 'amazon prime video', app: 'amazon', jw: 'prv', on: true},
    {name: 'Disney+', match: 'disney plus', app: 'com.disney.disneyplus-prod', jw: 'dnp', on: true},
    {name: 'Apple TV+', match: 'apple tv', app: 'com.apple.appletv', jw: 'atp'},
    {name: 'Canal+', match: 'canal+', app: 'canalplus', jw: 'cpl'},
    // `merge: false` keeps a service out of the shared "Popular on your services" row, for catalogues that have nothing in common with the others
    {name: 'Crunchyroll', match: 'crunchyroll', app: 'com.crunchyroll.webapp', jw: 'cru', merge: false}
  ],
  // App row. The TV won't list installed apps for non-system apps, so each of these
  // is checked with getAppLoadStatus and only the ones that exist are shown.
  APPS: [
    {id: 'youtube.leanback.v4', title: 'YouTube', icon: 'youtube.svg', color: '#fff'},
    {id: 'netflix', title: 'Netflix', icon: 'netflix.png', color: '#000'},
    {id: 'amazon', title: 'Prime Video', icon: 'prime.png', color: '#00a8e1'},
    {id: 'com.disney.disneyplus-prod', title: 'Disney+', icon: 'disney.png', color: '#0b3a4a'},
    {id: 'canalplus', title: 'CANAL+', color: '#000'},
    {id: 'com.apple.appletv', title: 'Apple TV', icon: 'appletv.png', color: '#000'},
    {id: 'spotify-beehive', title: 'Spotify', icon: 'spotify.png', color: '#121212'},
    {id: 'com.apple.applemusic', title: 'Apple Music', color: '#fa243c'},
    {id: 'fr.tf1.mytf1', title: 'TF1+', color: '#1b3dff'},
    {id: '6play', title: 'M6+', color: '#000'},
    {id: 'com.dotscreen.france-tv-smart-tv', title: 'france.tv', color: '#1d2230'},
    {id: 'com.3827031.168353', title: 'ARTE', color: '#fa4a1b'},
    {id: 'com.crunchyroll.webapp', title: 'Crunchyroll', color: '#f47521'},
    {id: 'tv.twitch.tv.starshot.lg', title: 'Twitch', icon: 'twitch.jpg', color: '#9146ff'},
    {id: 'com.webos.app.livetv', title: 'TV en direct', color: '#d93025'},
    {id: 'com.webos.app.hdmi1', title: 'HDMI 1', color: '#3c4043'},
    {id: 'com.webos.app.hdmi2', title: 'HDMI 2', color: '#3c4043'},
    {id: 'com.webos.app.hdmi3', title: 'HDMI 3', color: '#3c4043'},
    {id: 'com.webos.app.hdmi4', title: 'HDMI 4', color: '#3c4043'},
    {id: 'com.webos.app.browser', title: 'Navigateur', color: '#1a73e8'},
    {id: 'com.palm.app.settings', title: 'Réglages', icon: 'settings.png', color: '#5f6368'}
  ]
};
