export interface RequestLogFields {
  /**
   * When the request finished. Passed in rather than read from a clock here,
   * so the formatter stays pure — and required rather than optional, because a
   * timestamp a caller can forget is the gap this was added to close.
   */
  at: Date;
  method: string;
  path: string;
  status: number;
  durationMs: number;
  mcpMethod?: string;
  mcpTool?: string;
  /** resources/read target. Which widget the host renders is the whole story. */
  mcpUri?: string;
}

/**
 * Local wall-clock time to the millisecond.
 *
 * Time of day, not a date: every line in a session shares the day, and the
 * question these logs answer is how many seconds passed between two requests.
 */
function formatClock(at: Date): string {
  const pad = (n: number, width = 2) => String(n).padStart(width, "0");
  return (
    `${pad(at.getHours())}:${pad(at.getMinutes())}:${pad(at.getSeconds())}` +
    `.${pad(at.getMilliseconds(), 3)}`
  );
}

export function formatRequestLog(fields: RequestLogFields): string {
  const marker = fields.status >= 400 ? "✗" : "→";

  // "POST /mcp" alone is unreadable during a demo, because every host call
  // looks identical. The MCP method and tool name are what make the log useful.
  const detail = [fields.mcpMethod, fields.mcpTool, fields.mcpUri]
    .filter(Boolean)
    .join(" ");

  return [
    formatClock(fields.at),
    marker,
    fields.method,
    fields.path,
    detail ? `(${detail})` : "",
    String(fields.status),
    `${fields.durationMs}ms`,
  ]
    .filter(Boolean)
    .join(" ");
}

export function describeMcpBody(body: unknown): {
  mcpMethod?: string;
  mcpTool?: string;
  mcpUri?: string;
} {
  if (!body || typeof body !== "object") {
    return { mcpMethod: undefined, mcpTool: undefined, mcpUri: undefined };
  }

  const envelope = body as {
    method?: unknown;
    params?: { name?: unknown; uri?: unknown };
  };

  return {
    mcpMethod:
      typeof envelope.method === "string" ? envelope.method : undefined,
    mcpTool:
      typeof envelope.params?.name === "string"
        ? envelope.params.name
        : undefined,
    // Without this, "resources/read" says nothing about which widget the host
    // chose to render — which is exactly the question being investigated.
    mcpUri:
      typeof envelope.params?.uri === "string" ? envelope.params.uri : undefined,
  };
}
