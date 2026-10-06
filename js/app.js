// Discindex: main app. Pages are switched with the address hash (#/, #/album/…, #/add, #/settings).
import * as store from "./store.js";
import * as discogs from "./discogs.js";
import { startScanner, stopScanner } from "./scanner.js";
import * as cloud from "./cloud.js";
import * as packages from "./packages.js";

const $ = id => document.getElementById(id);
const esc = t => String(t ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const sleep = ms => new Promise(r => setTimeout(r, ms));

let items = store.loadCollection();
let settings = store.loadSettings();
const ui = Object.assign({ mode: "albums", layout: "grid", sort: "added", genre: "" }, settings.ui);

function save() { store.saveCollection(items); syncUp(); }
function saveUi() { settings = store.loadSettings(); settings.ui = ui; store.saveSettings(settings); }

function fmtLen(sec) {
  if (!sec) return "";
  const h = Math.floor(sec / 3600), m = Math.floor(sec % 3600 / 60), s = String(sec % 60).padStart(2, "0");
  return h ? `${h}:${String(m).padStart(2, "0")}:${s}` : `${m}:${s}`;
}

let toastTimer;
function toast(msg) {
  const t = $("toast"); t.textContent = msg; t.hidden = false;
  clearTimeout(toastTimer); toastTimer = setTimeout(() => t.hidden = true, 3500);
}

// ---------- page switching ----------

function show(page) {
  document.body.dataset.page = page;
  document.querySelectorAll(".page").forEach(p => p.classList.toggle("on", p.id === "page-" + page));
  if (page !== "add") stopScanner();
  window.scrollTo(0, 0);
}

function route() {
  const [, page, arg] = location.hash.split("/");
  $("menu").classList.remove("on");
  if (page === "album") return openAlbum(decodeURIComponent(arg || ""));
  if (page === "add") return openAdd();
  if (page === "versions") return versionState ? show("versions") : (location.hash = "#/add");
  if (page === "settings") return openSettings();
  if (page === "packages") return packages.open();
  if (page === "import") return arg ? packages.startImport(location.hash.slice("#/import/".length)) : packages.openImport();
  if (!items.length) return show("empty");
  renderCollection();
  show("collection");
}
window.addEventListener("hashchange", route);

// ---------- collection ----------

const sorters = {
  added: (a, b) => (b.added || "").localeCompare(a.added || ""),
  artist: (a, b) => a.artist.localeCompare(b.artist) || (a.year || 0) - (b.year || 0),
  title: (a, b) => a.title.localeCompare(b.title),
  year: (a, b) => (a.year || 9999) - (b.year || 9999),
};

// Genre filter: Discogs has broad genres (Pop, Rock…) and detailed styles (K-pop, Ballad…). Value is "g:Pop" or "s:K-pop".
function renderGenreFilter() {
  const count = (field) => {
    const m = new Map();
    for (const a of items) for (const x of new Set(a[field] || [])) m.set(x, (m.get(x) || 0) + 1);
    return [...m].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
  };
  const opts = (list, prefix) => list.map(([name, n]) =>
    `<option value="${prefix}:${esc(name)}">${esc(name)} (${n})</option>`).join("");
  const genres = count("genres"), styles = count("styles");
  $("genreFilter").innerHTML = `<option value="">All genres</option>`
    + (genres.length ? `<optgroup label="Genres">${opts(genres, "g")}</optgroup>` : "")
    + (styles.length ? `<optgroup label="Styles">${opts(styles, "s")}</optgroup>` : "");
  // forget a saved choice that no longer exists in the collection
  if (ui.genre && ![...$("genreFilter").options].some(o => o.value === ui.genre)) ui.genre = "";
  $("genreFilter").value = ui.genre;
  $("genreFilter").classList.toggle("on", !!ui.genre);
}

function genreMatch(key) {
  if (!ui.genre) return true;
  const a = itemsByKey.get(key);
  if (!a) return false;
  const [kind, name] = [ui.genre[0], ui.genre.slice(2)];
  return (kind === "g" ? a.genres : a.styles || []).includes(name);
}
let itemsByKey = new Map();

function renderCollection() {
  itemsByKey = new Map(items.map(a => [a.key, a]));
  renderGenreFilter();
  const sorted = [...items].sort(sorters[ui.sort]);
  $("grid").innerHTML = sorted.map(a => `<div class="item" data-key="${esc(a.key)}" data-text="${esc((a.title + " " + a.artist).toLowerCase())}">
      <img class="cover" loading="lazy" src="${esc(a.cover || a.thumb)}" alt="">
      <div class="t">${esc(a.title)}</div><div class="a">${esc(a.artist)}${a.year ? " · " + a.year : ""}</div></div>`).join("");
  $("list").tBodies[0].innerHTML = sorted.map(a => `<tr data-key="${esc(a.key)}">
      <td><img class="thumb" loading="lazy" src="${esc(a.thumb || a.cover)}" alt=""></td>
      <td class="t">${esc(a.title)}</td><td>${esc(a.artist)}</td><td class="m">${a.year || ""}</td>
      <td class="m wide">${esc(a.genres.join(", "))}</td><td class="m wide">${esc(a.label)}</td>
      <td class="m wide">${esc(a.format)}</td><td class="r wide">${fmtLen(a.secs)}</td></tr>`).join("");
  $("songs").tBodies[0].innerHTML = sorted.flatMap(a => a.tracks.filter(t => t.type === "track").map(t => `<tr data-key="${esc(a.key)}">
      <td><img class="thumb sm" loading="lazy" src="${esc(a.thumb || a.cover)}" alt=""></td>
      <td class="t">${esc(t.title)}</td><td>${esc(t.artist || a.artist)}</td><td class="m wide">${esc(a.title)}</td>
      <td class="m wide">${esc(t.pos)}</td><td class="r">${t.dur ? esc(fmtLen(t.secs) || t.dur) : ""}</td></tr>`)).join("");
  updateCollectionView();
}

function updateCollectionView() {
  document.querySelectorAll("[data-mode]").forEach(b => b.classList.toggle("on", b.dataset.mode === ui.mode));
  document.querySelectorAll("[data-view]").forEach(b => b.classList.toggle("on", b.dataset.view === ui.layout));
  $("sort").value = ui.sort;
  $("grid").hidden = !(ui.mode === "albums" && ui.layout === "grid");
  $("list").hidden = !(ui.mode === "albums" && ui.layout === "list");
  $("songs").hidden = ui.mode !== "songs";
  $("layoutswitch").hidden = ui.mode === "songs";
  applyFilters();
}

// Column search. Text: contains. Year/Track: "1997", "199", "1990-1999", ">2000". Length: "4:21", "4:", "3:00-4:00", ">5:00"
const secs = t => discogs.toSecs(t.trim());
function rangeMatch(val, q, toNum) {
  val = val.trim(); if (!val) return false;
  const v = toNum(val);
  const range = q.match(/^(.+?)\s*-\s*(.+)$/);
  if (range && !isNaN(v)) return v >= toNum(range[1]) && v <= toNum(range[2]);
  if (q[0] === ">") return v > toNum(q.slice(1));
  if (q[0] === "<") return v < toNum(q.slice(1));
  return val.toLowerCase().startsWith(q.toLowerCase());
}
function cellMatch(input, text) {
  const q = input.value.trim(); if (!q) return true;
  if (input.classList.contains("time")) return rangeMatch(text, q, secs);
  if (input.classList.contains("num")) return rangeMatch(text, q, Number);
  return text.toLowerCase().includes(q.toLowerCase());
}

function applyFilters() {
  const g = $("globalSearch").value.trim().toLowerCase();
  let shown = 0, total = 0;
  if (ui.mode === "albums" && ui.layout === "grid") {
    for (const el of $("grid").children) { const ok = genreMatch(el.dataset.key) && (!g || el.dataset.text.includes(g)); el.hidden = !ok; total++; if (ok) shown++; }
  } else {
    const table = ui.mode === "songs" ? $("songs") : $("list");
    const inputs = [...table.querySelectorAll(".colsearch")];
    const body = table.tBodies[0];
    body.querySelector(".nomatch")?.remove();
    for (const tr of body.rows) {
      const ok = genreMatch(tr.dataset.key) && (!g || tr.textContent.toLowerCase().includes(g)) && inputs.every(i => cellMatch(i, tr.cells[i.dataset.col].textContent));
      tr.hidden = !ok; total++; if (ok) shown++;
    }
    if (!shown && total) body.insertAdjacentHTML("beforeend", '<tr class="nomatch"><td colspan="8">No matches</td></tr>');
  }
  const filtered = shown !== total ? `${shown} of ` : "";
  if (ui.mode === "songs") {
    const all = items.flatMap(a => a.tracks.filter(t => t.type === "track"));
    const sum = [...$("songs").tBodies[0].rows].filter(tr => !tr.hidden && !tr.classList.contains("nomatch"))
      .reduce((n, tr) => n + secs(tr.cells[5].textContent), 0);
    $("count").textContent = `${filtered}${all.length} songs · ${Math.floor(sum / 3600)} h ${Math.floor(sum % 3600 / 60)} min`;
  } else {
    $("count").textContent = `${filtered}${items.length} CDs`;
  }
}

document.querySelectorAll("[data-mode]").forEach(b => b.onclick = () => { ui.mode = b.dataset.mode; saveUi(); updateCollectionView(); });
document.querySelectorAll("[data-view]").forEach(b => b.onclick = () => { ui.layout = b.dataset.view; saveUi(); updateCollectionView(); });
$("sort").onchange = () => { ui.sort = $("sort").value; saveUi(); renderCollection(); };
$("genreFilter").onchange = () => { ui.genre = $("genreFilter").value; saveUi(); $("genreFilter").classList.toggle("on", !!ui.genre); applyFilters(); };
document.querySelectorAll(".colsearch").forEach(i => i.oninput = applyFilters);
$("globalSearch").oninput = () => {
  if (packages.isOpen()) return packages.search();
  if (!$("page-collection").classList.contains("on")) { location.hash = "#/"; }
  applyFilters();
};
document.addEventListener("click", e => {
  const el = e.target.closest("[data-key]");
  if (el && !e.target.closest("input")) location.hash = "#/album/" + encodeURIComponent(el.dataset.key);
});

// ---------- album page ----------

let currentKey = null;
function openAlbum(key) {
  const a = items.find(x => x.key === key);
  if (!a) { location.hash = "#/"; return; }
  currentKey = key;
  $("alCover").src = a.cover || a.thumb;
  $("alTitle").textContent = a.title;
  $("alSub").textContent = [a.artist, a.year, fmtLen(a.secs)].filter(Boolean).join(" · ");
  $("alTags").innerHTML = [...a.genres, ...a.styles].map(g => `<span>${esc(g)}</span>`).join("");
  $("alInfo").innerHTML = [["Label", a.label], ["Catalog no.", a.catno], ["Country", a.country], ["Format", a.format], ["Barcode", a.barcode]]
    .filter(r => r[1]).map(([k, v]) => `<dt>${k}</dt><dd>${esc(v)}</dd>`).join("");
  const n = a.tracks.filter(t => t.type === "track").length;
  $("alTracks").innerHTML = a.tracks.map(t => t.type === "heading"
      ? `<tr class="heading"><td></td><td colspan="2">${esc(t.title)}</td></tr>`
      : `<tr><td>${esc(t.pos)}</td><td>${esc(t.title)}${t.artist ? ` <span class="hint">· ${esc(t.artist)}</span>` : ""}</td><td>${esc(t.dur)}</td></tr>`).join("")
    + (n ? `<tr class="total"><td></td><td>Total length · ${n} tracks</td><td>${fmtLen(a.secs) || "–"}</td></tr>` : "");
  $("alLink").href = a.url;
  show("album");
}

$("alRemove").onclick = () => {
  const a = items.find(x => x.key === currentKey);
  if (!a || !confirm(`Remove "${a.title}" by ${a.artist} from your collection?`)) return;
  items = items.filter(x => x.key !== currentKey); save();
  toast(`Removed "${a.title}"`);
  location.hash = "#/";
};

$("alChange").onclick = async () => {
  const a = items.find(x => x.key === currentKey);
  if (!a) return;
  busy($("alChange"), true);
  try {
    const list = a.master_id ? await discogs.masterVersions(a.master_id) : await discogs.searchText(`${a.artist} ${a.title}`);
    showVersions({ title: a.title, artist: a.artist, versions: list.map(discogs.toVersion), replaceKey: a.key, back: "#/album/" + encodeURIComponent(a.key) });
  } catch (e) { toast(e.message); }
  busy($("alChange"), false);
};

function busy(btn, on) {
  if (on) { btn.dataset.label = btn.innerHTML; btn.innerHTML = '<span class="spinner"></span>' + btn.innerHTML; btn.disabled = true; }
  else if (btn.dataset.label) { btn.innerHTML = btn.dataset.label; btn.disabled = false; }
}

// ---------- add CD ----------

function setStatus(html, kind = "info") { $("addStatus").innerHTML = html ? `<div class="note ${kind}">${html}</div>` : ""; }

function openAdd() {
  show("add");
  if (!store.loadSettings().token) {
    setStatus('To add CDs, first <a href="#/settings">add your Discogs token in Settings</a>.', "warn");
    return;
  }
  if (!$("results").innerHTML && !$("addStatus").innerHTML) setCamera(true);
}

async function setCamera(on) {
  $("camBtn").classList.toggle("on", on);
  $("camArea").hidden = !on;
  if (!on) return stopScanner();
  $("camMsg").textContent = "Hold the barcode in front of the camera.";
  try {
    await startScanner("reader", code => { setCamera(false); $("addInput").value = code; lookup(code); });
  } catch (e) {
    $("camMsg").textContent = "Camera not available (" + (e.message || e) + "). You can type the barcode number instead.";
  }
}

$("camBtn").onclick = () => setCamera(!$("camBtn").classList.contains("on"));
$("pasteBtn").onclick = async () => {
  try { $("addInput").value = (await navigator.clipboard.readText()).trim(); }
  catch { $("addInput").focus(); toast("Press Ctrl+V to paste the link"); return; }
  if ($("addInput").value) lookup($("addInput").value);
};
$("addForm").onsubmit = e => { e.preventDefault(); const q = $("addInput").value.trim(); if (q) lookup(q); };

async function lookup(q) {
  setCamera(false);
  $("results").innerHTML = "";
  setStatus('<span class="spinner"></span>Looking it up on Discogs…');
  try {
    const link = discogs.parseUrl(q);
    const digits = q.replace(/[\s-]/g, "");
    if (link?.kind === "release") {
      setStatus("");
      return addRelease(link.id);
    }
    if (link?.kind === "master") {
      const [m, v] = await Promise.all([discogs.getMaster(link.id), discogs.masterVersions(link.id)]);
      setStatus("");
      return showVersions({ title: m.title, artist: discogs.artistNames(m.artists), versions: v.map(discogs.toVersion), back: "#/add" });
    }
    if (/^\d{8,14}$/.test(digits)) {
      const res = await discogs.searchBarcode(digits);
      if (!res.length) return setStatus(`No CD found on Discogs for barcode <b>${esc(digits)}</b>. Try searching by name instead.`, "warn");
      setStatus("");
      if (res.length === 1) return addRelease(res[0].id);
      const [artist, title] = splitTitle(res[0].title);
      return showVersions({ title, artist, versions: res.map(discogs.toVersion), back: "#/add" });
    }
    const res = await discogs.searchText(q);
    if (!res.length) return setStatus(`Nothing found for "<b>${esc(q)}</b>". Try fewer words, or just the album name.`, "warn");
    setStatus("");
    showResults(q, res);
  } catch (e) {
    setStatus(esc(e.message), "warn");
  }
}

// Discogs search titles look like "Artist - Album"
function splitTitle(t) { const i = t.indexOf(" - "); return i > 0 ? [discogs.clean(t.slice(0, i)), t.slice(i + 3)] : ["", t]; }

function showResults(q, res) {
  const groups = new Map();
  for (const r of res) {
    const k = r.master_id ? "m" + r.master_id : "r" + r.id;
    if (!groups.has(k)) groups.set(k, { ...r, count: 0, list: [] });
    const g = groups.get(k); g.count++; g.list.push(r);
  }
  const arr = [...groups.values()];
  $("results").innerHTML = `<div class="hint" style="margin:0 0 6px">Results for "${esc(q)}"</div>` + arr.map((g, i) => {
    const [artist, title] = splitTitle(g.title);
    return `<div class="res" data-group="${i}"><img loading="lazy" src="${esc(g.thumb || g.cover_image)}" alt="">
      <div><b>${esc(title)}</b><div class="m">${esc(artist)}${g.year ? " · " + esc(g.year) : ""}${g.master_id ? " · see all CD versions" : ""}</div></div></div>`;
  }).join("");
  $("results").querySelectorAll("[data-group]").forEach(el => el.onclick = async () => {
    const g = arr[+el.dataset.group];
    const [artist, title] = splitTitle(g.title);
    if (!g.master_id && g.list.length === 1) return addRelease(g.id);
    setStatus('<span class="spinner"></span>Getting versions…');
    try {
      const versions = g.master_id ? await discogs.masterVersions(g.master_id) : g.list;
      setStatus("");
      showVersions({ title, artist, versions: versions.map(discogs.toVersion), back: "#/add" });
    } catch (e) { setStatus(esc(e.message), "warn"); }
  });
}

async function addRelease(id, { replaceKey = null, force = false } = {}) {
  const existing = items.find(x => x.id === id && x.key !== replaceKey);
  if (existing && !force) {
    location.hash = "#/add";
    setStatus(`⚠ You already have this CD: <b>${esc(existing.title)}</b> by ${esc(existing.artist)}.
      <a href="#/album/${encodeURIComponent(existing.key)}">Open it</a> · <a href="#" id="addAnyway">Add another copy</a>`, "warn");
    $("addAnyway").onclick = e => { e.preventDefault(); addRelease(id, { replaceKey, force: true }); };
    return null;
  }
  toast("Adding from Discogs…");
  try {
    const r = await discogs.getRelease(id);
    if (replaceKey) {
      const old = items.find(x => x.key === replaceKey);
      const item = discogs.releaseToItem(r, { key: replaceKey, added: old?.added });
      items = items.map(x => x.key === replaceKey ? item : x);
      toast(`Changed to the ${item.country || ""} ${item.year || ""} version`.replace(/\s+/g, " "));
    } else {
      const item = discogs.releaseToItem(r);
      items.push(item);
      toast(`Added "${item.title}" to your collection`);
      replaceKey = item.key;
    }
    save();
    $("addInput").value = ""; $("results").innerHTML = ""; setStatus("");
    versionState = null;
    location.hash = "#/album/" + encodeURIComponent(replaceKey);
    return replaceKey;
  } catch (e) { toast(e.message); return null; }
}

// ---------- choose version ----------

let versionState = null, chosen = null;
function showVersions(state) {
  versionState = state; chosen = null;
  const owned = new Set(items.map(x => x.id));
  $("versSub").innerHTML = `We found ${state.versions.length} version${state.versions.length === 1 ? "" : "s"} of <b>${esc(state.title)}</b>${state.artist ? " by " + esc(state.artist) : ""}.`;
  $("versBack").href = state.back || "#/add";
  $("vers").innerHTML = state.versions.map((v, i) => `<div class="ver" data-i="${i}">
      <img loading="lazy" src="${esc(v.thumb)}" alt="">
      <div><b>${esc(v.country || "Unknown country")}</b> · ${esc(v.label)}${owned.has(v.id) ? ' <span class="own">● in your collection</span>' : ""}
        <div class="meta">${esc([v.catno, v.format].filter(Boolean).join(" · "))}</div></div>
      <div class="yr">${esc(v.year)}</div></div>`).join("");
  $("vers").querySelectorAll(".ver").forEach(el => el.onclick = () => {
    $("vers").querySelectorAll(".ver").forEach(x => x.classList.toggle("on", x === el));
    chosen = state.versions[+el.dataset.i]; $("versAdd").disabled = false;
  });
  $("versAdd").disabled = true;
  $("versAdd").textContent = state.replaceKey ? "Use this version" : "Add to collection";
  location.hash = "#/versions";
  show("versions");
}
$("versAdd").onclick = () => chosen && addRelease(chosen.id, { replaceKey: versionState?.replaceKey });

// ---------- settings, Discogs import, backup ----------

function openSettings() {
  const s = store.loadSettings();
  $("setToken").value = s.token || "";
  $("setUser").value = s.user || "";
  show("settings");
}

$("saveSettings").onclick = () => {
  const s = store.loadSettings();
  s.token = $("setToken").value.trim();
  s.user = $("setUser").value.trim();
  store.saveSettings(s);
  if (user) cloud.saveUserSettings(user.uid, { discogsToken: s.token, discogsUser: s.user }).catch(e => toast(cloud.niceError(e)));
  $("saveMsg").textContent = user ? "Saved to your account ✓" : "Saved ✓";
  setTimeout(() => $("saveMsg").textContent = "", 2500);
};

let importing = false;
$("importDiscogs").onclick = async () => {
  if (importing) { importing = false; return; }
  $("saveSettings").click();
  const user = store.loadSettings().user;
  if (!user) { $("importMsg").textContent = "Fill in your Discogs username first."; return; }
  importing = true;
  const btn = $("importDiscogs"), bar = $("importProgress"), msg = $("importMsg");
  btn.textContent = "Stop import"; bar.hidden = false; bar.firstElementChild.style.width = "0";
  let added = 0;
  try {
    msg.textContent = "Reading your Discogs collection…";
    const list = [];
    for (let page = 1; ; page++) {
      const r = await discogs.collectionPage(user, page);
      list.push(...r.releases);
      if (page >= r.pagination.pages) break;
    }
    const have = new Set(items.map(x => x.key));
    const todo = list.filter(x => !have.has("i" + x.instance_id));
    if (!todo.length) msg.textContent = `All ${list.length} items are already in Discindex. Nothing new to import.`;
    for (let i = 0; i < todo.length && importing; i++) {
      const c = todo[i], bi = c.basic_information;
      msg.textContent = `Importing ${i + 1} of ${todo.length}: ${bi.title}`;
      bar.firstElementChild.style.width = `${(i + 1) / todo.length * 100}%`;
      const started = Date.now();
      try {
        const r = await discogs.getRelease(c.id);
        items.push(discogs.releaseToItem(r, { key: "i" + c.instance_id, added: c.date_added, thumb: bi.thumb, cover: bi.cover_image }));
        save(); added++;
      } catch (e) { console.warn("Skipped", c.id, e); }
      await sleep(Math.max(0, 1100 - (Date.now() - started)));   // stay under Discogs' speed limit
    }
    if (todo.length) msg.textContent = importing ? `Done! Imported ${added} items.` : `Stopped. Imported ${added} items; run it again to continue.`;
  } catch (e) {
    msg.textContent = e.message;
  }
  importing = false; btn.textContent = "Import my Discogs collection";
};

function doExport() { store.exportFile(items); toast(`Exported ${items.length} CDs`); }
async function doImportFile(file) {
  try {
    const incoming = await store.readFile(file);
    const have = new Set(items.map(x => x.key));
    const fresh = incoming.filter(x => x && x.key && !have.has(x.key));
    items.push(...fresh); save();
    toast(`Imported ${fresh.length} CDs from the file`);
    route();
  } catch (e) { toast("Couldn't read that file: " + e.message); }
}
$("exportBtn").onclick = doExport;
$("menuExport").onclick = doExport;
$("importBtn").onclick = $("menuImport").onclick = () => $("importFile").click();
$("importFile").onchange = e => { if (e.target.files[0]) doImportFile(e.target.files[0]); e.target.value = ""; };
$("clearBtn").onclick = () => {
  const where = user ? "from your account, on all your devices" : "from this browser";
  if (!confirm(`Delete all ${items.length} CDs ${where}? This can't be undone. (Export a backup first if you're unsure.)`)) return;
  items = []; save(); toast("Collection deleted"); location.hash = "#/";
};

$("gear").onclick = $("avatarBtn").onclick = e => { e.stopPropagation(); $("menu").classList.toggle("on"); };
document.addEventListener("click", e => { if (!e.target.closest("#menu")) $("menu").classList.remove("on"); });

// ---------- sign in + online sync ----------

let user = null, unlisten = null;
let synced = new Map();   // key -> JSON of the item as it is online
const snapshotOf = list => new Map(list.map(i => [i.key, JSON.stringify(i)]));

// Send local changes (added, changed, removed CDs) to the online database.
let syncing = Promise.resolve();
function syncUp() {
  if (!user) return;
  const now = snapshotOf(items);
  const upserts = items.filter(i => synced.get(i.key) !== now.get(i.key));
  const deletes = [...synced.keys()].filter(k => !now.has(k));
  if (!upserts.length && !deletes.length) return;
  synced = now;
  const uid = user.uid;
  syncing = syncing.then(() => cloud.writeChanges(uid, upserts, deletes))
    .catch(e => toast("Couldn't sync: " + cloud.niceError(e)));
}

function rerenderVisible() {
  if ($("page-collection").classList.contains("on") || $("page-empty").classList.contains("on")) route();
  else if ($("page-album").classList.contains("on")) openAlbum(currentKey);
}

async function signedIn(u) {
  user = u;
  showAccount();
  packages.setUser(u).catch(e => console.warn("Packages unavailable", e));
  try {
    const online = await cloud.loadAll(u.uid);
    // Merge: anything only on this device gets uploaded, everything online comes down.
    const keys = new Set(online.items.map(i => i.key));
    const localOnly = items.filter(i => !keys.has(i.key));
    synced = snapshotOf(online.items);
    items = [...online.items, ...localOnly];
    store.saveCollection(items);
    syncUp();
    if (localOnly.length) toast(`Uploaded ${localOnly.length} CDs from this device to your account`);
    // Discogs token: use the one saved in the account, or save this device's one there.
    const s = store.loadSettings();
    if (online.settings.discogsToken) { s.token = online.settings.discogsToken; s.user = online.settings.discogsUser || s.user; store.saveSettings(s); }
    else if (s.token) cloud.saveUserSettings(u.uid, { discogsToken: s.token, discogsUser: s.user || "" });
    rerenderVisible();
    if ($("page-settings").classList.contains("on")) openSettings();
    unlisten = await cloud.listen(u.uid, (list, mine) => {
      if (mine || !user) return;
      synced = snapshotOf(list);
      const changed = JSON.stringify([...snapshotOf(items)].sort()) !== JSON.stringify([...synced].sort());
      if (!changed) return;
      items = list; store.saveCollection(items);
      rerenderVisible();
    });
  } catch (e) { toast("Couldn't load your account: " + cloud.niceError(e)); }
}

function signedOut() {
  const wasSignedIn = !!user;
  packages.setUser(null);
  user = null; synced = new Map();
  if (unlisten) { unlisten(); unlisten = null; }
  if (wasSignedIn) {
    // Your collection is safe online; remove this device's copy so the next person doesn't see it.
    items = []; store.saveCollection(items);
    const s = store.loadSettings(); delete s.token; delete s.user; store.saveSettings(s);
    location.hash = "#/"; route();
  }
  showAccount();
}

function showAccount() {
  $("signInBtn").hidden = !cloud.enabled || !!user;
  $("avatarBtn").hidden = !user;
  $("menuSignOut").hidden = !user;
  $("menuWho").hidden = !user;
  if (!user) return;
  const name = user.displayName || user.email || "You";
  $("avatarBtn").innerHTML = user.photoURL ? `<img src="${esc(user.photoURL)}" alt="" referrerpolicy="no-referrer">` : esc(name[0].toUpperCase());
  $("menuWho").innerHTML = `Signed in as<b>${esc(name)}</b>${user.displayName && user.email ? esc(user.email) : ""}<div class="sync">☁ Collection synced</div>`;
}

// sign-in window
let signUpMode = false;
function openAuth() {
  $("authModal").hidden = false; $("authMsg").textContent = "";
  setAuthMode(false); setTimeout(() => $("authEmail").focus(), 50);
}
function setAuthMode(up) {
  signUpMode = up;
  $("authTitle").textContent = up ? "Create your account" : "Sign in to Discindex";
  $("authSubmit").textContent = up ? "Create account" : "Sign in";
  $("authToggle").textContent = up ? "Already have an account? Sign in" : "New here? Create an account";
  $("authPw").autocomplete = up ? "new-password" : "current-password";
  $("authForgot").hidden = up;
}
const closeAuth = () => { $("authModal").hidden = true; };
async function authAction(fn, btn) {
  $("authMsg").textContent = ""; busy(btn, true);
  try { await fn(); closeAuth(); toast("Signed in ✓"); }
  catch (e) { $("authMsg").textContent = cloud.niceError(e); }
  busy(btn, false);
}
$("signInBtn").onclick = openAuth;
$("authClose").onclick = closeAuth;
$("authModal").onclick = e => { if (e.target === $("authModal")) closeAuth(); };
document.addEventListener("keydown", e => { if (e.key === "Escape") closeAuth(); });
$("googleBtn").onclick = () => authAction(() => cloud.signInGoogle(), $("googleBtn"));
$("authForm").onsubmit = e => {
  e.preventDefault();
  const email = $("authEmail").value.trim(), pw = $("authPw").value;
  authAction(() => signUpMode ? cloud.signUpEmail(email, pw) : cloud.signInEmail(email, pw), $("authSubmit"));
};
$("authToggle").onclick = e => { e.preventDefault(); setAuthMode(!signUpMode); $("authMsg").textContent = ""; };
$("authForgot").onclick = async e => {
  e.preventDefault();
  const email = $("authEmail").value.trim();
  if (!email) { $("authMsg").textContent = "Type your email above first, then click Forgot password."; return; }
  try { await cloud.resetPassword(email); $("authMsg").textContent = `We sent a reset link to ${email}. Check your inbox (and spam).`; }
  catch (err) { $("authMsg").textContent = cloud.niceError(err); }
};
$("menuSignOut").onclick = async () => {
  if (!confirm("Sign out? Your collection stays safe in your account and will come back when you sign in again.")) return;
  await cloud.signOut();
};

packages.init({ show, toast, esc, addRelease, lookup });
showAccount();
cloud.onUserChange(u => u ? signedIn(u) : signedOut()).catch(e => console.warn("Sign-in unavailable", e));

route();
