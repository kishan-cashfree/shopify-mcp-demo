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
      `NOTE: ${shopDomain} is password protected.`,
      "  Catalog, cart and the hosted checkout link all still work — the UCP",
      "  endpoints ignore the gate, and /checkouts/cn/ URLs are reachable.",
      "  Only browsing the storefront itself hits the password page, so a demo",
      "  that links anywhere other than checkout will look broken.",
      "  Remove it under: Shopify admin → Online Store → Preferences →",
      "  Restrict access.",
    ].join("\n");
  }

  return null;
}
