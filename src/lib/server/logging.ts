export interface RequestLogFields {
  method: string;
  path: string;
  status: number;
  durationMs: number;
  mcpMethod?: string;
  mcpTool?: string;
  /** resources/read target. Which widget the host renders is the whole story. */
  mcpUri?: string;
}

export function formatRequestLog(fields: RequestLogFields): string {
  const marker = fields.status >= 400 ? "✗" : "→";

  // "POST /mcp" alone is unreadable during a demo, because every host call
  // looks identical. The MCP method and tool name are what make the log useful.
  const detail = [fields.mcpMethod, fields.mcpTool, fields.mcpUri]
    .filter(Boolean)
    .join(" ");

  return [
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
