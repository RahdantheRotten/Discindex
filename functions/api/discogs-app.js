// Cloudflare Pages Function: GET /api/discogs-app
// Gives the website Discindex's Discogs app key and secret (Cloudflare secrets DISCOGS_KEY / DISCOGS_SECRET),
// so every visitor's browser can ask Discogs directly, with its own rate limit, and nobody needs a token.
// The key only gives access to Discogs' public music data, not to anyone's account. If it's ever misused,
// make a new one on Discogs and replace the secrets in Cloudflare; no code change is needed.

const headers = { "Access-Control-Allow-Origin": "*", "Content-Type": "application/json", "Cache-Control": "public, max-age=3600" };

export function onRequestGet({ env }) {
  if (env.DISCOGS_KEY && env.DISCOGS_SECRET) return new Response(JSON.stringify({ key: env.DISCOGS_KEY, secret: env.DISCOGS_SECRET }), { headers });
  if (env.DISCOGS_TOKEN) return new Response(JSON.stringify({ token: env.DISCOGS_TOKEN }), { headers });   // local testing only
  return new Response(JSON.stringify({ message: "Discindex isn't connected to Discogs yet." }), { status: 503, headers });
}
