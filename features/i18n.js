// French interface for TV Home. The English text in the code stays as it is (so the project is easy to keep in step with
// upstream): what is drawn on screen is translated as it appears. Settings → Interface language picks French or English.
// Nothing here touches the titles and descriptions that come from TMDB, which are already in the chosen language.
(function () {
  var P = window.TV_PROFILE || {}, S = {};
  try { S = JSON.parse(localStorage.getItem((P.prefix || '') + 'settings') || '{}'); } catch (e) { /* defaults */ }
  var LANG = S.uiLang || 'fr';
  window.UI_LANG = LANG;
  window.UI_LOCALE = LANG === 'fr' ? 'fr-FR' : 'en-US';
  if (LANG !== 'fr') return;
  document.documentElement.lang = 'fr';

  var DICT = {
    // top bar, quick settings, boot
    'Getting your shows ready...': 'Préparation de vos programmes...', 'For you': 'Pour vous', 'Live': 'En direct', 'Search': 'Recherche', 'Apps': 'Applications',
    'Open': 'Ouvrir', 'Your apps': 'Vos applications', 'All settings': 'Tous les réglages', 'Quick settings': 'Réglages rapides', 'Settings': 'Réglages',
    'Screensaver': 'Économiseur d’écran', 'Screen off': 'Écran éteint', 'Audio keeps playing': 'Le son continue', 'Accessibility': 'Accessibilité',
    'Audio output': 'Sortie audio', 'Picture': 'Image', 'Sound mode': 'Mode son', 'Brightness': 'Luminosité', 'Inputs': 'Entrées', 'Needs root': 'Nécessite le root',
    'Not connected': 'Non connecté', 'Connected': 'Connecté', 'Home Wi-Fi': 'Wi-Fi maison', 'Muted': 'Muet', 'On': 'Activé', 'Off': 'Désactivé', 'Auto': 'Auto',
    'TV speaker': 'Haut-parleurs TV', 'Bluetooth soundbar': 'Barre de son Bluetooth', 'Optical': 'Optique', 'Headphones': 'Casque', 'TV + external': 'TV + externe',
    'Line out': 'Sortie ligne', 'Close': 'Fermer', 'Clear': 'Effacer', 'Done': 'Terminé', 'Cancel': 'Annuler', 'Save': 'Enregistrer', 'Saved': 'Enregistré', 'Delete': 'Supprimer',
    // picture and sound modes
    'Vivid': 'Vif', 'Standard': 'Standard', 'Eco': 'Éco', 'Cinema': 'Cinéma', 'Sports': 'Sport', 'Game': 'Jeu', 'Filmmaker': 'Filmmaker', 'Music': 'Musique',
    'Clear Voice': 'Voix claire', 'AI Sound Pro': 'AI Sound Pro',
    // rows
    'Top picks for you': 'Sélection pour vous', 'Picked for you': 'Choisis pour vous', 'New on your services': 'Nouveautés sur vos services', 'Top rated on your services': 'Les mieux notés sur vos services',
    'New on your services row': 'Rangée Nouveautés', 'Live TV tab': 'Onglet En direct', 'The Live tab at the top of the home screen': 'L’onglet En direct en haut de l’accueil', 'Profile button': 'Bouton de profil', 'The round button at the top left; profiles stay available in the settings': 'Le bouton rond en haut à gauche ; les profils restent accessibles dans les réglages', 'Show': 'Afficher', 'Hide': 'Masquer', 'Recent releases included in your subscriptions': 'Sorties récentes incluses dans vos abonnements', 'Popular on your services': 'Populaire sur vos services', 'Popular now': 'Populaire en ce moment',
    'Trending today': 'Tendances du jour', 'Trending on YouTube': 'Tendances YouTube', 'Continue watching': 'Reprendre la lecture', 'My watchlist': 'Ma liste',
    'More like this': 'Titres similaires', 'Where to watch': 'Où regarder', 'Edit apps': 'Modifier les applications', 'Move': 'Déplacer', 'Remove from home': 'Retirer de l’accueil',
    'Not on your services': 'Pas sur vos services', 'Trailer': 'Bande-annonce', '＋ Watchlist': '＋ Ma liste', '✓ In watchlist': '✓ Dans ma liste',
    'Movie': 'Film', 'Series': 'Série', 'Rent': 'Location', 'Buy': 'Achat',
    // settings
    'Country': 'Pays', 'Where to look up what’s streaming': 'Où chercher ce qui est disponible en streaming',
    'Interface language': 'Langue de l’interface', 'Menus and messages. The languages of the suggested films are set separately, below': 'Menus et messages. La langue des films proposés se règle séparément, plus bas',
    'Recommendation languages': 'Langues des recommandations', 'Languages of the suggested films and series, not of the menus. Pick any; none = every language': 'Langues des films et séries proposés, pas des menus. Choisissez-en plusieurs ; aucune = toutes',
    'Your streaming services': 'Vos services de streaming', 'Their popular titles show up in the rows below': 'Leurs titres populaires apparaissent dans les rangées ci-dessous',
    'Streaming rows': 'Rangées de streaming', 'Services with similar catalogues (Netflix, Disney+, Canal+...) in one row; Crunchyroll and YouTube keep their own': 'Les services aux catalogues proches (Netflix, Disney+, Canal+...) dans une seule rangée ; Crunchyroll et YouTube gardent la leur',
    'Similar services together': 'Services proches ensemble', 'One row per service': 'Une rangée par service',
    'Trending on YouTube row': 'Rangée Tendances YouTube', 'Rotate featured titles': 'Faire défiler les titres à la une', 'Clock': 'Horloge', '12-hour': '12 heures', '24-hour': '24 heures',
    'App icon shape': 'Forme des icônes', 'A full circle, or a square with rounded corners': 'Un cercle complet, ou un carré aux angles arrondis', 'Circle': 'Cercle', 'Rounded square': 'Carré arrondi',
    'Weather city': 'Ville de la météo', 'Auto finds your city from your internet connection': 'Auto trouve votre ville grâce à votre connexion Internet',
    'Hold OK on an app to move or remove it': 'Maintenez OK sur une application pour la déplacer ou la retirer', 'Show hidden apps': 'Afficher les applications masquées',
    'Clear history': 'Effacer l’historique', 'Ambient mode': 'Mode ambiance', 'Slideshow when idle': 'Diaporama en cas d’inactivité', '2 min': '2 min', '5 min': '5 min', '10 min': '10 min',
    'Ask who’s watching at start': 'Demander qui regarde au démarrage', 'Keyboard layout': 'Disposition du clavier', 'The on-screen keyboard of the search': 'Le clavier à l’écran de la recherche', 'ABC (alphabetical)': 'ABC (alphabétique)',
    // countries and languages
    'India': 'Inde', 'United States': 'États-Unis', 'United Kingdom': 'Royaume-Uni', 'Australia': 'Australie', 'UAE': 'Émirats arabes unis', 'Singapore': 'Singapour', 'Germany': 'Allemagne',
    'Japan': 'Japon', 'South Korea': 'Corée du Sud', 'Brazil': 'Brésil', 'English': 'Anglais', 'French': 'Français', 'Spanish': 'Espagnol', 'Japanese': 'Japonais', 'Korean': 'Coréen',
    'Tamil': 'Tamoul', 'Telugu': 'Télougou', 'Punjabi': 'Pendjabi', 'Gujarati': 'Goudjarati',
    // weather
    'Now': 'Maintenant', 'Today': 'Aujourd’hui', 'Change city': 'Changer de ville', 'Feels like': 'Ressenti',
    'Humidity': 'Humidité', 'Wind': 'Vent', 'Sunrise': 'Lever', 'Sunset': 'Coucher', 'Next 12 hours': '12 prochaines heures', 'Loading weather…': 'Chargement de la météo...',
    'Couldn’t load the weather. Check the connection.': 'Impossible de charger la météo. Vérifiez la connexion.',
    // search
    'Space': 'Espace', 'Search movies & shows': 'Rechercher des films et séries', 'Trending searches': 'Recherches tendance', 'Searching…': 'Recherche...',
    'Search failed, check the connection': 'Échec de la recherche, vérifiez la connexion', 'Search YouTube': 'Rechercher sur YouTube', 'Checking where to watch…': 'Recherche des plateformes...',
    // profiles
    'Who’s watching?': 'Qui regarde ?', 'Add profile': 'Ajouter un profil', 'Edit profiles': 'Modifier les profils', 'Edit profile': 'Modifier le profil', 'Choose a profile to edit': 'Choisissez un profil à modifier',
    'Name': 'Nom', 'Colour': 'Couleur', 'Kids profile': 'Profil enfant', 'Kids': 'Enfants', 'Guest': 'Invité', 'Mom': 'Maman', 'Dad': 'Papa', 'Grandma': 'Mamie', 'Grandpa': 'Papi', 'Friend': 'Ami',
    'Family-friendly titles only; hides Browser, ZEE5, Apps Store and Settings': 'Uniquement des titres tout public ; masque le navigateur, ZEE5, le Store et les réglages',
    // messages
    'Waiting for the internet…': 'En attente d’Internet...', 'Hidden apps are back': 'Les applications masquées sont de retour', 'Continue watching cleared': 'Historique effacé',
    'Edit mode: choose Hide / show or Reorder, then OK on an app': 'Mode édition : choisissez Masquer / afficher ou Réorganiser, puis OK sur une application', 'Hide / show': 'Masquer / afficher', 'Transcribing…': 'Transcription…', 'The speech server is not available': 'Le serveur de reconnaissance n’est pas joignable', 'The microphone is busy': 'Le micro est déjà utilisé', 'The TV service is not available': 'Le service de la télé n’est pas disponible', 'Voice dictation failed': 'La dictée vocale a échoué', 'Voice dictation could not reach Home Assistant': 'La dictée vocale n’a pas pu joindre Home Assistant', 'Listening…': 'Je vous écoute…', 'Microphone not allowed': 'Micro non autorisé', 'Voice dictation is not allowed on this TV': 'La dictée vocale n’est pas autorisée sur cette télé', 'Voice dictation could not reach its service': 'La dictée vocale n’a pas pu joindre son service', 'Nothing heard': 'Rien entendu', 'No microphone available': 'Aucun micro disponible', 'Language not supported for dictation': 'Langue non prise en charge pour la dictée', 'Voice dictation could not start': 'La dictée vocale n’a pas pu démarrer', 'Reorder': 'Réorganiser', 'On the home screen': 'Sur l’accueil', 'Hidden apps': 'Applications masquées', 'No hidden app': 'Aucune application masquée', 'Show it on the home screen first': 'Affichez-la d’abord sur l’accueil', 'Left / right to move, OK when done': 'Gauche / droite pour déplacer, OK pour terminer',
    'Not supported on this TV': 'Non pris en charge sur cette TV', 'Needs the TV Home service (rooted TV)': 'Nécessite le service TV Home (TV rootée)', 'Could not look up where to watch': 'Impossible de chercher où regarder',
    'Could not load details': 'Impossible de charger les détails', 'Added to your watchlist': 'Ajouté à votre liste', 'Removed from your watchlist': 'Retiré de votre liste',
    'Clé TMDB manquante : ajoutez-la dans keys.js': 'Clé TMDB manquante : ajoutez-la dans keys.js'
  };

  // Weather conditions have a dictionary of their own: "Clear" is a different word on the keyboard, "Snow" or "Rain" could be a title.
  var WX = {'Clear': 'Dégagé', 'Mostly clear': 'Plutôt dégagé', 'Partly cloudy': 'Éclaircies', 'Cloudy': 'Couvert', 'Fog': 'Brouillard', 'Light drizzle': 'Bruine faible', 'Drizzle': 'Bruine', 'Heavy drizzle': 'Forte bruine', 'Light rain': 'Pluie faible', 'Rain': 'Pluie', 'Heavy rain': 'Forte pluie', 'Freezing rain': 'Pluie verglaçante', 'Light snow': 'Neige faible', 'Snow': 'Neige', 'Heavy snow': 'Forte neige', 'Snow grains': 'Grains de neige', 'Rain showers': 'Averses', 'Heavy showers': 'Fortes averses', 'Snow showers': 'Averses de neige', 'Thunderstorm': 'Orage', 'Thunderstorm, hail': 'Orage et grêle'};

  function lang(list) { return list.split(', ').map(function (l) { var f = DICT[l]; return (f || l).toLowerCase(); }).join(', '); }
  function ago(s) {
    var m;
    if ((m = /^(\d+) min ago$/.exec(s))) return 'il y a ' + m[1] + ' min';
    if ((m = /^(\d+) hr ago$/.exec(s))) return 'il y a ' + m[1] + ' h';
    if ((m = /^(\d+) days ago$/.exec(s))) return 'il y a ' + m[1] + ' jours';
    return s;
  }
  // sentences with a name, a number or a service inside
  var RULES = [
    [/^✓ (.+)$/, function (m) { return '✓ ' + (DICT[m[1]] || m[1]); }],   // the tick in front of a selected chip
    [/^Popular on (.+)$/, function (m) { return 'Populaire sur ' + m[1]; }],
    [/^Popular in (.+)$/, function (m) { return 'Populaire en ' + lang(m[1]); }],
    [/^New on (.+)$/, function (m) { return 'Nouveautés sur ' + m[1]; }],
    [/^Because you viewed (.*?)((?:  ·  .*)?)$/, function (m) { return 'Parce que vous avez regardé ' + m[1] + inline(m[2]); }],
    [/^Top rated on your services  ·  (.*)$/, function (m) { return 'Les mieux notés sur vos services  ·  ' + inline('  ·  ' + m[1]).replace(/^  ·  /, ''); }],
    [/^On (.+)$/, function (m) { return 'Sur ' + m[1]; }],
    [/^(.*)  ·  opened (.+)$/, function (m) { return m[1] + '  ·  ouvert ' + ago(m[2]); }],
    [/^Next (\d+) days$/, function (m) { return m[1] + ' prochains jours'; }],
    [/^(.*)  ·  H (-?\d+)°  L (-?\d+)°$/, function (m) { return (WX[m[1]] || m[1]) + '  ·  Max ' + m[2] + '°  Min ' + m[3] + '°'; }],
    [/^Cast: (.+)$/, function (m) { return 'Distribution : ' + m[1]; }],
    [/^Rent or buy: (.+)$/, function (m) { return 'Location ou achat : ' + m[1]; }],
    [/^Rent: (.+)$/, function (m) { return 'Location : ' + m[1]; }],
    [/^Buy: (.+)$/, function (m) { return 'Achat : ' + m[1]; }],
    [/^No streaming info for (.+)$/, function (m) { return 'Aucune information de streaming pour ' + m[1]; }],
    [/^Not streaming in (.+)$/, function (m) { return 'Pas en streaming en ' + m[1]; }],
    [/^▶ Watch on (.+)$/, function (m) { return '▶ Regarder sur ' + m[1]; }],
    [/^Search YouTube for “(.*)”$/, function (m) { return 'Rechercher sur YouTube “' + m[1] + '”'; }],
    [/^Results for “(.*)”$/, function (m) { return 'Résultats pour “' + m[1] + '”'; }],
    [/^No results for “(.*)”$/, function (m) { return 'Aucun résultat pour “' + m[1] + '”'; }],
    [/^“(.*)” isn’t on your services in (\w+)$/, function (m) { return '“' + m[1] + '” n’est pas sur vos services en ' + m[2]; }],
    [/^Could not open (.*)$/, function (m) { return 'Impossible d’ouvrir ' + m[1]; }],
    [/^Would open (.*)$/, function (m) { return 'Ouvrirait ' + m[1]; }],
    [/^Volume: (.*)$/, function (m) { return 'Volume : ' + m[1]; }],
    [/^(.*) hidden from the home screen$/, function (m) { return m[1] + ' masquée de l’accueil'; }],
    [/^(.*) shown on the home screen$/, function (m) { return m[1] + ' affichée sur l’accueil'; }],
    [/^(.*) removed\. Settings → Show hidden apps brings it back$/, function (m) { return m[1] + ' retiré. Réglages → Afficher les applications masquées pour le récupérer'; }]
  ];
  // words inside longer lines such as "Netflix  ·  2015  ·  Series  ·  ★ 8.1", "2h 5m", "1 season", "1.2M views"
  function inline(s) {
    return s.replace(/(^|  ·  )Movie(?=  ·  |$)/g, '$1Film').replace(/(^|  ·  )Series(?=  ·  |$)/g, '$1Série')
      .replace(/(\d+)h (\d+)m(?=  ·  |$)/, '$1 h $2 min').replace(/^(\d+) seasons?$/, function (m, n) { return n + (n > 1 ? ' saisons' : ' saison'); })
      .replace(/  ·  (\d[\d.]*[MK]) views$/, '  ·  $1 vues').replace(/(^|  ·  )(\d+) seasons?(?=  ·  |$)/g, function (m, p, n) { return p + n + (n > 1 ? ' saisons' : ' saison'); });
  }

  function tr(text) {
    var m = /^(\s*)([\s\S]*?)(\s*)$/.exec(text), core = m[2], out;
    if (!core || core.length > 220) return text;
    if (Object.prototype.hasOwnProperty.call(DICT, core)) out = DICT[core];
    else {
      for (var i = 0; i < RULES.length && out === undefined; i++) { var r = RULES[i][0].exec(core); if (r) out = RULES[i][1](r); }
      if (out === undefined) { out = inline(core); if (out === core) return text; }
    }
    return m[1] + out + m[3];
  }

  // Titles and descriptions of films are content, not interface: never touched.
  var SKIP = '.ttl, .dbody h1, .dsub, .pcard:not(:has(.padd)) b, #wxpanel .wxcity';
  function skipped(el) { return el.matches && el.matches(SKIP); }
  function walk(node) {
    if (node.nodeType === 3) { var t = tr(node.nodeValue); if (t !== node.nodeValue) node.nodeValue = t; return; }
    if (node.nodeType !== 1 || node.nodeName === 'SCRIPT' || node.nodeName === 'STYLE' || skipped(node)) return;
    var title = node.getAttribute && node.getAttribute('title');
    if (title) { var tt = tr(title); if (tt !== title) node.setAttribute('title', tt); }
    for (var c = node.firstChild; c; c = c.nextSibling) walk(c);
  }

  function start() {
    walk(document.body);
    new MutationObserver(function (list) {
      list.forEach(function (mu) {
        if (mu.type === 'characterData') { var p = mu.target.parentNode; if (p && !(p.matches && p.closest && p.closest(SKIP))) walk(mu.target); }
        else if (mu.type === 'attributes') walk(mu.target);
        else mu.addedNodes.forEach(function (n) { if (!(n.nodeType === 1 && n.parentNode && n.parentNode.closest && n.parentNode.closest(SKIP))) walk(n); });
      });
    }).observe(document.body, {childList: true, subtree: true, characterData: true, attributes: true, attributeFilter: ['title']});
  }
  if (document.body) start(); else document.addEventListener('DOMContentLoaded', start);
})();
