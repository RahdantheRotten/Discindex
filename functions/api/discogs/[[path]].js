// Cloudflare Pages Function: /api/discogs/<Discogs API path>
// Lets visitors use Discogs without their own token. Discindex's app key and secret are kept here on the
// server (Cloudflare "Secrets" DISCOGS_KEY and DISCOGS_SECRET), never in the website's code.
// Only reading public music data is allowed, and answers are cached so popular CDs aren't fetched again.

const CORS = { "Access-Control-Allow-Origin": "*" };

// Which Discogs paths may be used, and how long Discogs' answers are kept
const ALLOWED = [
  [/^database\/search$/, 60 * 60 * 24],                                // search by name / barcode / catalog number
  [/^releases\/\d+$/, 60 * 60 * 24 * 7],                                // album details
  [/^masters\/\d+$/, 60 * 60 * 24 * 7],
  [/^masters\/\d+\/versions$/, 60 * 60 * 24],
  [/^users\/[^/]+\/collection\/folders\/0\/releases$/, 60 * 5],         // a user's public collection (import)
];

const json = (data, status) => new Response(JSON.stringify(data), { status, headers: { ...CORS, "Content-Type": "application/json" } });

export async function onRequestGet({ request, params, env }) {
  const path = [].concat(params.path || []).join("/");
  const rule = ALLOWED.find(([re]) => re.test(path));
  if (!rule) return json({ message: "Not allowed." }, 403);

  const auth = env.DISCOGS_KEY && env.DISCOGS_SECRET ? `Discogs key=${env.DISCOGS_KEY}, secret=${env.DISCOGS_SECRET}`
    : env.DISCOGS_TOKEN ? `Discogs token=${env.DISCOGS_TOKEN}` : "";
  if (!auth) return json({ message: "Discindex isn't connected to Discogs yet." }, 503);

  const url = new URL(request.url);
  const target = `https://api.discogs.com/${path}${url.search}`;

  // answer from the cache when possible
  const cache = typeof caches !== "undefined" ? caches.default : null;
  const cacheKey = new Request(`https://discogs-cache.discindex/${path}${url.search}`);
  if (cache) {
    const hit = await cache.match(cacheKey);
    if (hit) return hit;
  }

  const res = await fetch(target, { headers: { Authorization: auth, "User-Agent": "Discindex/1.0 +https://discindex.pages.dev" } });
  const body = await res.text();
  const out = new Response(body, {
    status: res.status,
    headers: { ...CORS, "Content-Type": "application/json", "Cache-Control": res.ok ? `public, max-age=${rule[1]}` : "no-store" },
  });
  if (cache && res.ok) await cache.put(cacheKey, out.clone());
  return out;
}
