#!/usr/bin/env node
// Turns the viewing history you download from a streaming service into a file TV Home reads once: titles you already saw are then never suggested.
//   node tools/import-viewing-activity.mjs ~/Downloads/NetflixViewingHistory.csv
// Netflix: Account → Profile → Viewing activity → "Download all" (a CSV with "Title","Date"). Any CSV whose first column is a title works.
// Titles are matched with TMDB (key from keys.js, which is never printed). Result: seen-import.js next to index.html (git-ignored).
// Put it on the TV with the app (ares-package includes it); it is read once, by the profile that is open at the next start.
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import crypto from 'node:crypto';
import {fileURLToPath} from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const file = process.argv[2];
if (!file) { console.error('usage: node tools/import-viewing-activity.mjs <history.csv> [language, default fr-FR]'); process.exit(1); }
const lang = process.argv[3] || 'fr-FR';
const sandbox = {window: {}};
vm.runInNewContext(fs.readFileSync(path.join(root, 'keys.js'), 'utf8'), sandbox);
const KEY = sandbox.window.KEYS && sandbox.window.KEYS.TMDB_KEY;
if (!KEY) { console.error('TMDB_KEY is missing in keys.js'); process.exit(1); }

// minimal CSV reader: quoted fields, doubled quotes, commas and newlines inside quotes
function parse(text) {
  const rows = []; let row = [], cell = '', q = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (q) { if (c === '"') { if (text[i + 1] === '"') { cell += '"'; i++; } else q = false; } else cell += c; }
    else if (c === '"') q = true;
    else if (c === ',') { row.push(cell); cell = ''; }
    else if (c === '\n' || c === '\r') { if (c === '\r' && text[i + 1] === '\n') i++; row.push(cell); rows.push(row); row = []; cell = ''; }
    else cell += c;
  }
  if (cell || row.length) { row.push(cell); rows.push(row); }
  return rows;
}
const rows = parse(fs.readFileSync(file, 'utf8')).filter((r) => r[0] && r[0].trim());
if (/^title$/i.test(rows[0][0].trim())) rows.shift();

// "Show: Season 2: Episode title" → the show. A movie keeps its whole title ("Mission: Impossible").
const entries = new Map();   // title → latest date
for (const r of rows) {
  const t = r[0].trim(), d = Date.parse(r[1]) || Date.now();
  entries.set(t, Math.max(entries.get(t) || 0, d));
}
const norm = (s) => s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, ' ').trim();
const cache = new Map();
async function search(kind, q) {
  const k = kind + '|' + q;
  if (!cache.has(k)) {
    const url = `https://api.themoviedb.org/3/search/${kind}?api_key=${KEY}&language=${lang}&query=${encodeURIComponent(q)}`;
    for (let n = 0; n < 3; n++) {
      const res = await fetch(url);
      if (res.status === 429) { await new Promise((ok) => setTimeout(ok, 1500)); continue; }
      cache.set(k, res.ok ? (await res.json()).results || [] : []); break;
    }
    if (!cache.has(k)) cache.set(k, []);
  }
  return cache.get(k);
}
// several films can share a title: the best known one (most votes) is the likely match
const exact = (list, name) => list.filter((m) => [m.title, m.name, m.original_title, m.original_name].some((x) => x && norm(x) === norm(name)))
  .sort((a, b) => (b.vote_count || 0) - (a.vote_count || 0))[0];

const found = new Map(), missed = [];
for (const [title, at] of entries) {
  const parts = title.split(': ');
  let hit = null;
  const m = exact(await search('movie', title), title);
  if (m) hit = ['movie:' + m.id, m.title];
  else if (parts.length > 1) {
    // an episode line: the show is the part before ": Season …" / ": Saison …" / ": Limited Series", else before the first ": "
    const si = parts.findIndex((p, i) => i > 0 && /^(season|saison|limited series|série limitée|part|partie|chapter|chapitre|volume)\b/i.test(p));
    const show = parts.slice(0, si > 0 ? si : 1).join(': ');
    const t = exact(await search('tv', show), show);
    if (t) hit = ['tv:' + t.id, t.name];
  } else {
    const t = exact(await search('tv', title), title);
    if (t) hit = ['tv:' + t.id, t.name];
  }
  if (hit) found.set(hit[0], Math.max(found.get(hit[0]) || 0, at)); else missed.push(title);
}
const items = [...found.entries()].sort((a, b) => b[1] - a[1]);
const id = crypto.createHash('sha1').update(JSON.stringify(items)).digest('hex').slice(0, 12);
fs.writeFileSync(path.join(root, 'seen-import.js'), '// made by tools/import-viewing-activity.mjs: read once by TV Home, never commit\nwindow.SEEN_IMPORT = ' + JSON.stringify({id, items}) + ';\n');
console.log(`${entries.size} lines read, ${items.length} titles matched, ${missed.length} not found → seen-import.js`);
if (missed.length) console.log('Not found (no match on TMDB):\n  ' + missed.slice(0, 40).join('\n  ') + (missed.length > 40 ? `\n  … and ${missed.length - 40} more` : ''));
