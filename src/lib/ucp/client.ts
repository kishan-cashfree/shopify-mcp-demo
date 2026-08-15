export interface UcpConfig {
  shopDomain: string;
  agentProfile: string;
  timeoutMs?: number;
}

export interface UcpClient {
  call(toolName: string, args: Record<string, unknown>): Promise<unknown>;
}

/** A failure reported by Shopify, as opposed to a transport failure. */
export class UcpError extends Error {
  constructor(
    message: string,
    readonly toolName: string,
  ) {
    super(message);
    this.name = "UcpError";
  }
}

const DEFAULT_TIMEOUT_MS = 10_000;

/**
 * Counts and names every call that leaves for Shopify.
 *
 * Our own request log records the widget's calls to us, and inferring upstream
 * volume from those has been wrong twice: one `/api/shop/cart` is a
 * create_cart or an update_cart, and a widget can recover a catalog without
 * any request of ours appearing at all. Shopify answered the resulting volume
 * with `429 Rate limit exceeded`, so the number matters and is worth
 * measuring where it actually happens.
 *
 * Silent under vitest, which would otherwise print a line per fixture call.
 */
let upstreamCalls = 0;

/**
 * What a call is about, in a few characters.
 *
 * Without it, three simultaneous `update_cart` lines are indistinguishable
 * from three widgets fighting over one cart — and which of those it is decides
 * the fix. Coalescing duplicate calls only helps if the cart is the same one.
 */
function subjectOf(toolName: string, args: Record<string, unknown>): string {
  const id = args.id;
  if (typeof id === "string") {
    // gid://shopify/Cart/hWNFeZQ…?key=… → hWNFeZQ…
    const tail = id.split("/").pop() ?? id;
    return tail.split("?")[0].slice(0, 12);
  }
  // search_catalog nests it: { catalog: { query } }.
  const catalog = args.catalog as { query?: unknown } | undefined;
  if (typeof catalog?.query === "string") return `"${catalog.query}"`;
  if (toolName === "create_cart") return "new";
  return "";
}

function logUpstream(
  toolName: string,
  subject: string,
  status: number,
  ms: number,
): void {
  if (typeof process !== "undefined" && process.env.NODE_ENV === "test") return;
  const stamp = new Date().toTimeString().slice(0, 8);
  const mark = status >= 400 ? "✗" : "↑";
  console.log(
    `${stamp} ${mark} shopify ${toolName} ${subject} ${status} ${ms}ms (#${++upstreamCalls})`,
  );
}

export function createUcpClient(config: UcpConfig): UcpClient {
  const endpoint = `https://${config.shopDomain}/api/ucp/mcp`;
  const timeoutMs = config.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  let nextId = 1;

  async function call(
    toolName: string,
    args: Record<string, unknown>,
  ): Promise<unknown> {
    const body = {
      jsonrpc: "2.0",
      id: nextId++,
      method: "tools/call",
      params: {
        name: toolName,
        arguments: {
          // Required by every UCP tool schema. Injected here so no caller can
          // forget it.
          meta: { "ucp-agent": { profile: config.agentProfile } },
          ...args,
        },
      },
    };

    const startedAt = Date.now();
    const response = await fetch(endpoint, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(timeoutMs),
    });
    logUpstream(
      toolName,
      subjectOf(toolName, args),
      response.status,
      Date.now() - startedAt,
    );

    if (!response.ok) {
      const text = await response.text().catch(() => "");
      throw new UcpError(
        `Shopify returned ${response.status} for ${toolName}${text ? `: ${text}` : ""}`,
        toolName,
      );
    }

    const envelope = (await response.json()) as {
      error?: { message: string };
      result?: {
        content?: { type: string; text: string }[];
        isError?: boolean;
      };
    };

    if (envelope.error) {
      throw new UcpError(envelope.error.message, toolName);
    }

    const text = envelope.result?.content?.[0]?.text;
    if (text === undefined) {
      throw new UcpError(`Empty response from ${toolName}`, toolName);
    }

    // Shopify reports tool-level failures as isError with a human-readable
    // string in the same content slot — not as JSON, and not as a JSON-RPC
    // error. Its validation messages are specific and worth surfacing intact.
    if (envelope.result?.isError) {
      throw new UcpError(text, toolName);
    }

    // MCP nests the payload as a JSON *string* inside the envelope, so every
    // successful response needs two parses. This is the reason this file exists.
    try {
      return JSON.parse(text);
    } catch {
      throw new UcpError(
        `${toolName} returned a non-JSON payload: ${text.slice(0, 200)}`,
        toolName,
      );
    }
  }

  return { call };
}
