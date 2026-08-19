/**
 * The widget's own endpoints, as data rather than as writes to a socket.
 *
 * These lived inline in `server.ts`, where each one ended in
 * `res.writeHead(...).end(JSON.stringify(...))`. That made them unreachable
 * from a test — `server.ts` binds a port on import — and unreachable from a
 * serverless function, which is handed a Web `Request` and must return a Web
 * `Response`. Returning `{ status, body }` lets one implementation serve both,
 * which matters more here than it looks: almost every host bug in this repo
 * came from two code paths that were supposed to behave identically.
 */
export interface ApiResponse {
  status: number;
  body: unknown;
}

/**
 * What the routes need, as behaviour rather than as concrete services.
 *
 * Structural on purpose: the caller binds its own clients into closures, so
 * this module never imports Shopify or Cashfree and a test never has to
 * construct either.
 */
export interface ApiRouteDeps {
  searchProducts(query: string): Promise<unknown>;
  cart(body: unknown): Promise<ApiResponse>;
  orderRaw(orderId: string): Promise<ApiResponse>;
  pay: {
    handleCreateOrder(body: unknown): Promise<ApiResponse>;
    handleSendOtp(body: unknown): Promise<ApiResponse>;
    handleVerifyOtp(body: unknown): Promise<ApiResponse>;
    handleDispatchStatus(body: unknown): Promise<ApiResponse>;
    handleCreateAddress(body: unknown): Promise<ApiResponse>;
    handleGetAddresses(paymentSessionId: string): Promise<ApiResponse>;
    handleOrderStatus(orderId: string): Promise<ApiResponse>;
  };
}

const message = (error: unknown) => (error as Error).message;

/**
 * Routes one `/api/*` request, or returns null if the path is not ours.
 *
 * Null rather than a 404 because the caller owns the fallthrough: the local
 * server still has `/` and `/mcp` to try after this.
 */
export async function routeApiRequest(
  method: string | undefined,
  pathname: string,
  searchParams: URLSearchParams,
  readBody: () => Promise<unknown>,
  deps: ApiRouteDeps,
): Promise<ApiResponse | null> {
  if (method === "POST" && pathname === "/api/shop/search") {
    try {
      const body = (await readBody()) as { query?: unknown };
      const query = typeof body?.query === "string" ? body.query.trim() : "";
      if (!query) return { status: 400, body: { error: "query is required" } };
      return { status: 200, body: await deps.searchProducts(query) };
    } catch (error) {
      // 502, not 400: by this point the request itself parsed, so the failure
      // came from Shopify and blaming the widget for it hides that.
      return { status: 502, body: { error: message(error) } };
    }
  }

  if (method === "POST" && pathname === "/api/shop/cart") {
    try {
      return await deps.cart(await readBody());
    } catch (error) {
      return { status: 400, body: { error: message(error) } };
    }
  }

  if (method === "POST" && pathname.startsWith("/api/pay/")) {
    const route = pathname.slice("/api/pay/".length);
    try {
      const body = await readBody();
      switch (route) {
        case "order":
          return await deps.pay.handleCreateOrder(body);
        case "otp":
          return await deps.pay.handleSendOtp(body);
        case "otp/verify":
          return await deps.pay.handleVerifyOtp(body);
        case "dispatched":
          return await deps.pay.handleDispatchStatus(body);
        case "addresses":
          return await deps.pay.handleCreateAddress(body);
        // Reading addresses is a POST because the session id is a credential
        // and does not belong in a URL — and because GETs from the widget were
        // observed never reaching this server while POSTs always did.
        case "addresses/list":
          return await deps.pay.handleGetAddresses(
            (body as { paymentSessionId?: string })?.paymentSessionId ?? "",
          );
        default:
          return { status: 404, body: { error: "Not found" } };
      }
    } catch (error) {
      return { status: 400, body: { error: message(error) } };
    }
  }

  if (method === "GET" && pathname === "/api/pay/addresses") {
    return await deps.pay.handleGetAddresses(
      searchParams.get("paymentSessionId") ?? "",
    );
  }

  // POST rather than GET for the same reason as addresses/list.
  if (method === "POST" && pathname === "/api/orders/status") {
    const body = (await readBody()) as { orderId?: string };
    return await deps.pay.handleOrderStatus(body?.orderId ?? "");
  }

  // cashfree-here's widgets poll this path and parse Cashfree's RAW order
  // shape, so the body is proxied through untouched. Returning our normalised
  // { orderId, orderStatus } left their reconciliation unable to reach a
  // terminal state.
  if (method === "GET" && pathname.startsWith("/api/orders/")) {
    const orderId = decodeURIComponent(pathname.slice("/api/orders/".length));
    try {
      return await deps.orderRaw(orderId);
    } catch {
      return { status: 500, body: { error: "Order status fetch failed" } };
    }
  }

  return null;
}
