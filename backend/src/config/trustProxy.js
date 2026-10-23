// How many reverse proxies sit between the internet and this app. Express only
// reads the real client IP out of X-Forwarded-For correctly when it knows this
// number; the per-IP rate limits depend on it.
//
// Render serves every service behind Cloudflare plus its own load balancers: on
// 22 Oct 2026 the header was "<client>, <Cloudflare>, <Render internal 10.x>", so
// the client is the 3rd address from the right (with 2 the app saw Cloudflare's
// address, which put it in the activity log and made every user behind that
// address share the per-IP limits). Render sets RENDER=true, which is used as the
// default there. Override with TRUST_PROXY and
// verify with GET /api/admin/client-ip (admin only): `ip` must be your own
// public IP. Too low and every user looks like a proxy address; too high and
// clients can spoof their IP through the header.
const RENDER_PROXY_HOPS = 3;

function resolveTrustProxy(env = process.env) {
  const raw = env.TRUST_PROXY;

  if (raw === undefined || raw === '') {
    return env.RENDER ? RENDER_PROXY_HOPS : false;
  }
  if (raw === 'false' || raw === '0') return false;
  if (/^[1-9]\d?$/.test(raw)) return Number(raw);

  throw new Error(
    `Invalid TRUST_PROXY "${raw}": use the number of proxies in front of the app (e.g. 2) or "false". ` +
      '"true" is rejected on purpose because it lets any client spoof its IP and bypass the rate limits.'
  );
}

module.exports = { resolveTrustProxy, RENDER_PROXY_HOPS };
