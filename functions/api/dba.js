// Cloudflare Pages Function: GET /api/dba?q=<artist album>
// Searches DBA (Danish marketplace) and returns the listings: title, price in DKK, link, picture, town.
// DBA allows its search pages to be read (robots.txt); results are cached for an hour.

const CORS = { "Access-Control-Allow-Origin": "*", "Content-Type": "application/json; charset=utf-8" };
const json = (data, status = 200) => new Response(JSON.stringify(data), { status, headers: { ...CORS, "Cache-Control": "public, max-age=3600" } });

const decode = s => (s || "")
  .replace(/<[^>]+>/g, " ")
  .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCodePoint(parseInt(h, 16)))
  .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(+d))
  .replace(/&quot;/g, '"').replace(/&#39;|&apos;/g, "'").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&amp;/g, "&")
  .replace(/\s+/g, " ").trim();

export function parseListings(html) {
  const out = [];
  for (const [card] of html.matchAll(/<article[\s\S]*?<\/article>/g)) {
    const url = (card.match(/href="(https:\/\/www\.dba\.dk\/recommerce\/forsale\/item\/\d+)"/) || [])[1];
    const priceText = decode((card.match(/<span>([\d.\s]+)\s*kr\.<\/span>/) || [])[1]);
    const title = decode((card.match(/<h2[^>]*>([\s\S]*?)<\/h2>/) || [])[1]);
    if (!url || !title || !priceText) continue;
    const price = Number(priceText.replace(/[.\s]/g, ""));
    if (!price) continue;
    const image = (card.match(/<img[^>]+src="([^"]+)"/) || [])[1] || "";
    const place = decode((card.match(/<span class="whitespace-nowrap truncate[^"]*">([\s\S]*?)<\/span>/) || [])[1]);
    out.push({ url, title, price, image, place });
  }
  return out;
}

export async function onRequestGet({ request }) {
  const q = (new URL(request.url).searchParams.get("q") || "").trim().slice(0, 120);
  if (!q) return json({ error: "Missing search words." }, 400);
  let res;
  try {
    res = await fetch(`https://www.dba.dk/recommerce/forsale/search?q=${encodeURIComponent(q)}`, {
      headers: {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0 Safari/537.36",
        "Accept": "text/html", "Accept-Language": "da,en;q=0.8",
      },
    });
  } catch {
    return json({ error: "Couldn't reach DBA." }, 502);
  }
  if (!res.ok) return json({ error: `DBA answered with error ${res.status}.` }, 502);
  const listings = parseListings(await res.text()).slice(0, 40);
  return json({ q, searchUrl: `https://www.dba.dk/recommerce/forsale/search?q=${encodeURIComponent(q)}`, listings });
}
