/**
 * What the HTTP layer should do with a request aimed at the MCP endpoint.
 *
 * Split out of server.ts because that module opens a listening socket on
 * import, so nothing in it can be exercised from a test.
 */
export type McpRoute = "transport" | "method-not-allowed" | "pass";

/** The methods the streamable-HTTP transport actually handles. */
export const MCP_METHODS: ReadonlySet<string> = new Set(["POST", "DELETE"]);

/**
 * The `Allow` header for a refused method, derived from {@link MCP_METHODS}.
 *
 * Derived rather than typed out: a hand-written list silently starts lying the
 * moment the accepted set changes, which is the same drift that let the two
 * CSP blocks disagree until Claude blocked every product image.
 */
export function mcpAllowHeader(): string {
  return [...MCP_METHODS, "OPTIONS"].join(", ");
}

/**
 * Routes one request against the MCP endpoint.
 *
 * GET is refused rather than passed through. The transport is stateless — no
 * session id is issued — so there is no server->client stream for a GET to
 * open, and the spec reserves 405 for exactly that. Letting it fall through to
 * the catch-all 404 reads as "no such endpoint" instead of "wrong method".
 */
export function routeMcpRequest(
  method: string | undefined,
  pathname: string,
  mcpPath = "/mcp",
): McpRoute {
  if (pathname !== mcpPath) return "pass";
  if (method && MCP_METHODS.has(method)) return "transport";
  if (method === "GET") return "method-not-allowed";
  return "pass";
}
