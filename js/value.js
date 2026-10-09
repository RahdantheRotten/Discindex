// What is a CD worth? Collects prices from Discogs (automatic) and DBA (automatic, via /api/dba),
// and makes links to eBay sold listings, Resellbot and Vinted (they can't be read automatically).
// The result is saved on the item as item.value, with the date it was checked.
import * as discogs from "./discogs.js";

// /api/dba runs on Cloudflare (discindex.pages.dev); other addresses call it there.
const API = /pages\.dev$|^localhost$|^127\.0\.0\.1$/.test(location.hostname) ? "" : "https://discindex.pages.dev";

let rates = null;   // { DKK: 1, USD: 0.15, EUR: 0.134 } relative to DKK
async function getRates() {
  if (rates) return rates;
  try {
    const r = await fetch("https://api.frankfurter.dev/v1/latest?base=DKK&symbols=USD,EUR").then(r => r.json());
    rates = { DKK: 1, ...r.rates };
  } catch { rates = { DKK: 1, USD: 0.15, EUR: 0.134 }; }   // rough fallback if the rate service is down
  return rates;
}
// convert an amount from one currency to another (via DKK)
async function convert(amount, from, to) {
  if (amount == null || from === to) return amount;
  const r = await getRates();
  if (!r[from] && from !== "DKK") return null;
  const inDkk = from === "DKK" ? amount : amount / r[from];
  return to === "DKK" ? inDkk : inDkk * r[to];
}

const median = nums => {
  const s = [...nums].sort((a, b) => a - b), m = Math.floor(s.length / 2);
  return s.length ? (s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2) : null;
};

const words = t => (t || "").toLowerCase().normalize("NFKC").replace(/\(\d+\)/g, " ").split(/[^\p{L}\p{N}]+/u).filter(w => w.length >= 2);
const NOT_THE_CD = /fotokort|photo ?cards?|\bpc\b|poster|plakat|lightstick|light stick|t-?shirt|sticker|merch|vinyl|\blp\b|kassette|cassette|dvd|blu-?ray/i;
const IS_THE_CD = /\bcd\b|album|cd'?er/i;

// A DBA listing counts when it mentions the album (and the artist, for short titles) and isn't merch/vinyl.
function matches(listing, item) {
  const text = listing.title.toLowerCase().normalize("NFKC");
  const titleWords = words(item.title).filter(w => !["the", "and", "of", "ver", "version", "edition", "album", "mini", "cd"].includes(w));
  const artistWords = words(item.artist);
  const hitsTitle = titleWords.filter(w => text.includes(w)).length;
  const hitsArtist = artistWords.some(w => text.includes(w));
  const enoughTitle = titleWords.length ? hitsTitle >= Math.max(1, Math.ceil(titleWords.length * 0.5)) : false;
  if (!enoughTitle) return false;
  // the artist must be mentioned (except for "Various" compilations)
  if (artistWords.length && !/^various/i.test(item.artist || "") && !hitsArtist) return false;
  // one-word or self-titled albums ("Kara" by Kara): the listing must also say it's a CD/album
  const selfTitled = titleWords.every(w => artistWords.includes(w));
  if ((titleWords.length < 2 || selfTitled) && !/cd|album|k-?pop|cd'?er/i.test(text)) return false;
  if (NOT_THE_CD.test(text) && !IS_THE_CD.test(text)) return false;
  return true;
}

export function searchWords(item) {
  return `${(item.artist || "").replace(/\s*\(\d+\)/g, "")} ${item.title}`.replace(/\s+/g, " ").trim();
}

export function links(item, currency) {
  const q = encodeURIComponent(searchWords(item));
  const dk = currency === "DKK";
  return {
    ebaySold: `https://www.ebay.${dk ? "de" : "com"}/sch/i.html?_nkw=${q}+cd&LH_Sold=1&LH_Complete=1`,
    resellbot: `https://resellbot.com/ebay-sold-listings/?q=${q}+cd`,
    vinted: `https://www.vinted.${dk ? "dk" : "com"}/catalog?search_text=${q}`,
    dba: `https://www.dba.dk/recommerce/forsale/search?q=${q}`,
    discogs: `https://www.discogs.com/sell/release/${item.id}`,
  };
}

// Look up everything and return a value object to save on the item.
export async function check(item, currency) {
  const v = { at: new Date().toISOString(), currency, sources: {} };
  const [stats, sugg, dba] = await Promise.all([
    discogs.marketStats(item.id, currency).catch(e => ({ error: e.message })),
    discogs.priceSuggestions(item.id).catch(e => ({ error: e.message })),
    fetch(`${API}/api/dba?q=${encodeURIComponent(searchWords(item))}`).then(r => r.json()).catch(() => ({ error: "Couldn't reach DBA" })),
  ]);

  // Discogs: cheapest now, and the sales-based suggestion for "Near Mint" (good used condition)
  const d = { forSale: stats.num_for_sale ?? null, lowest: stats.lowest_price ? await convert(stats.lowest_price.value, stats.lowest_price.currency, currency) : null };
  const nm = sugg["Near Mint (NM or M-)"] || sugg["Very Good Plus (VG+)"];
  if (nm) d.suggested = await convert(nm.value, nm.currency, currency);
  else d.needsSellerSettings = /seller settings/i.test(sugg.error || "");
  if (stats.error) d.error = stats.error;
  v.sources.discogs = d;

  // DBA: asking prices of the listings that are this CD
  if (dba.listings) {
    const hits = dba.listings.filter(l => matches(l, item));
    const med = median(hits.map(l => l.price));
    v.sources.dba = {
      count: hits.length,
      median: med == null ? null : await convert(med, "DKK", currency),
      listings: hits.slice(0, 5).map(l => ({ title: l.title, price: l.price, url: l.url, place: l.place })),
    };
  } else v.sources.dba = { error: dba.error || "No answer from DBA" };

  // Estimate: average of what we have. Discogs' sales-based price counts first; otherwise its cheapest price.
  const parts = [d.suggested ?? d.lowest, v.sources.dba.median].filter(x => x != null);
  v.estimate = parts.length ? parts.reduce((a, b) => a + b, 0) / parts.length : null;
  return v;
}

export function money(amount, currency) {
  if (amount == null) return "–";
  return new Intl.NumberFormat(currency === "DKK" ? "da-DK" : "en-US", { style: "currency", currency, maximumFractionDigits: currency === "DKK" ? 0 : 2 }).format(amount);
}
