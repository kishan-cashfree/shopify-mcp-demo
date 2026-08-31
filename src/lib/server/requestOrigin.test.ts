import { describe, it, expect } from "vitest";
import { requestOrigin } from "./requestOrigin";

/** Both entry points hand this a lookup rather than their own header type. */
const from = (headers: Record<string, string>) => (name: string) =>
  headers[name.toLowerCase()];

/**
 * Deriving the widget's callback origin from the request that asked for it.
 *
 * Measured 2026-08-31, and the reason this exists: a new Netlify site was
 * created when the repo moved to the cashfree org, and its SERVER_URL was set
 * to a laptop's ngrok tunnel. The deployed widget therefore told every browser
 * to POST to that tunnel; when the tunnel went down, add-to-cart did nothing in
 * both ChatGPT and Claude, with no request reaching any server and so nothing
 * in any log. The old site kept working only because its SERVER_URL happened to
 * name itself.
 *
 * The origin a request ARRIVED on cannot be wrong in that way: it is by
 * definition an address that just worked.
 */
describe("requestOrigin", () => {
  it("uses the forwarded host and protocol a proxy reports", () => {
    // ngrok and Netlify both terminate TLS and forward. The Host the client
    // used is in x-forwarded-host; the socket's own host is the internal one.
    expect(
      requestOrigin(
        from({
          host: "localhost:8787",
          "x-forwarded-host": "belvish-mcp-app.netlify.app",
          "x-forwarded-proto": "https",
        }),
      ),
    ).toBe("https://belvish-mcp-app.netlify.app");
  });

  it("falls back to the Host header when nothing was forwarded", () => {
    expect(requestOrigin(from({ host: "example.test" }))).toBe(
      "https://example.test",
    );
  });

  it("assumes http for localhost, so a dev run is not told to use TLS", () => {
    expect(requestOrigin(from({ host: "localhost:8787" }))).toBe(
      "http://localhost:8787",
    );
    expect(requestOrigin(from({ host: "127.0.0.1:8787" }))).toBe(
      "http://127.0.0.1:8787",
    );
  });

  it("takes the first hop when a proxy chain appends its own values", () => {
    // Two proxies in front produce "https,http" and "public.test,internal".
    // The client-facing hop is first, and it is the only one a browser can
    // reach.
    expect(
      requestOrigin(
        from({
          "x-forwarded-host": "public.test, internal.local",
          "x-forwarded-proto": "https, http",
        }),
      ),
    ).toBe("https://public.test");
  });

  it("returns nothing when there is no host to work from", () => {
    // The caller then falls back to configuration. Guessing an origin would
    // produce a widget that fetches nowhere, which is the bug this prevents.
    expect(requestOrigin(from({}))).toBeUndefined();
  });

  it("refuses a host that could not be a hostname", () => {
    // Host is attacker-controllable. Anything with a slash, space, scheme or
    // credentials is rejected rather than concatenated into a URL — it would
    // otherwise be injected into the widget HTML and the CSP alike.
    for (const host of [
      "evil.test/path",
      "evil.test evil2.test",
      "http://evil.test",
      "user@evil.test",
      "evil.test?x=1",
      "",
    ]) {
      expect(requestOrigin(from({ host }))).toBeUndefined();
    }
  });

  it("trims surrounding whitespace rather than rejecting the host", () => {
    // Not a security case — an HTTP parser trims header values anyway, and the
    // result is a clean hostname. Pinned so the guard above is understood as
    // rejecting structure, not punctuation.
    expect(requestOrigin(from({ host: " example.test " }))).toBe(
      "https://example.test",
    );
  });

  it("refuses a forwarded protocol that is not http or https", () => {
    expect(
      requestOrigin(
        from({ host: "example.test", "x-forwarded-proto": "javascript" }),
      ),
    ).toBeUndefined();
  });
});
