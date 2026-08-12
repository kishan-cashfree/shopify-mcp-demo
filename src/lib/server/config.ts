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
    serverUrl: env.SERVER_URL || `http://localhost:${port}`,
  };
}
