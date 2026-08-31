/**
 * The public origin a request arrived on.
 *
 * The widget's HTML is inlined into the tool response and handed to the host,
 * never served from this origin, so inside that iframe `window.location` is the
 * HOST's document. The widget cannot work out where its own server lives — it
 * has to be told, via `window.__SERVER_URL__` and the CSP `connectDomains`.
 *
 * That value used to come only from configuration, and configuration can name a
 * server that is not this one. Measured 2026-08-31: a new Netlify site created
 * during a repo move had SERVER_URL pointing at a laptop's ngrok tunnel, so the
 * deployed widget told every browser to POST there. When the tunnel went down,
 * add-to-cart did nothing in ChatGPT and Claude alike — no request reached any
 * server, so there was nothing in any log to find.
 *
 * The address a request ARRIVED on cannot be wrong that way: it is, by
 * definition, one that just worked. Derived per request, it is correct on
 * production, deploy previews, a tunnel and localhost with nothing configured.
 *
 * Takes a lookup rather than a headers object so both entry points can use it —
 * Node's `IncomingMessage.headers` and a Web `Request.headers` have different
 * shapes, and this file should not know about either.
 */
export function requestOrigin(
  get: (name: string) => string | undefined,
): string | undefined {
  const host = firstHop(get("x-forwarded-host") ?? get("host"));
  if (!host || !isHostname(host)) return undefined;

  const forwarded = firstHop(get("x-forwarded-proto"));
  if (forwarded && forwarded !== "http" && forwarded !== "https") {
    // Not a protocol we would ever serve. Refusing beats building a URL out of
    // it: this string is about to be written into the widget HTML.
    return undefined;
  }

  // No forwarded protocol means a direct connection, which in practice is a
  // developer on localhost. Everything reachable from a host's browser is
  // https, so that is the safer default for anything else.
  const scheme = forwarded ?? (isLoopback(host) ? "http" : "https");
  return `${scheme}://${host}`;
}

/**
 * The client-facing value from a possibly comma-separated forwarded header.
 *
 * Two proxies in front produce `"https,http"` and `"public.test,internal"`.
 * The first hop is the one a browser can actually reach.
 */
function firstHop(value: string | undefined): string | undefined {
  const first = value?.split(",")[0]?.trim();
  return first || undefined;
}

/**
 * Whether a string is a bare `host` or `host:port` and nothing else.
 *
 * Host is attacker-controllable, and this value goes into the widget HTML and
 * the CSP. A scheme, path, query, credentials or whitespace means it is not a
 * hostname, and concatenating it into a URL would be how it gets in.
 */
function isHostname(host: string): boolean {
  return /^[a-zA-Z0-9.-]+(:\d{1,5})?$/.test(host);
}

function isLoopback(host: string): boolean {
  const name = host.split(":")[0];
  return name === "localhost" || name === "127.0.0.1" || name === "[::1]";
}
