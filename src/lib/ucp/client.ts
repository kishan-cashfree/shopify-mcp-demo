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

    const response = await fetch(endpoint, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(timeoutMs),
    });

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
