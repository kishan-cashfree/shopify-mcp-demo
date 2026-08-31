export interface AppConfig {
  /**
   * Set ONLY when SERVER_URL was given, and it outranks the origin a request
   * arrived on. Everything else — Netlify's own vars, the localhost default —
   * lands in `serverUrl` instead, where a real request beats it.
   *
   * The distinction is the whole point: without it the localhost default would
   * outrank a correct derived origin, which is the failure this was added to
   * prevent.
   */
  serverUrlOverride?: string;
  shopDomain: string;
  agentProfile: string;
  port: number;
  serverUrl: string;
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): AppConfig {
  const shopDomain = env.SHOP_DOMAIN;
  if (!shopDomain) {
    throw new Error("SHOP_DOMAIN is required — it is the whole store config");
  }

  const agentProfile = env.UCP_AGENT_PROFILE;
  if (!agentProfile) {
    throw new Error(
      "UCP_AGENT_PROFILE is required — every UCP call must carry it",
    );
  }

  const port = Number(env.PORT ?? 8787);

  return {
    serverUrlOverride: env.SERVER_URL || undefined,
    shopDomain,
    agentProfile,
    port,
    /**
     * The public origin the widget calls back on.
     *
     * This is the single most consequential line in the file: it is injected
     * into the widget HTML as `window.__SERVER_URL__` AND listed in
     * `connectDomains`, so a wrong value both points the fetch at nowhere and
     * makes the host's CSP block it. The failure leaves no trace server-side,
     * because no request is ever made.
     *
     * Measured 2026-08-31: a Netlify deploy with none of these set fell back
     * to localhost, and add-to-cart silently did nothing in ChatGPT and Claude
     * alike, while the same build over ngrok worked. Browsing looked healthy
     * throughout — the catalog rides in the tool result and needs no fetch, so
     * add-to-cart is the first thing that reveals it.
     *
     * The order matters:
     *   SERVER_URL        an explicit override, and how the ngrok run works.
     *   DEPLOY_PRIME_URL  Netlify's URL for THIS deploy. Ahead of URL because
     *                     on a deploy preview URL still names production, and
     *                     a preview widget calling production works just well
     *                     enough to be confusing.
     *   URL               Netlify's production site URL.
     * Both Netlify values are injected by the platform, so a deploy is correct
     * with nothing configured in the dashboard.
     */
    serverUrl:
      env.SERVER_URL ||
      env.DEPLOY_PRIME_URL ||
      env.URL ||
      `http://localhost:${port}`,
  };
}
