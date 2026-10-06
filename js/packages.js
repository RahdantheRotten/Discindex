// Packages: follow what you've ordered until it arrives. Only shown to the owner's account.
// Looks like the collection (cover grid / list). Paste a shop link and the album is found on Discogs.
// Three types: 💿 CD (one release), 📦 Bundle (several CDs in one package), 🎁 Merch (lightsticks etc., no Discogs).
// Stored online in users/{uid}/packages/{id}, so only the signed-in owner can read them.
import * as cloud from "./cloud.js";
import * as discogs from "./discogs.js";

export const OWNER_EMAIL = "kevi2798@gmail.com";
// emailVerified matters: Google accounts are verified, so nobody can pretend to be the owner
// by signing up with the same address and a password.
export const isOwner = u => !!u && u.emailVerified && (u.email || "").toLowerCase() === OWNER_EMAIL;

const STEPS = ["ordered", "paid", "shipped", "arrived"];
const LABEL = { ordered: "Ordered", paid: "Paid", shipped: "Shipped", arrived: "Arrived" };
const KIND = { cd: "💿 CD", bundle: "📦 Bundle", merch: "🎁 Merch" };
const kindOf = p => p.kind || "cd";
const releasesOf = p => p.releases?.length ? p.releases : p.releaseId ? [{ id: p.releaseId, title: p.title, artist: p.artist, thumb: p.thumb, cover: p.cover }] : [];
const $ = id => document.getElementById(id);
const today = () => new Date().toISOString().slice(0, 10);
// The page reader runs on Cloudflare (discindex.pages.dev); other addresses call it there.
const API = /pages\.dev$|^localhost$|^127\.0\.0\.1$/.test(location.hostname) ? "" : "https://discindex.pages.dev";

// Guess the type from a shop title: merch (lightsticks, photocards…), a bundle of several CDs, or one CD.
const MERCH = /light ?stick|pen ?light|ペンライト|ペンラ|ラントレ|トレカ|photo ?cards?|ポスター|poster|acrylic|アクスタ|アクリル|keyring|key ?chain|キーホルダー|缶バッ?ジ|badge|t-?shirt|tシャツ|タオル|towel|hoodie|パーカー|グッズ|goods|fan ?light|ぬいぐるみ|plush|doll|sticker|ステッカー|うちわ|slogan|スローガン|bracelet|ブレスレット|lanyard|mug|マグ/i;
const CDWORD = /\bcds?\b|album|アルバム|single|シングル|\bep\b|repackage|リパッケージ|盤|disc/i;
const BUNDLE = /\bset\b|セット|まとめ|bundle|\blot\b|\d+\s*(?:枚|点|pcs|items|albums|cds)|\+|＋|&|、|\betc\b/i;
export function detectKind(title) {
  const t = title || "";
  if (MERCH.test(t)) return CDWORD.test(t) ? "bundle" : "merch";
  if (BUNDLE.test(t) && CDWORD.test(t)) return "bundle";
  return "cd";
}

let h = null;            // helpers from app.js: show, toast, esc, addRelease, lookup
let user = null, list = [], unlisten = null;
const view = { status: "open", layout: "grid", sort: "newest", kind: "all" };
try { Object.assign(view, JSON.parse(localStorage.getItem("discindex.packages.view")) || {}); } catch {}
const saveView = () => { try { localStorage.setItem("discindex.packages.view", JSON.stringify(view)); } catch {} };

export function init(helpers) {
  h = helpers;
  if (!$("pkgGrid")) return;   // an older cached page without the Packages section
  document.querySelectorAll("[data-pstatus]").forEach(b => b.onclick = () => { view.status = b.dataset.pstatus; saveView(); render(); });
  document.querySelectorAll("[data-pview]").forEach(b => b.onclick = () => { view.layout = b.dataset.pview; saveView(); render(); });
  $("pkgSort").onchange = () => { view.sort = $("pkgSort").value; saveView(); render(); };
  if ($("pkgKind")) $("pkgKind").onchange = () => { view.kind = $("pkgKind").value; saveView(); render(); };
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
  $("pkgKindSel").onchange = () => {
    const k = $("pkgKindSel").value;
    if (k === "merch") linked = [];
    if (k === "cd") linked = linked.slice(0, 1);
    $("pkgMatches").innerHTML = ""; $("pkgFindStatus").innerHTML = "";
    showChosen();
  };
  $("pkgChosen").onclick = e => {
    const x = e.target.closest("[data-unlink]");
    if (x) { linked.splice(+x.dataset.unlink, 1); showChosen(); }
  };
  $("pkgEdit").onsubmit = e => { e.preventDefault(); saveFromEditor(); };
  $("pkgArrivedBtn").onclick = () => { const p = editing && byId(editing.id); if (p) { closeEditor(); arrived(p); } };
  $("pkgDeleteBtn").onclick = () => {
    const p = editing && byId(editing.id);
    if (p && confirm(`Delete the package "${p.title}"?`)) { cloud.deletePackage(user.uid, p.id).catch(err => h.toast(cloud.niceError(err))); closeEditor(); }
  };
  document.addEventListener("keydown", e => { if (e.key === "Escape" && !$("pkgModal").hidden) closeEditor(); });
  initImport();
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
  if ($("page-pkgimport")?.classList.contains("on")) openImport();
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
const kindTag = p => {
  const k = kindOf(p);
  if (k === "merch") return "🎁 Merch";
  if (k === "bundle") { const n = releasesOf(p).length; return `📦 Bundle${n ? ` · ${n} CD${n === 1 ? "" : "s"}` : ""}`; }
  return "";
};

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
    .filter(p => view.kind === "all" || kindOf(p) === view.kind)
    .filter(p => !q || [p.title, p.artist, p.shop, p.shopUrl, ...releasesOf(p).map(r => `${r.artist} ${r.title}`)].join(" ").toLowerCase().includes(q))
    .sort(sorters[view.sort] || sorters.newest);
}

function render() {
  const esc = h.esc;
  const inKind = list.filter(p => view.kind === "all" || kindOf(p) === view.kind);
  const counts = { open: inKind.filter(p => p.status !== "arrived").length, all: inKind.length };
  STEPS.forEach(s => counts[s] = inKind.filter(p => p.status === s).length);
  document.querySelectorAll("[data-pstatus]").forEach(b => {
    b.classList.toggle("on", b.dataset.pstatus === view.status);
    b.querySelector("small").textContent = counts[b.dataset.pstatus] || 0;
  });
  document.querySelectorAll("[data-pview]").forEach(b => b.classList.toggle("on", b.dataset.pview === view.layout));
  $("pkgSort").value = view.sort;
  if ($("pkgKind")) {
    const kc = k => list.filter(p => kindOf(p) === k).length;
    $("pkgKind").innerHTML = `<option value="all">All types (${list.length})</option>` +
      ["cd", "bundle", "merch"].map(k => `<option value="${k}">${KIND[k]} (${kc(k)})</option>`).join("");
    $("pkgKind").value = view.kind;
    $("pkgKind").classList.toggle("on", view.kind !== "all");
  }

  const shown = visible();
  $("pkgCount").textContent = `${list.filter(p => p.status !== "arrived").length} on the way`;
  const cover = (p, cls) => p.thumb
    ? `<img class="${cls}" loading="lazy" src="${esc(p.cover || p.thumb)}" alt="">`
    : `<div class="${cls} pkg-ph">${kindOf(p) === "merch" ? "🎁" : "📦"}</div>`;
  const badge = p => `<span class="pkg-badge s-${p.status}">${LABEL[p.status]}</span>`;
  const arrivedBtn = p => p.status === "arrived" ? "" : `<button class="btn small pkg-arrived" title="${kindOf(p) === "merch" ? "Mark as arrived" : "It arrived: add to collection"}">✓ Arrived</button>`;

  $("pkgGrid").hidden = view.layout !== "grid";
  $("pkgTable").hidden = view.layout !== "list";
  $("pkgGrid").innerHTML = shown.map(p => `<div class="item pkg-item" data-pid="${esc(p.id)}">
      <div class="cover-wrap">${cover(p, "cover")}${badge(p)}${kindOf(p) !== "cd" ? `<span class="kind-tag">${esc(kindTag(p))}</span>` : ""}</div>
      <div class="t">${esc(p.title)}</div>
      <div class="a">${esc([p.artist, p.shop].filter(Boolean).join(" · "))}</div>
      <div class="a pkg-when">${esc(when(p))}</div>${arrivedBtn(p)}</div>`).join("");
  $("pkgTable").tBodies[0].innerHTML = shown.map(p => `<tr data-pid="${esc(p.id)}">
      <td>${cover(p, "thumb")}</td><td class="t">${esc(p.title)}</td><td>${esc([p.artist, kindTag(p)].filter(Boolean).join(" · "))}</td>
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

let editing = null;   // the package being edited (null = new)
let linked = [];      // Discogs releases linked to it: one for a CD, several for a bundle
let shopImage = "";   // picture from the shop page, used when there is no Discogs match

function openEditor(p) {
  editing = p ? { ...p } : null;
  linked = p ? releasesOf(p).map(r => ({ ...r })) : [];
  shopImage = p && !linked.length ? (p.thumb || "") : "";
  $("pkgModalTitle").textContent = p ? "Package" : "Add a package";
  $("pkgUrl").value = p?.shopUrl || "";
  $("pkgFindStatus").innerHTML = ""; $("pkgMatches").innerHTML = "";
  $("pkgTitle").value = p?.title || "";
  $("pkgArtist").value = p?.artist || "";
  $("pkgShop").value = p?.shop || "";
  $("pkgDate").value = p?.orderDate || today();
  $("pkgStatus").value = p?.status || "ordered";
  $("pkgKindSel").value = p ? kindOf(p) : "cd";
  $("pkgStatus").querySelector('[value="arrived"]').hidden = !p || p.status !== "arrived";
  $("pkgSaveBtn").textContent = p ? "Save changes" : "+ Add package";
  $("pkgArrivedBtn").hidden = !p || p.status === "arrived";
  $("pkgDeleteBtn").hidden = !p;
  $("pkgShopLink").hidden = !p?.shopUrl; $("pkgShopLink").href = p?.shopUrl || "#";
  showChosen();
  $("pkgModal").hidden = false;
  if (!p) setTimeout(() => $("pkgUrl").focus(), 50);
}
function closeEditor() { $("pkgModal").hidden = true; editing = null; linked = []; }

function showChosen() {
  const esc = h.esc, kind = $("pkgKindSel").value;
  const one = linked.length === 1;
  $("pkgDiscogsLink").hidden = !one; $("pkgDiscogsLink").href = one ? `https://www.discogs.com/release/${linked[0].id}` : "#";
  if (kind === "merch") {
    $("pkgChosen").innerHTML = `<div class="note info">🎁 Merch: no Discogs link needed. "Arrived" only marks it as arrived; nothing is added to your CD collection.</div>`;
    return;
  }
  if (!linked.length) {
    $("pkgChosen").innerHTML = kind === "bundle" ? `<div class="note info">📦 Bundle: search above and click each CD that's in the package. They're all added to your collection when it arrives.</div>` : "";
    return;
  }
  $("pkgChosen").innerHTML = `<div class="linked-head">${kind === "bundle" ? `✓ ${linked.length} CD${linked.length === 1 ? "" : "s"} in this bundle` : "✓ Linked to Discogs"}</div>` +
    linked.map((r, i) => `<div class="res chosen">${r.thumb ? `<img src="${esc(r.thumb)}" alt="">` : ""}<div><b>${esc(r.title)}</b>
      <div class="m">${esc([r.artist, r.label, r.country, r.year, r.format].filter(Boolean).join(" · "))}</div></div>
      <button type="button" class="icon-btn unlink" data-unlink="${i}" title="Remove">✕</button></div>`).join("");
}

const shopName = host => {
  const known = { "mercari": "Mercari", "amazon": "Amazon", "qoo10": "Qoo10", "yesasia": "YesAsia", "ktown4u": "Ktown4u",
    "cdjapan": "CDJapan", "tower": "Tower Records", "hmv": "HMV", "joshinweb": "Joshin", "ebay": "eBay", "aladin": "Aladin",
    "yes24": "YES24", "rakuten": "Rakuten", "acbuy": "acbuy", "buyee": "Buyee", "zenmarket": "ZenMarket", "discogs": "Discogs",
    "musicplaza": "Music Plaza", "kpopalbums": "Kpopalbums", "weverse": "Weverse", "makestar": "Makestar", "jpopsuki": "JPopsuki", "fril": "Rakuma" };
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
    .replace(/\b(cd|import|sealed|new|used|pre-?order|free shipping|official|album|mini|full|signed|\d+(?:st|nd|rd|th))\b/gi, " ")
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
    // several links pasted at once (a one-line box removes line breaks, so split at each "http")
    const urls = input.match(/https?:\/\/.+?(?=https?:\/\/|[\s"'<>]|$)/g) || [];
    if (urls.length > 1) { closeEditor(); return startImport({ from: "pasted links", items: urls.map(url => ({ url, title: "", image: "" })) }); }
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
      const title = info.title || info.urlWords || "";
      if (!editing && title) $("pkgKindSel").value = detectKind(title);
      if (!$("pkgTitle").value && title) $("pkgTitle").value = ($("pkgKindSel").value === "merch" ? title.replace(/の通販 by .*$|\s*by\s*(?:メルカリ|mercari)\s*$/i, "") : cleanTitle(title)).trim().slice(0, 120);
      if ($("pkgKindSel").value === "merch") { showChosen(); status("🎁 Looks like merch, so no Discogs search. Change the type if it's a CD.", "ok"); return; }
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

const splitArtist = t => (t || "").includes(" - ") ? [discogs.clean(t.split(" - ")[0]), t.split(" - ").slice(1).join(" - ")] : ["", t || ""];

function showMatches(results, info) {
  const esc = h.esc;
  const status = $("pkgFindStatus");
  const bundle = $("pkgKindSel").value === "bundle";
  if (!results.length) {
    status.innerHTML = `<div class="note warn">No match on Discogs${info?.title ? ` for "<b>${esc(cleanTitle(info.title))}</b>"` : ""}.
      Try typing the artist and album in the box, or just fill in the fields below.</div>`;
    return;
  }
  const how = results[0].how;
  status.innerHTML = `<div class="note ${how === "barcode" ? "ok" : "info"}">Found ${results.length} match${results.length === 1 ? "" : "es"} by ${how}${info?.blocked ? " (the shop blocked reading the page, so this came from the link)" : ""}.
    ${bundle ? "Click every CD that's in the bundle:" : "Pick the right one:"}</div>`;
  $("pkgMatches").innerHTML = results.map((r, i) => {
    const v = discogs.toVersion(r);
    const [artist, title] = splitArtist(r.title);
    return `<div class="res${linked.some(l => l.id === r.id) ? " on" : ""}" data-i="${i}"><img loading="lazy" src="${esc(v.thumb)}" alt="">
      <div><b>${esc(title)}</b><div class="m">${esc([artist, v.year, v.country, v.label, v.catno, v.format].filter(Boolean).join(" · "))}</div></div></div>`;
  }).join("");
  $("pkgMatches").querySelectorAll("[data-i]").forEach(el => el.onclick = () => {
    if (!bundle) $("pkgMatches").querySelectorAll(".res").forEach(x => x.classList.toggle("on", x === el));
    else el.classList.add("on");
    pick(results[+el.dataset.i]);
  });
  if (results.length === 1 && !bundle) $("pkgMatches").querySelector(".res").click();
}

// Use a Discogs release: for a CD it replaces the link (and fills in album and artist), for a bundle it's added.
async function pick(r) {
  const bundle = $("pkgKindSel").value === "bundle";
  if (bundle && linked.some(l => l.id === r.id)) return;
  try {
    const rel = await discogs.getRelease(r.id);
    const item = discogs.releaseToItem(rel);
    const v = r.title ? discogs.toVersion(r) : {};
    const entry = { id: rel.id, title: item.title, artist: item.artist, thumb: item.thumb || v.thumb || "", cover: item.cover || "",
      label: item.label, country: item.country, year: item.year, format: item.format };
    if (bundle) {
      linked.push(entry);
    } else {
      linked = [entry];
      $("pkgTitle").value = item.title;
      $("pkgArtist").value = item.artist;
    }
    if (!$("pkgTitle").value) $("pkgTitle").value = item.title;
    showChosen();
  } catch (e) { h.toast(e.message); }
}

const slim = r => ({ id: r.id, title: r.title || "", artist: r.artist || "", thumb: r.thumb || "", cover: r.cover || "" });

async function saveFromEditor() {
  const title = $("pkgTitle").value.trim();
  if (!title) { $("pkgTitle").focus(); return; }
  const url = $("pkgUrl").value.trim();
  const kind = $("pkgKindSel").value;
  const rels = kind === "merch" ? [] : linked.map(slim);
  const p = {
    ...(editing || { id: `p${Date.now()}`, created: new Date().toISOString(), arrivedDate: "" }),
    kind,
    title,
    artist: $("pkgArtist").value.trim(),
    shop: $("pkgShop").value.trim(),
    shopUrl: /^https?:\/\//i.test(url) && !discogs.parseUrl(url) ? url : (editing?.shopUrl || ""),
    orderDate: $("pkgDate").value || today(),
    status: $("pkgStatus").value,
    releases: rels,
    releaseId: rels[0]?.id || null,
    thumb: rels[0]?.thumb || shopImage || editing?.thumb || "",
    cover: rels[0]?.cover || shopImage || editing?.cover || "",
  };
  const isNew = !editing;
  closeEditor();
  await save(p);
  h.toast(isNew ? `Added package: ${title}` : "Saved");
}

// Mark as arrived. CDs go into the collection; for a bundle every CD in it; merch only gets marked.
async function arrived(p) {
  const kind = kindOf(p), rels = releasesOf(p);
  const done = { ...p, status: "arrived", arrivedDate: today() };
  if (kind === "merch") {
    if (!confirm(`"${p.title}" arrived? (Merch: nothing is added to your CD collection.)`)) return;
    await save(done);
    h.toast("Marked as arrived");
    return;
  }
  if (kind === "bundle" && rels.length) {
    if (!confirm(`Bundle "${p.title}" arrived? ${rels.length} CD${rels.length === 1 ? "" : "s"} will be added to your collection.`)) return;
    const keys = [];
    for (const r of rels) { const key = await h.addRelease(r.id, { quiet: true }); if (key) keys.push(key); }
    done.collectionKeys = keys;
    await save(done);
    h.toast(`Added ${keys.length} CD${keys.length === 1 ? "" : "s"} from the bundle to your collection`);
    location.hash = "#/";
    return;
  }
  if (!confirm(`"${p.title}" arrived? It will be marked as arrived and added to your collection.`)) return;
  if (rels.length) {
    const key = await h.addRelease(rels[0].id);
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

// ---------- import many items at once (bookmark button or several pasted links) ----------

const PENDING = "discindex.pendingImport";
let imp = null;   // { from, items: [{ url, title, image, kind, state, matches, pick, picks, checked, note }] }

// The bookmark button. It runs on the shop page (e.g. ZenMarket "My orders"), in the user's own browser,
// collects item links and opens Discindex with them. Nothing is sent anywhere else.
function bookmarklet() {
  var P = [/itemcode=/i, /jp\.mercari\.com\/(?:[a-z]{2}\/)?(?:item|shops\/product)\//i, /item\.fril\.jp\/[0-9a-f]{32}/i,
    /auctions\.yahoo\.co\.jp\/.*auction\/[a-z]?\d+/i, /buyee\.jp\/.*(?:item|auction)\//i, /discogs\.com\/(?:[^\/]+\/)?release\/\d+/i];
  var map = {}, order = [];
  document.querySelectorAll("a[href]").forEach(function (a) {
    var h = a.href.split("#")[0];
    if (!P.some(function (r) { return r.test(h); })) return;
    var img = a.querySelector("img");
    var t = (a.textContent || (img && img.alt) || a.title || "").replace(/\s+/g, " ").trim();
    if (!map[h]) { map[h] = { url: h, title: "", image: "" }; order.push(h); }
    if (t.length > map[h].title.length) map[h].title = t.slice(0, 160);
    if (img && !map[h].image) map[h].image = img.currentSrc || img.src;
  });
  var items = order.map(function (k) { return map[k]; });
  if (!items.length && P.some(function (r) { return r.test(location.href); })) items.push({ url: location.href, title: document.title, image: "" });
  if (!items.length) { alert("Discindex: no shop items found on this page. Open your order list and try again."); return; }
  window.open("https://discindex.pages.dev/#/import/" + encodeURIComponent(JSON.stringify({ from: location.hostname, items: items.slice(0, 80) })), "_blank");
}
export const bookmarkletHref = () => "javascript:" + encodeURIComponent("(" + bookmarklet.toString() + ")()");

// Called by the router for #/import/<data>: keep the data, then show the import page.
export function startImport(data) {
  try {
    const d = typeof data === "string" ? JSON.parse(decodeURIComponent(data)) : data;
    if (!d?.items?.length) throw new Error("empty");
    sessionStorage.setItem(PENDING, JSON.stringify(d));
    imp = null;
  } catch { h.toast("That import link didn't contain any items."); }
  if (location.hash !== "#/import") location.hash = "#/import"; else openImport();
}

export function openImport() {
  h.show("pkgimport");
  if (!user) {
    $("impBody").innerHTML = `<p class="note info">Sign in with your Google account to import packages. Your items are waiting.</p>`;
    $("impAdd").disabled = true;
    return;
  }
  if (!imp) {
    let d = null;
    try { d = JSON.parse(sessionStorage.getItem(PENDING)); } catch {}
    if (!d?.items?.length) {
      $("impBody").innerHTML = `<p class="hint">Nothing to import. Use the 📦 Discindex button on a shop page, or paste several links in "Add package".</p>`;
      $("impAdd").disabled = true;
      return;
    }
    const have = new Set(list.map(p => p.shopUrl).filter(Boolean));
    imp = { from: d.from, items: d.items.map(it => ({ ...it, kind: detectKind(it.title), state: "waiting", searched: false, matches: [], pick: 0, picks: [],
      checked: !have.has(it.url), note: have.has(it.url) ? "Already in your packages" : "" })) };
    const n = k => imp.items.filter(it => it.kind === k).length;
    $("impFrom").textContent = `${imp.items.length} item${imp.items.length === 1 ? "" : "s"} from ${d.from} · ${n("cd")} CDs, ${n("bundle")} bundles, ${n("merch")} merch (guessed, change if wrong)`;
    $("impDate").value = today();
    renderImport();
    findAllMatches();
  } else renderImport();
}

function renderImport() {
  const esc = h.esc;
  $("impBody").innerHTML = imp.items.map((it, i) => {
    let match;
    if (it.kind === "merch") match = `<span class="hint">🎁 Merch: no Discogs search. It's tracked as a package but not added to your CD collection.</span>`;
    else if (it.state === "waiting") match = `<span class="hint">Waiting…</span>`;
    else if (it.state === "busy") match = `<span class="hint"><span class="spinner"></span>Finding on Discogs…</span>`;
    else if (!it.matches.length) match = `<span class="hint">No Discogs match: it will be added by name${it.error ? ` (${esc(it.error)})` : ""}</span>`;
    else if (it.kind === "bundle") match = `<div class="imp-bundle"><span class="hint">Tick the CDs in this bundle:</span>${it.matches.map((x, j) =>
        `<label class="imp-b"><input type="checkbox" data-bpick="${i}:${j}"${it.picks.includes(j) ? " checked" : ""}>${x.thumb ? `<img src="${esc(x.thumb)}" alt="">` : ""}<span>${esc(x.label)}</span></label>`).join("")}</div>`;
    else {
      const m = it.matches[it.pick];
      match = `<div class="imp-pick">${m?.thumb ? `<img src="${esc(m.thumb)}" alt="">` : ""}
      <select data-pick="${i}">${it.matches.map((x, j) => `<option value="${j}"${j === it.pick ? " selected" : ""}>${esc(x.label)}</option>`).join("")}
        <option value="-1"${it.pick === -1 ? " selected" : ""}>None of these: add by name</option></select></div>`;
    }
    const name = it.title || it.pageTitle || it.url;
    return `<div class="imp-row${it.checked ? "" : " off"}">
      <input type="checkbox" data-check="${i}"${it.checked ? " checked" : ""} aria-label="Import this item">
      ${it.image ? `<img class="imp-img" src="${esc(it.image)}" alt="" loading="lazy">` : `<div class="imp-img pkg-ph">${it.kind === "merch" ? "🎁" : "📦"}</div>`}
      <div class="imp-shop"><b>${esc(name)}</b><div class="m">${esc(shopName(hostOf(it.url)))}${it.note ? ` · ${esc(it.note)}` : ""}</div>
        <select class="imp-kind" data-kind="${i}" aria-label="Type">${Object.entries(KIND).map(([k, l]) => `<option value="${k}"${k === it.kind ? " selected" : ""}>${l}</option>`).join("")}</select></div>
      <div class="imp-match">${match}</div></div>`;
  }).join("");
  const n = imp.items.filter(it => it.checked).length;
  $("impAdd").disabled = !n;
  $("impAdd").textContent = `Add ${n} package${n === 1 ? "" : "s"}`;
  $("impBody").querySelectorAll("[data-check]").forEach(el => el.onchange = () => { imp.items[+el.dataset.check].checked = el.checked; renderImport(); });
  $("impBody").querySelectorAll("[data-pick]").forEach(el => el.onchange = () => { imp.items[+el.dataset.pick].pick = +el.value; renderImport(); });
  $("impBody").querySelectorAll("[data-bpick]").forEach(el => el.onchange = () => {
    const [i, j] = el.dataset.bpick.split(":").map(Number), it = imp.items[i];
    it.picks = el.checked ? [...new Set([...it.picks, j])] : it.picks.filter(x => x !== j);
  });
  $("impBody").querySelectorAll("[data-kind]").forEach(el => el.onchange = () => {
    const it = imp.items[+el.dataset.kind];
    it.kind = el.value;
    if (it.kind !== "merch" && !it.searched && it.state === "done") { it.state = "waiting"; findAllMatches(); }
    renderImport();
  });
}

const hostOf = u => { try { return new URL(u).hostname; } catch { return ""; } };

async function lookupItem(it) {
  it.state = "busy"; renderImport();
  try {
    const link = discogs.parseUrl(it.url);
    let results;
    if (link?.kind === "release") results = [{ id: link.id, title: it.title || `Release ${link.id}` }];
    else {
      const info = await fetch(`${API}/api/page-info?url=${encodeURIComponent(it.url)}`).then(r => r.json()).catch(() => ({}));
      it.pageTitle = info.title || "";
      if (!it.image && info.image) it.image = info.image;
      results = await searchAll({ title: info.title || it.title, urlWords: [it.title, info.urlWords].filter(Boolean).join(" "),
        barcodes: info.barcodes || [], catnos: info.catnos || [] });
    }
    it.matches = results.slice(0, 6).map(r => {
      const v = discogs.toVersion(r);
      const [artist, title] = splitArtist(r.title);
      return { id: r.id, artist, title, thumb: v.thumb, cover: r.cover_image || v.thumb,
        label: [artist, title].filter(Boolean).join(" – ") + " · " + [v.country, v.year, v.catno].filter(Boolean).join(" ") + (r.how ? ` (by ${r.how})` : "") };
    });
    it.pick = it.matches.length ? 0 : -1;
    it.picks = [];
    it.error = "";
  } catch (e) { it.error = e.message; it.matches = []; it.pick = -1; }
  it.searched = true;
  it.state = "done";
}

// Look up the items one after another (Discogs allows about one request per second).
let lookingUp = false;
async function findAllMatches() {
  if (lookingUp) return;          // the running loop will pick up newly waiting items
  lookingUp = true;
  const run = imp;
  try {
    for (let it; imp === run && (it = run.items.find(x => x.state === "waiting" && x.checked && x.kind !== "merch"));) {
      await lookupItem(it);
      if (imp === run) renderImport();
    }
    if (imp === run) { run.items.forEach(x => { if (x.state === "waiting") x.state = "done"; }); renderImport(); }
  } finally { lookingUp = false; }
}

async function addImported() {
  const status = $("impStatus").value, date = $("impDate").value || today();
  const chosen = imp.items.filter(it => it.checked);
  if (chosen.some(it => it.kind !== "merch" && it.state !== "done") && !confirm("Some items are still being looked up. Add them by name for now?")) return;
  let n = 0;
  for (const it of chosen) {
    const name = it.title || it.pageTitle || it.url;
    let rels = [];
    if (it.kind === "cd" && it.pick >= 0 && it.matches[it.pick]) rels = [it.matches[it.pick]];
    if (it.kind === "bundle") rels = it.picks.map(j => it.matches[j]).filter(Boolean);
    const one = it.kind === "cd" ? rels[0] : null;
    const artists = [...new Set(rels.map(r => r.artist).filter(Boolean))];
    await save({
      id: `p${Date.now()}${n}`, created: new Date().toISOString(), arrivedDate: "",
      kind: it.kind,
      title: one?.title || (it.kind === "merch" ? name.replace(/の通販 by .*$/, "").trim() : cleanTitle(name) || name),
      artist: one?.artist || (artists.length === 1 ? artists[0] : ""),
      shop: shopName(hostOf(it.url)), shopUrl: it.url,
      orderDate: date, status,
      releases: rels.map(slim),
      releaseId: rels[0]?.id || null,
      thumb: it.kind === "cd" && one ? one.thumb : (it.image || rels[0]?.thumb || ""),
      cover: it.kind === "cd" && one ? one.cover : (it.image || rels[0]?.cover || ""),
    });
    n++;
  }
  sessionStorage.removeItem(PENDING); imp = null;
  h.toast(`Added ${n} package${n === 1 ? "" : "s"}`);
  location.hash = "#/packages";
}

function initImport() {
  if (!$("impAdd")) return;
  $("impAdd").onclick = addImported;
  $("impCancel").onclick = () => { sessionStorage.removeItem(PENDING); imp = null; location.hash = "#/packages"; };
  $("impAll").onclick = () => {
    if (!imp) return;
    const on = imp.items.some(it => !it.checked);
    imp.items.forEach(it => it.checked = on);
    renderImport();
    findAllMatches();
  };
  if ($("bmLink")) $("bmLink").href = bookmarkletHref();
}
