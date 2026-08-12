export interface StorefrontAccess {
  reachable: boolean;
  passwordProtected: boolean;
  detail?: string;
}

type FetchLike = (url: string, init?: RequestInit) => Promise<Response>;

/**
 * Probe whether the storefront is behind Shopify's "Restrict access to
 * visitors with a password" setting.
 *
 * This matters because the UCP MCP endpoints are NOT subject to that gate:
 * catalog search and cart creation succeed against a locked store, and the
 * only thing that fails is the hosted checkout — the last step, where money
 * would move. Everything looks healthy until the demo reaches the till.
 */
export async function checkStorefrontAccess(
  shopDomain: string,
  fetchImpl: FetchLike = fetch,
): Promise<StorefrontAccess> {
  try {
    const response = await fetchImpl(`https://${shopDomain}/`, {
      method: "GET",
      // Manual: following the redirect lands on a 200 password page, which is
      // indistinguishable from a healthy storefront.
      redirect: "manual",
    });

    const location = response.headers.get("location") ?? "";
    const passwordProtected =
      response.status >= 300 &&
      response.status < 400 &&
      /\/password(\?|$)/.test(location);

    return { reachable: true, passwordProtected };
  } catch (error) {
    // A boot-time probe must never stop the server from starting.
    return {
      reachable: false,
      passwordProtected: false,
      detail: (error as Error).message,
    };
  }
}

export function storefrontWarning(
  access: StorefrontAccess,
  shopDomain: string,
): string | null {
  if (!access.reachable) {
    return `WARNING: couldn't reach ${shopDomain} (${access.detail ?? "unknown error"}). The catalog may not load.`;
  }

  if (access.passwordProtected) {
    return [
      `WARNING: ${shopDomain} is password protected.`,
      "  Catalog search and cart will work — the UCP endpoints ignore the gate —",
      "  but the checkout link redirects to the store password page, so payment",
      "  cannot be reached.",
      "  Fix: Shopify admin → Online Store → Preferences → Restrict access →",
      "  uncheck 'Restrict access to visitors with a password'.",
    ].join("\n");
  }

  return null;
}
