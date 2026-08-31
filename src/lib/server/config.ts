export interface AppConfig {
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
    shopDomain,
    agentProfile,
    port,
    /**
     * A last-resort origin, for the boot banner and for a request that carries
     * no usable host.
     *
     * NOT the normal path. The origin the widget is told to call is derived
     * per request from the address it arrived on — see requestOrigin.ts — and
     * that is the only source that cannot name a server which is not this one.
     *
     * SERVER_URL used to sit at the front of this chain and was removed on
     * 2026-08-31: a Netlify deploy created during a repo move carried a
     * laptop's ngrok tunnel in it, so the deployed widget told every browser to
     * POST there, and when the tunnel stopped add-to-cart was dead in ChatGPT
     * and Claude alike — with no request reaching any server, so nothing in any
     * log. Verified the same day against a live tunnel that ngrok sends
     * x-forwarded-host and x-forwarded-proto, so derivation covers the case
     * SERVER_URL existed for.
     *
     * Netlify's own vars stay because they make the banner truthful on a cold
     * start, before any request has arrived.
     */
    serverUrl:
      env.DEPLOY_PRIME_URL || env.URL || `http://localhost:${port}`,
  };
}
