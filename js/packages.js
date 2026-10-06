// Packages: follow CDs you've ordered until they arrive. Only shown to the owner's account.
// Looks like the collection (cover grid / list). Paste a shop link and the album is found on Discogs.
// Stored online in users/{uid}/packages/{id}, so only the signed-in owner can read them.
import * as cloud from "./cloud.js";
import * as discogs from "./discogs.js";

export const OWNER_EMAIL = "kevi2798@gmail.com";
// emailVerified matters: Google accounts are verified, so nobody can pretend to be the owner
// by signing up with the same address and a password.
export const isOwner = u => !!u && u.emailVerified && (u.email || "").toLowerCase() === OWNER_EMAIL;

const STEPS = ["ordered", "paid", "shipped", "arrived"];
const LABEL = { ordered: "Ordered", paid: "Paid", shipped: "Shipped", arrived: "Arrived" };
const $ = id => document.getElementById(id);
const today = () => new Date().toISOString().slice(0, 10);
// The page reader runs on Cloudflare (discindex.pages.dev); other addresses call it there.
const API = /pages\.dev$|^localhost$|^127\.0\.0\.1$/.test(location.hostname) ? "" : "https://discindex.pages.dev";

let h = null;            // helpers from app.js: show, toast, esc, addRelease, lookup
let user = null, list = [], unlisten = null;
const view = { status: "open", layout: "grid", sort: "newest" };
try { Object.assign(view, JSON.parse(localStorage.getItem("discindex.packages.view")) || {}); } catch {}
const saveView = () => { try { localStorage.setItem("discindex.packages.view", JSON.stringify(view)); } catch {} };

export function init(helpers) {
  h = helpers;
  if (!$("pkgGrid")) return;   // an older cached page without the Packages section
  document.querySelectorAll("[data-pstatus]").forEach(b => b.onclick = () => { view.status = b.dataset.pstatus; saveView(); render(); });
  document.querySelectorAll("[data-pview]").forEach(b => b.onclick = () => { view.layout = b.dataset.pview; saveView(); render(); });
  $("pkgSort").onchange = () => { view.sort = $("pkgSort").value; saveView(); render(); };
  $("pkgAddBtn").onclick = () => openEditor(null);
  $("pkgGrid").onclick = $("pkgTable").onclick = onListClick;
  // editor window
  $("pkgClose").onclick = closeEditor;
  $("pkgModal").onclick = e => { if (e.target === $("pkgModal")) closeEditor(); };
  $("pkgFind").onsubmit = e => { e.preventDefault(); find($("pkgUrl").value.trim()); };
  $("pkgUrl").onpaste = () => setTimeout(() => find($("pkgUrl").value.trim()), 0);
  $("pkgPaste").onclick = async () => {
    try { $("pkgUrl").value = (await navigator.clipboard.readText()).trim(); find($("pkgUrl").value); }
    catch { $("pkgUrl").focus(); h.toast("Press Ctrl+V (or long-press → Paste) to paste the link"); }
  };
  $("pkgEdit").onsubmit = e => { e.preventDefault(); saveFromEditor(); };
  $("pkgArrivedBtn").onclick = () => { const p = editing && byId(editing.id); if (p) { closeEditor(); arrived(p); } };
  $("pkgDeleteBtn").onclick = () => {
    const p = editing && byId(editing.id);
    if (p && confirm(`Delete the package "${p.title}"?`)) { cloud.deletePackage(user.uid, p.id).catch(err => h.toast(cloud.niceError(err))); closeEditor(); }
  };
  document.addEventListener("keydown", e => { if (e.key === "Escape" && !$("pkgModal").hidden) closeEditor(); });
}

export async function setUser(u) {
  if (unlisten) { unlisten(); unlisten = null; }
  user = isOwner(u) ? u : null;
  list = [];
  document.querySelectorAll(".owner-only").forEach(el => el.hidden = !user);
  if (!user) {
    if (location.hash.startsWith("#/packages")) location.hash = "#/";
    return;
  }
  unlisten = await cloud.listenPackages(user.uid, l => {
    list = l;
    if ($("page-packages")?.classList.contains("on")) render();
  });
}

export function open() {
  if (!user) { location.hash = "#/"; return; }
  h.show("packages");
  render();
}

export const isOpen = () => !!$("page-packages")?.classList.contains("on");
export const search = () => render();

const byId = id => list.find(p => p.id === id);
const save = p => cloud.savePackage(user.uid, p).catch(e => h.toast("Couldn't save: " + cloud.niceError(e)));

// ---------- the grid / list ----------

function ago(date) {
  const d = Math.round((Date.parse(today()) - Date.parse(date)) / 86400000);
  return d <= 0 ? "today" : d === 1 ? "yesterday" : `${d} days ago`;
}
const nice = date => date ? new Date(date + "T12:00").toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" }) : "";
const when = p => p.status === "arrived" ? `arrived ${nice(p.arrivedDate)}` : `ordered ${ago(p.orderDate)}`;

const sorters = {
  newest: (a, b) => (b.orderDate || "").localeCompare(a.orderDate || "") || (b.created || "").localeCompare(a.created || ""),
  oldest: (a, b) => (a.orderDate || "").localeCompare(b.orderDate || ""),
  artist: (a, b) => (a.artist || "").localeCompare(b.artist || ""),
  title: (a, b) => a.title.localeCompare(b.title),
  shop: (a, b) => (a.shop || "").localeCompare(b.shop || ""),
  status: (a, b) => STEPS.indexOf(a.status) - STEPS.indexOf(b.status),
};

function visible() {
  const q = ($("globalSearch").value || "").trim().toLowerCase();
  return list
    .filter(p => view.status === "all" ? true : view.status === "open" ? p.status !== "arrived" : p.status === view.status)
    .filter(p => !q || [p.title, p.artist, p.shop, p.shopUrl].join(" ").toLowerCase().includes(q))
    .sort(sorters[view.sort] || sorters.newest);
}

function render() {
  const esc = h.esc;
  const counts = { open: list.filter(p => p.status !== "arrived").length, all: list.length };
  STEPS.forEach(s => counts[s] = list.filter(p => p.status === s).length);
  document.querySelectorAll("[data-pstatus]").forEach(b => {
    b.classList.toggle("on", b.dataset.pstatus === view.status);
    b.querySelector("small").textContent = counts[b.dataset.pstatus] || 0;
  });
  document.querySelectorAll("[data-pview]").forEach(b => b.classList.toggle("on", b.dataset.pview === view.layout));
  $("pkgSort").value = view.sort;

  const shown = visible();
  $("pkgCount").textContent = `${counts.open} on the way`;
  const cover = (p, cls) => p.thumb
    ? `<img class="${cls}" loading="lazy" src="${esc(p.cover || p.thumb)}" alt="">`
    : `<div class="${cls} pkg-ph">📦</div>`;
  const badge = p => `<span class="pkg-badge s-${p.status}">${LABEL[p.status]}</span>`;
  const arrivedBtn = p => p.status === "arrived" ? "" : `<button class="btn small pkg-arrived" title="It arrived: add to collection">✓ Arrived</button>`;

  $("pkgGrid").hidden = view.layout !== "grid";
  $("pkgTable").hidden = view.layout !== "list";
  $("pkgGrid").innerHTML = shown.map(p => `<div class="item pkg-item" data-pid="${esc(p.id)}">
      <div class="cover-wrap">${cover(p, "cover")}${badge(p)}</div>
      <div class="t">${esc(p.title)}</div>
      <div class="a">${esc([p.artist, p.shop].filter(Boolean).join(" · "))}</div>
      <div class="a pkg-when">${esc(when(p))}</div>${arrivedBtn(p)}</div>`).join("");
  $("pkgTable").tBodies[0].innerHTML = shown.map(p => `<tr data-pid="${esc(p.id)}">
      <td>${cover(p, "thumb")}</td><td class="t">${esc(p.title)}</td><td>${esc(p.artist)}</td>
      <td class="m wide">${esc(p.shop)}</td><td class="m wide">${esc(nice(p.orderDate))}</td>
      <td class="r">${badge(p)}</td><td class="r pkg-act">${arrivedBtn(p)}</td></tr>`).join("");
  $("pkgEmpty").hidden = shown.length > 0;
  $("pkgEmpty").innerHTML = list.length
    ? "No packages match this filter."
    : `No packages yet.<br><button class="btn" onclick="document.getElementById('pkgAddBtn').click()">+ Add your first package</button>`;
}

function onListClick(e) {
  const el = e.target.closest("[data-pid]");
  if (!el) return;
  const p = byId(el.dataset.pid);
  if (!p) return;
  if (e.target.closest(".pkg-arrived")) { e.stopPropagation(); return arrived(p); }
  openEditor(p);
}

// ---------- add / edit window ----------

let editing = null;   // the package being edited (null = new), plus the chosen Discogs release
let chosen = null;
let shopImage = "";   // picture from the shop page, used when there is no Discogs match

function openEditor(p) {
  editing = p ? { ...p } : null;
  chosen = p?.releaseId ? { releaseId: p.releaseId, thumb: p.thumb, cover: p.cover } : null;
  shopImage = p && !p.releaseId ? (p.thumb || "") : "";
  $("pkgModalTitle").textContent = p ? "Package" : "Add a package";
  $("pkgUrl").value = p?.shopUrl || "";
  $("pkgFindStatus").innerHTML = ""; $("pkgMatches").innerHTML = "";
  $("pkgTitle").value = p?.title || "";
  $("pkgArtist").value = p?.artist || "";
  $("pkgShop").value = p?.shop || "";
  $("pkgDate").value = p?.orderDate || today();
  $("pkgStatus").value = p?.status || "ordered";
  $("pkgStatus").querySelector('[value="arrived"]').hidden = !p || p.status !== "arrived";
  $("pkgSaveBtn").textContent = p ? "Save changes" : "+ Add package";
  $("pkgArrivedBtn").hidden = !p || p.status === "arrived";
  $("pkgDeleteBtn").hidden = !p;
  $("pkgShopLink").hidden = !p?.shopUrl; $("pkgShopLink").href = p?.shopUrl || "#";
  $("pkgDiscogsLink").hidden = !p?.releaseId; $("pkgDiscogsLink").href = p?.releaseId ? `https://www.discogs.com/release/${p.releaseId}` : "#";
  showChosen();
  $("pkgModal").hidden = false;
  if (!p) setTimeout(() => $("pkgUrl").focus(), 50);
}
function closeEditor() { $("pkgModal").hidden = true; editing = null; chosen = null; }

function showChosen() {
  const esc = h.esc;
  $("pkgChosen").innerHTML = chosen
    ? `<div class="res chosen">${chosen.thumb ? `<img src="${esc(chosen.thumb)}" alt="">` : ""}<div><b>✓ Linked to Discogs</b>
       <div class="m">${esc([chosen.label, chosen.country, chosen.year, chosen.format].filter(Boolean).join(" · ") || "Arrived will add this exact version to your collection")}</div></div></div>`
    : "";
}

const shopName = host => {
  const known = { "mercari": "Mercari", "amazon": "Amazon", "qoo10": "Qoo10", "yesasia": "YesAsia", "ktown4u": "Ktown4u",
    "cdjapan": "CDJapan", "tower": "Tower Records", "hmv": "HMV", "joshinweb": "Joshin", "ebay": "eBay", "aladin": "Aladin",
    "yes24": "YES24", "rakuten": "Rakuten", "acbuy": "acbuy", "buyee": "Buyee", "zenmarket": "ZenMarket", "discogs": "Discogs",
    "musicplaza": "Music Plaza", "kpopalbums": "Kpopalbums", "weverse": "Weverse", "makestar": "Makestar", "jpopsuki": "JPopsuki" };
  const parts = host.replace(/^www\./, "").split(".");
  for (const p of parts) if (known[p]) return known[p];
  return parts.length > 1 ? parts[parts.length - 2].replace(/^\w/, c => c.toUpperCase()) : host;
};

// Remove shop names and sales words from a product title so Discogs can find it.
function cleanTitle(t) {
  return (t || "")
    .replace(/　/g, " ")
    .replace(/の通販 by .*$/, " ")                                   // Rakuma: "…の通販 by shop｜…ならラクマ"
    .replace(/\s*(?:by|-)\s*(?:メルカリ|mercari)\s*$/i, " ")          // Mercari: "… by メルカリ"
    .replace(/\s*-\s*(?:Yahoo!?オークション|ヤフオク!?).*$/i, " ")
    .replace(/(?:\d+\s*)?点セット|まとめ売り|送料込み?|送料無料|匿名配送|美品|新品|中古|未開封|未使用|輸入盤|国内盤|韓国盤|初回限定盤?|通常盤|トレカ(?:付き)?|特典(?:付き)?|アルバム|シングル|バージョン選択|選択可?|ランダム|ver\.?\s*選択/gi, " ")
    .replace(/[「」『』]/g, " ")
    .replace(/\[(qoo10|amazon[^\]]*)\]/gi, " ")
    .replace(/[|｜:：-]\s*(amazon\.[a-z.]+|mercari|メルカリ|ebay|yesasia|qoo10|cdjapan|tower records|hmv).*$/i, " ")
    .replace(/【[^】]*】|〔[^〕]*〕|［[^］]*］/g, " ")
    .replace(/\((?:[^)]*?(?:cd|輸入盤|国内盤|限定|ver|version|新品|中古|import|pre-?order|特典)[^)]*)\)/gi, " ")
    .replace(/\b(cd|import|sealed|new|used|pre-?order|free shipping|official|album|mini|full|\d+(?:st|nd|rd|th))\b/gi, " ")
    .replace(/[\/~\-–—_,.!+]+/g, " ")
    .replace(/\s+/g, " ").trim()
    .split(" ").filter((w, i, a) => i === 0 || w.toLowerCase() !== a[i - 1].toLowerCase()).join(" ");   // "TWICE TWICE" -> "TWICE"
}

// Search phrases to try: the whole title, then with words dropped from the end and from the start.
function variants(text) {
  const w = text.split(" ").slice(0, 10), out = [w];
  if (w.length > 2) out.push(w.slice(0, -1), w.slice(1));
  if (w.length > 3) out.push(w.slice(0, -2), w.slice(2), w.slice(0, 2));
  return [...new Set(out.filter(x => x.length >= 1).map(x => x.join(" ")))].slice(0, 5);
}

let findRun = 0;
async function find(input) {
  if (!input) return;
  const run = ++findRun;
  const status = (html, kind = "info") => { if (run === findRun) $("pkgFindStatus").innerHTML = html ? `<div class="note ${kind}">${html}</div>` : ""; };
  $("pkgMatches").innerHTML = "";
  status('<span class="spinner"></span>Looking…');
  try {
    const isUrl = /^https?:\/\/|^www\.|\.[a-z]{2,}\//i.test(input);
    const link = discogs.parseUrl(input);
    if (link?.kind === "release") { status(""); return pick({ id: link.id }); }
    let results = [], info = null;
    if (link?.kind === "master") {
      results = await discogs.masterVersions(link.id);
    } else if (isUrl) {
      const url = /^https?:/i.test(input) ? input : "https://" + input;
      if (!$("pkgShop").value) try { $("pkgShop").value = shopName(new URL(url).hostname); } catch {}
      status('<span class="spinner"></span>Reading the shop page…');
      info = await fetch(`${API}/api/page-info?url=${encodeURIComponent(url)}`).then(r => r.json()).catch(() => null);
      if (info?.image) shopImage = info.image;
      if (!info || info.error) { status(`Couldn't read that page${info?.error ? `: ${h.esc(info.error)}` : ""}. Type the album name in the box instead.`, "warn"); return; }
      if (!$("pkgTitle").value && info.title) $("pkgTitle").value = cleanTitle(info.title).slice(0, 120);
      status('<span class="spinner"></span>Searching Discogs…');
      results = await searchAll(info);
    } else {
      results = await searchAll({ title: input, barcodes: /^\d{8,14}$/.test(input.replace(/\s/g, "")) ? [input.replace(/\s/g, "")] : [] });
    }
    if (run !== findRun) return;
    showMatches(results, info);
  } catch (e) {
    status(h.esc(e.message), "warn");
  }
}

// Barcode first (exact), then catalog number, then words from the title / link.
async function searchAll(info) {
  const seen = new Set(), out = [];
  const add = rs => { for (const r of rs || []) if (!seen.has(r.id)) { seen.add(r.id); out.push({ ...r, how: add.how }); } };
  for (const b of info.barcodes || []) { add.how = "barcode"; add(await discogs.searchBarcode(b)); }
  if (!out.length) for (const c of info.catnos || []) { add.how = "catalog number"; add(await discogs.searchCatno(c)); }
  if (!out.length) {
    add.how = "name";
    for (const text of [info.title, info.urlWords].map(cleanTitle).filter(Boolean)) {
      const before = out.length;
      for (const q of variants(text)) {
        add(await discogs.searchText(q));
        if (out.length > before) break;
      }
    }
  }
  return out.slice(0, 12);
}

function showMatches(results, info) {
  const esc = h.esc;
  const status = $("pkgFindStatus");
  if (!results.length) {
    status.innerHTML = `<div class="note warn">No match on Discogs${info?.title ? ` for "<b>${esc(cleanTitle(info.title))}</b>"` : ""}.
      Try typing the artist and album in the box, or just fill in the fields below.</div>`;
    return;
  }
  const how = results[0].how;
  status.innerHTML = `<div class="note ${how === "barcode" ? "ok" : "info"}">Found ${results.length} match${results.length === 1 ? "" : "es"} by ${how}${info?.blocked ? " (the shop blocked reading the page, so this came from the link)" : ""}. Pick the right one:</div>`;
  $("pkgMatches").innerHTML = results.map((r, i) => {
    const v = discogs.toVersion(r);
    const [artist, title] = (r.title || "").includes(" - ") ? [discogs.clean(r.title.split(" - ")[0]), r.title.split(" - ").slice(1).join(" - ")] : ["", r.title || ""];
    return `<div class="res" data-i="${i}"><img loading="lazy" src="${esc(v.thumb)}" alt="">
      <div><b>${esc(title)}</b><div class="m">${esc([artist, v.year, v.country, v.label, v.catno, v.format].filter(Boolean).join(" · "))}</div></div></div>`;
  }).join("");
  $("pkgMatches").querySelectorAll("[data-i]").forEach(el => el.onclick = () => {
    $("pkgMatches").querySelectorAll(".res").forEach(x => x.classList.toggle("on", x === el));
    pick(results[+el.dataset.i]);
  });
  if (results.length === 1) $("pkgMatches").querySelector(".res").click();
}

// Use a Discogs release: fill in album, artist and cover.
async function pick(r) {
  try {
    const rel = await discogs.getRelease(r.id);
    const item = discogs.releaseToItem(rel);
    const v = r.title ? discogs.toVersion(r) : {};
    chosen = { releaseId: rel.id, thumb: item.thumb || v.thumb || "", cover: item.cover || "",
      label: item.label, country: item.country, year: item.year, format: item.format };
    $("pkgTitle").value = item.title;
    $("pkgArtist").value = item.artist;
    showChosen();
  } catch (e) { h.toast(e.message); }
}

async function saveFromEditor() {
  const title = $("pkgTitle").value.trim();
  if (!title) { $("pkgTitle").focus(); return; }
  const url = $("pkgUrl").value.trim();
  const p = {
    ...(editing || { id: `p${Date.now()}`, created: new Date().toISOString(), arrivedDate: "" }),
    title,
    artist: $("pkgArtist").value.trim(),
    shop: $("pkgShop").value.trim(),
    shopUrl: /^https?:\/\//i.test(url) && !discogs.parseUrl(url) ? url : (editing?.shopUrl || ""),
    orderDate: $("pkgDate").value || today(),
    status: $("pkgStatus").value,
    releaseId: chosen?.releaseId || null,
    thumb: chosen?.thumb || shopImage || "",
    cover: chosen?.cover || shopImage || "",
  };
  closeEditor();
  await save(p);
  h.toast(editing ? "Saved" : `Added package: ${title}`);
}

// Mark as arrived and put the CD in the collection.
async function arrived(p) {
  if (!confirm(`"${p.title}" arrived? It will be marked as arrived and added to your collection.`)) return;
  const done = { ...p, status: "arrived", arrivedDate: today() };
  if (p.releaseId) {
    const key = await h.addRelease(p.releaseId);
    if (key) done.collectionKey = key;
    await save(done);
  } else {
    await save(done);
    // No Discogs link: search for it so the right version can be picked
    const q = [p.artist, p.title].filter(Boolean).join(" ");
    location.hash = "#/add";
    $("addInput").value = q;
    h.lookup(q);
  }
}
