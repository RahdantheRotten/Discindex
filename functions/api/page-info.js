// Cloudflare Pages Function: GET /api/page-info?url=<shop page>
// Opens a shop page on the server (browsers aren't allowed to read other sites) and returns only
// what Discindex needs to find the album on Discogs: title, picture, barcodes and catalog numbers.

const MAX_BYTES = 2_000_000;
const CORS = { "Access-Control-Allow-Origin": "*", "Content-Type": "application/json; charset=utf-8" };
const json = (data, status = 200) => new Response(JSON.stringify(data), { status, headers: { ...CORS, "Cache-Control": "public, max-age=300" } });

export async function onRequestGet({ request }) {
  const target = new URL(request.url).searchParams.get("url") || "";
  let url;
  try { url = new URL(target); } catch { return json({ error: "That isn't a web address." }, 400); }
  if (!/^https?:$/.test(url.protocol)) return json({ error: "Only http and https links work." }, 400);

  const fromUrl = urlHints(url);
  const site = url.hostname.replace(/^www\./, "");
  // Proxy shops (ZenMarket, Buyee) block reading, but their links contain the original item: read that instead.
  const source = sourceUrl(url) || url;
  let res;
  try {
    res = await fetch(source.toString(), {
      redirect: "follow",
      headers: {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0 Safari/537.36",
        "Accept": "text/html,application/xhtml+xml",
        "Accept-Language": "en,ja;q=0.9,ko;q=0.8",
      },
    });
  } catch {
    res = null;
  }
  // Some shops block automatic reading; then we still have what the link itself says.
  if (!res || !res.ok) {
    return json({ url: target, site, blocked: true, title: "", urlWords: fromUrl.words, image: "", barcodes: fromUrl.barcodes, catnos: fromUrl.catnos });
  }
  const html = await readLimited(res);
  const info = extract(html);
  return json({
    url: target, finalUrl: res.url, site, source: source.hostname.replace(/^www\./, ""), ...info,
    urlWords: fromUrl.words,
    barcodes: [...new Set([...info.barcodes, ...fromUrl.barcodes])],
    catnos: [...new Set([...info.catnos, ...fromUrl.catnos])],
  });
}

// ZenMarket / Buyee item link -> the Mercari, Rakuma or Yahoo Auctions page it points to
export function sourceUrl(url) {
  const host = url.hostname.replace(/^www\./, "");
  const code = url.searchParams.get("itemCode") || url.searchParams.get("itemcode") || "";
  const path = url.pathname;
  if (host.endsWith("zenmarket.jp")) {
    const shop = (url.searchParams.get("shop") || "").toLowerCase();
    if (shop === "amazon" && /^[A-Z0-9]{10}$/i.test(code)) return new URL(`https://www.amazon.co.jp/dp/${code}`);
    if (shop === "bookoff" && /^\d{8,12}$/.test(code)) return new URL(`https://shopping.bookoff.co.jp/used/${code}`);
    if (/mercari/i.test(path) && /^m\d+$/.test(code)) return new URL(`https://jp.mercari.com/item/${code}`);
    if (/rakuma|fril/i.test(path) && /^[0-9a-f]{32}$/i.test(code)) return new URL(`https://item.fril.jp/${code}`);
    if (/auction|yahoo/i.test(path) && /^[a-z]?\d+$/i.test(code)) return new URL(`https://page.auctions.yahoo.co.jp/jp/auction/${code}`);
  }
  if (host.endsWith("buyee.jp")) {
    const m = path.match(/\/mercari\/item\/(m\d+)/i); if (m) return new URL(`https://jp.mercari.com/item/${m[1]}`);
    const r = path.match(/\/rakuma\/item\/([0-9a-f]{32})/i); if (r) return new URL(`https://item.fril.jp/${r[1]}`);
    const y = path.match(/\/item\/(?:yahoo\/)?auction\/([a-z]?\d+)/i); if (y) return new URL(`https://page.auctions.yahoo.co.jp/jp/auction/${y[1]}`);
  }
  return null;
}

// What the address itself tells us, e.g. joshinweb.jp/dp/8809440338757.html or qoo10…/TWICE-FANCY-YOU/1042790435
export function urlHints(url) {
  let path = url.pathname;
  try { path = decodeURIComponent(path); } catch {}
  const all = path + " " + url.search;
  const barcodes = [...all.matchAll(/(?<!\d)(\d{12,13})(?!\d)/g)].map(m => m[1]).filter(validBarcode);
  const catnos = [...all.toUpperCase().matchAll(/(?<![A-Z0-9])([A-Z]{3,5}-\d{4,6})(?!\d)/g)].map(m => m[1]);
  // the longest readable piece of the path, with dashes turned into spaces
  const words = path.split("/").map(p => p.replace(/\.(html?|php|aspx?)$/i, "").replace(/[-_+]+/g, " ").trim())
    .filter(p => /[\p{L}]{2,}/u.test(p) && !/^[0-9a-f]{16,}$/i.test(p) && !/^[a-z]?\d+$/i.test(p) && !/^(item|items|dp|product|products|goods|detail|itm|p|en|ja|jp|ko|kr|shop|music|cd|mercariproduct|rakumaproduct|auction|used|new)$/i.test(p))
    .sort((a, b) => b.length - a.length)[0] || "";
  return { barcodes, catnos, words };
}

async function readLimited(res) {
  const reader = res.body.getReader();
  const chunks = []; let size = 0;
  while (size < MAX_BYTES) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value); size += value.length;
  }
  try { reader.cancel(); } catch {}
  const buf = new Uint8Array(size); let pos = 0;
  for (const c of chunks) { buf.set(c.subarray(0, Math.min(c.length, size - pos)), pos); pos += c.length; }
  const head = new TextDecoder("latin1").decode(buf.subarray(0, 4000));
  const charset = (head.match(/charset=["']?([\w-]+)/i) || [])[1] || "utf-8";
  try { return new TextDecoder(charset).decode(buf); } catch { return new TextDecoder().decode(buf); }
}

const decode = s => (s || "")
  .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCodePoint(parseInt(h, 16)))
  .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(+d))
  .replace(/&quot;/g, '"').replace(/&#39;|&apos;/g, "'").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&amp;/g, "&")
  .replace(/\s+/g, " ").trim();

function meta(html, name) {
  const re = new RegExp(`<meta[^>]+(?:property|name)=["']${name}["'][^>]*>`, "i");
  const tag = (html.match(re) || [])[0];
  return tag ? decode((tag.match(/content=["']([^"']*)["']/i) || [])[1]) : "";
}

// EAN-13 / UPC-A check digit, so random 13-digit numbers aren't mistaken for barcodes
function validBarcode(code) {
  if (!/^\d{12,13}$/.test(code)) return false;
  const d = code.padStart(13, "0").split("").map(Number);
  const sum = d.slice(0, 12).reduce((n, x, i) => n + x * (i % 2 ? 3 : 1), 0);
  return (10 - sum % 10) % 10 === d[12];
}

export function extract(html) {
  // Amazon: the product title and the artist line
  const amazonTitle = decode(((html.match(/id=["']productTitle["'][^>]*>([\s\S]*?)<\/span>/i) || [])[1] || "").replace(/<[^>]+>/g, " "));
  const byline = decode(((html.match(/id=["']bylineInfo["'][^>]*>([\s\S]*?)<\/div>/i) || [])[1] || "").replace(/<[^>]+>/g, " "));
  const artist = byline.split(/形式|Format|\(アーティスト\)|\(Artist\)|ブランド|Brand|Visit the/)[0].replace(/[,、\s]+$/, "").trim().normalize("NFKC");
  if (amazonTitle) {
    const t = amazonTitle.normalize("NFKC");
    return finish(t, artist);
  }
  // shops sometimes shorten one of these, so take the longest
  const title = [meta(html, "og:title"), meta(html, "twitter:title"),
    decode((html.match(/<title[^>]*>([\s\S]*?)<\/title>/i) || [])[1]),
    decode(((html.match(/<h1[^>]*>([\s\S]*?)<\/h1>/i) || [])[1] || "").replace(/<[^>]+>/g, ""))]
    .filter(Boolean).sort((a, b) => b.length - a.length)[0] || "";
  return finish(title.normalize("NFKC"), "");

  function finish(title, artist) {
    const image = meta(html, "og:image") || meta(html, "twitter:image")
      || (html.match(/id=["']landingImage["'][^>]+src=["']([^"']+)["']/i) || [])[1] || "";

    const barcodes = new Set();
    // structured product data (JSON-LD) and meta tags
    for (const m of html.matchAll(/"(?:gtin13|gtin12|gtin|ean|upc|jan)"\s*:\s*"?(\d{12,13})"?/gi)) barcodes.add(m[1]);
    for (const name of ["product:ean", "product:upc", "og:ean", "og:upc"]) { const v = meta(html, name); if (v) barcodes.add(v); }
    // numbers written next to a barcode label on the page
    const description = meta(html, "og:description") || meta(html, "description");
    const text = description + " " + decode(html.replace(/<script[\s\S]*?<\/script>|<style[\s\S]*?<\/style>/gi, " ").replace(/<[^>]+>/g, " "));
    for (const m of text.matchAll(/(?:JAN|EAN|UPC|barcode|バーコード|JANコード|바코드)[^0-9]{0,30}(\d[\d\s-]{11,16}\d)/gi)) barcodes.add(m[1].replace(/[\s-]/g, ""));

    const catnos = new Set();
    for (const m of text.matchAll(/(?:品番|規格品番|商品番号|カタログ番号|catalog(?:ue)?\s*(?:no|number|#)\.?|cat\.?\s*no\.?)\s*[:：]?\s*([A-Z]{2,6}-?\d{3,6}(?:[\/~～-]\d{1,4})?)/gi)) catnos.add(m[1].toUpperCase());
    // Japanese-style catalog numbers in the title, e.g. "UPCH-20512" or "TOCP50201"
    for (const m of (title || "").matchAll(/\b([A-Z]{3,5}-\d{4,6})\b/g)) catnos.add(m[1]);

    if (!artist) artist = (description.match(/」(.+?)の(?:中古|新品)商品ページ/) || [])[1] || "";
    return {
      title,
      artist,
      description: description.slice(0, 500),
      image,
      barcodes: [...barcodes].filter(validBarcode).slice(0, 5),
      catnos: [...catnos].slice(0, 5),
    };
  }
}
