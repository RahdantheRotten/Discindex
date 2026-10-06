// Packages: follow CDs you've ordered until they arrive. Only shown to the owner's account.
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

let h = null;            // helpers from app.js: show, toast, esc, addRelease, lookup
let user = null, list = [], unlisten = null, linked = null;

export function init(helpers) {
  h = helpers;
  if (!$("pkgForm")) return;   // an older cached page without the Packages section
  $("pkgDate").value = today();
  $("pkgForm").onsubmit = e => { e.preventDefault(); addFromForm(); };
  $("pkgLink").onchange = fillFromLink;
  $("pkgList").onclick = onListClick;
  $("pkgList").onchange = e => {
    const sel = e.target.closest(".pkg-status");
    if (!sel) return;
    const p = byId(sel.closest("[data-id]").dataset.id);
    if (sel.value === "arrived") { sel.value = p.status; return arrived(p); }
    save({ ...p, status: sel.value });
  };
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
    if ($("page-packages").classList.contains("on")) render();
  });
}

export function open() {
  if (!user) { location.hash = "#/"; return; }
  h.show("packages");
  render();
}

const byId = id => list.find(p => p.id === id);

function save(p) {
  return cloud.savePackage(user.uid, p).catch(e => h.toast("Couldn't save: " + cloud.niceError(e)));
}

// ---- adding ----

async function fillFromLink() {
  linked = null;
  const link = discogs.parseUrl($("pkgLink").value.trim());
  $("pkgLinkMsg").textContent = "";
  if (!link) return;
  if (link.kind !== "release") {
    $("pkgLinkMsg").textContent = "Use the link of the exact release (…/release/…), not the master page.";
    return;
  }
  $("pkgLinkMsg").innerHTML = '<span class="spinner"></span>Getting info from Discogs…';
  try {
    const r = await discogs.getRelease(link.id);
    const item = discogs.releaseToItem(r);
    linked = { releaseId: r.id, thumb: item.thumb || item.cover || "" };
    $("pkgTitle").value = item.title;
    $("pkgArtist").value = item.artist;
    $("pkgLinkMsg").textContent = `✓ ${item.title} by ${item.artist}${item.year ? ` (${item.year})` : ""}`;
  } catch (e) {
    $("pkgLinkMsg").textContent = e.message;
  }
}

async function addFromForm() {
  const title = $("pkgTitle").value.trim();
  if (!title) { $("pkgTitle").focus(); return; }
  const p = {
    id: `p${Date.now()}`,
    title,
    artist: $("pkgArtist").value.trim(),
    shop: $("pkgShop").value.trim(),
    orderDate: $("pkgDate").value || today(),
    status: $("pkgStatus").value,
    releaseId: linked?.releaseId || null,
    thumb: linked?.thumb || "",
    arrivedDate: "",
    created: new Date().toISOString(),
  };
  await save(p);
  h.toast(`Added package: ${title}`);
  $("pkgForm").reset(); $("pkgDate").value = today(); $("pkgLinkMsg").textContent = ""; linked = null;
}

// ---- list ----

function ago(date) {
  const d = Math.round((Date.parse(today()) - Date.parse(date)) / 86400000);
  return d <= 0 ? "today" : d === 1 ? "yesterday" : `${d} days ago`;
}
const nice = date => date ? new Date(date + "T12:00").toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" }) : "";

function row(p) {
  const esc = h.esc;
  const meta = [p.artist, p.shop, p.status === "arrived" ? `arrived ${nice(p.arrivedDate)}` : `ordered ${nice(p.orderDate)} (${ago(p.orderDate)})`]
    .filter(Boolean).map(esc).join(" · ");
  const thumb = p.thumb ? `<img src="${esc(p.thumb)}" alt="" loading="lazy">` : `<div class="pkg-ph">📦</div>`;
  const right = p.status === "arrived"
    ? (p.collectionKey ? `<a class="btn ghost small" href="#/album/${encodeURIComponent(p.collectionKey)}">Open in collection</a>` : `<span class="hint">In collection</span>`)
    : `<select class="pkg-status" aria-label="Status">${STEPS.map(s => `<option value="${s}"${s === p.status ? " selected" : ""}>${LABEL[s]}</option>`).join("")}</select>
       <button class="btn small pkg-arrived">✓ Arrived</button>`;
  return `<div class="pkg" data-id="${esc(p.id)}">${thumb}
    <div class="pkg-main"><b>${esc(p.title)}</b><div class="m">${meta}</div>
      <div class="pkg-steps">${STEPS.map(s => `<span class="${STEPS.indexOf(s) <= STEPS.indexOf(p.status) ? "done" : ""}">${LABEL[s]}</span>`).join("")}</div></div>
    <div class="pkg-actions">${right}<button class="icon-btn pkg-del" title="Delete package">🗑</button></div></div>`;
}

function render() {
  const active = list.filter(p => p.status !== "arrived").sort((a, b) => (b.orderDate || "").localeCompare(a.orderDate || ""));
  const done = list.filter(p => p.status === "arrived").sort((a, b) => (b.arrivedDate || "").localeCompare(a.arrivedDate || ""));
  $("pkgCount").textContent = active.length ? `${active.length} on the way` : "Nothing on the way";
  $("pkgList").innerHTML =
    (active.length ? active.map(row).join("") : `<p class="hint pkg-empty">No packages on the way. Add one above when you order a CD.</p>`)
    + (done.length ? `<details class="pkg-done"><summary>Arrived (${done.length})</summary>${done.map(row).join("")}</details>` : "");
}

async function onListClick(e) {
  const el = e.target.closest("[data-id]");
  if (!el) return;
  const p = byId(el.dataset.id);
  if (e.target.closest(".pkg-arrived")) arrived(p);
  if (e.target.closest(".pkg-del") && confirm(`Delete the package "${p.title}"?`)) {
    cloud.deletePackage(user.uid, p.id).catch(err => h.toast(cloud.niceError(err)));
  }
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
