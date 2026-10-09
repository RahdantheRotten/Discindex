// Talks to the Discogs API and turns Discogs data into Discindex items.
import { loadSettings } from "./store.js";

const API = "https://api.discogs.com";
const sleep = ms => new Promise(r => setTimeout(r, ms));

// Discogs allows about 60 requests a minute. Space every request out so we never hit the limit,
// even when many items are looked up in a row (e.g. importing packages).
let nextSlot = 0;
async function waitTurn() {
  const now = Date.now(), slot = Math.max(now, nextSlot);
  nextSlot = slot + 1100;
  if (slot > now) await sleep(slot - now);
}

async function call(path, params = {}) {
  const { token } = loadSettings();
  if (!token) throw new Error("Add your Discogs token in Settings first.");
  const url = new URL(API + path);
  for (const [k, v] of Object.entries(params)) if (v !== undefined && v !== "") url.searchParams.set(k, v);
  for (let attempt = 0; attempt < 4; attempt++) {
    await waitTurn();
    let res;
    try {
      res = await fetch(url, { headers: { Authorization: `Discogs token=${token}` } });
    } catch {
      // When Discogs blocks for going too fast, the browser only reports a network error: wait and retry
      await sleep(10000 * (attempt + 1));
      continue;
    }
    if (res.status === 429) { await sleep(10000 * (attempt + 1)); continue; }  // too many requests: wait and retry
    if (res.status === 401) throw new Error("Discogs didn't accept your token. Check it in Settings.");
    if (res.status === 404) throw new Error("Discogs couldn't find that.");
    if (!res.ok) throw new Error(`Discogs error (${res.status}). Try again in a moment.`);
    return res.json();
  }
  throw new Error("Discogs is busy right now. Try again in a minute.");
}

export const getRelease = id => call(`/releases/${id}`);

export const searchBarcode = code =>
  call("/database/search", { barcode: code, type: "release", per_page: 50 }).then(r => r.results);

export const searchText = q =>
  call("/database/search", { q, type: "release", format: "CD", per_page: 50 }).then(r => r.results);

export const searchCatno = catno =>
  call("/database/search", { catno, type: "release", per_page: 50 }).then(r => r.results);

export const masterVersions = id =>
  call(`/masters/${id}/versions`, { format: "CD", per_page: 100 }).then(r => r.versions);

export const getMaster = id => call(`/masters/${id}`);

export const collectionPage = (user, page) =>
  call(`/users/${encodeURIComponent(user)}/collection/folders/0/releases`,
    { per_page: 100, page, sort: "added", sort_order: "desc" });

// "https://www.discogs.com/release/123-Name" -> { kind: "release", id: 123 }
export function parseUrl(text) {
  const m = text.match(/discogs\.com\/(?:[a-z]{2}\/)?(?:[^/\s]+\/)?(release|master)\/(\d+)/i);
  return m ? { kind: m[1].toLowerCase(), id: +m[2] } : null;
}

// ---- turning Discogs data into a Discindex item ----

export const clean = name => (name || "").replace(/\s*\(\d+\)$/, "").trim();   // "Artist (2)" -> "Artist"

export function artistNames(list) {
  let s = "";
  for (const a of list || []) {
    s += clean(a.anv || a.name);
    if (a.join) s += a.join === "," ? ", " : ` ${a.join} `;
  }
  return s.trim().replace(/,$/, "");
}

export function toSecs(d) {
  if (!d) return 0;
  return d.split(":").filter(x => /^\d+$/.test(x)).reduce((n, p) => n * 60 + +p, 0);
}

export function formatText(formats) {
  return (formats || []).map(f => [((f.qty && f.qty !== "1") ? `${f.qty}×` : "") + f.name, ...(f.descriptions || [])].join(", ")).join("; ");
}

export function releaseToItem(r, extra = {}) {
  const tracks = [];
  const add = (t, type) => tracks.push({ type, pos: t.position || "", title: t.title || "",
    dur: t.duration || "", secs: toSecs(t.duration), artist: artistNames(t.artists) });
  for (const t of r.tracklist || []) {
    if (t.type_ === "index") (t.sub_tracks || []).forEach(st => add(st, "track"));
    else add(t, t.type_ === "heading" ? "heading" : "track");
  }
  const real = tracks.filter(t => t.type === "track");
  const label = (r.labels || [])[0] || {};
  const primary = (r.images || []).find(i => i.type === "primary") || (r.images || [])[0];
  return {
    key: extra.key || `${r.id}-${Date.now()}`,
    id: r.id,
    master_id: r.master_id || null,
    title: r.title,
    artist: artistNames(r.artists),
    year: r.year || null,
    genres: r.genres || [],
    styles: r.styles || [],
    label: clean(label.name),
    catno: label.catno || "",
    country: r.country || "",
    format: formatText(r.formats),
    barcode: ((r.identifiers || []).find(i => i.type === "Barcode") || {}).value || "",
    cover: primary?.uri || extra.cover || "",
    thumb: extra.thumb || primary?.uri150 || primary?.uri || "",
    url: r.uri || `https://www.discogs.com/release/${r.id}`,
    tracks,
    secs: real.length && real.every(t => t.secs) ? real.reduce((n, t) => n + t.secs, 0) : 0,
    added: extra.added || new Date().toISOString(),
  };
}

// Search results and master versions look different; make them the same shape for the version picker.
export function toVersion(v) {
  return {
    id: v.id,
    title: v.title || "",
    year: v.year || (v.released || "").slice(0, 4) || "",
    country: v.country || "",
    label: Array.isArray(v.label) ? clean(v.label[0]) : clean(v.label),
    catno: v.catno || "",
    format: Array.isArray(v.format) ? v.format.join(", ")
      : [...(v.major_formats || []), v.format].filter(Boolean).join(", "),
    thumb: v.thumb || v.cover_image || "",
    master_id: v.master_id || null,
  };
}
