export type CashfreeEnvironment = "sandbox" | "production";

export interface CashfreeConfig {
  clientId: string;
  clientSecret: string;
  environment: CashfreeEnvironment;
  baseUrl: string;
}

export function loadCashfreeConfig(
  env: NodeJS.ProcessEnv = process.env,
): CashfreeConfig {
  const clientId = env.CASHFREE_CLIENT_ID;
  if (!clientId) throw new Error("CASHFREE_CLIENT_ID is required");

  const clientSecret = env.CASHFREE_CLIENT_SECRET;
  if (!clientSecret) throw new Error("CASHFREE_CLIENT_SECRET is required");

  // Defaults to sandbox. Defaulting the other way would let a missing or
  // misspelled env var take real money.
  const environment: CashfreeEnvironment =
    env.CASHFREE_ENV === "production" ? "production" : "sandbox";

  return {
    clientId,
    clientSecret,
    environment,
    baseUrl:
      environment === "production"
        ? "https://api.cashfree.com"
        : "https://sandbox.cashfree.com",
  };
}
