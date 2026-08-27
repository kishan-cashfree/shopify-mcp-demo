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
  /**
   * What a successful response was about, when there is something worth
   * saying. See describeApiOutcome.
   */
  outcome?: string;
  /**
   * Why the request failed, when it did.
   *
   * A live 502 on /api/pay/otp logged only its status, so the cause survived
   * nowhere but the buyer's screen. The reason is already in the response body
   * by then; keeping it here is the difference between diagnosing a failure
   * afterwards and needing a witness.
   */
  error?: string;
}

/** Long enough for an upstream message, short enough to stay one readable line. */
const MAX_ERROR_CHARS = 160;

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
  // The outcome joins the same parens as the MCP detail rather than getting
  // its own bracket: a line carries one or the other in practice, and two
  // empty pairs of brackets on every /api/ line would be worse than either.
  const detail = [
    fields.mcpMethod,
    fields.mcpTool,
    fields.mcpUri,
    fields.outcome,
  ]
    .filter(Boolean)
    .join(" ");

  // Only on failures: a reason attached to a 200 is noise, and success lines
  // are the bulk of the log.
  const reason =
    fields.status >= 400 && fields.error
      ? // Newlines would break every grep this log exists to serve, and an
        // HTML error page would bury every other line.
        ` — ${collapse(fields.error)}`
      : "";

  return (
    [
      formatClock(fields.at),
      marker,
      fields.method,
      fields.path,
      detail ? `(${detail})` : "",
      String(fields.status),
      `${fields.durationMs}ms`,
    ]
      .filter(Boolean)
      .join(" ") + reason
  );
}

function collapse(error: string): string {
  const flat = error.replace(/\s+/g, " ").trim();
  return flat.length > MAX_ERROR_CHARS
    ? `${flat.slice(0, MAX_ERROR_CHARS)}…`
    : flat;
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

/**
 * A one-token summary of a successful `/api/*` response.
 *
 * Added because the order-status poll logged only its status code, so whether
 * the widget ever SAW the payment land had to be inferred from the gaps
 * between requests. Measured 2026-08-27: the order was PAID on two separate
 * runs and the log could not say whether the buyer's screen knew it, because
 * a poll that returns on a terminal status looks exactly like a poll that
 * stopped for any other reason.
 *
 * Only the shapes worth summarising. Every other route's body is its own
 * business, and a formatter that tried to describe all of them would print
 * noise on the ones it does not understand.
 */
export function describeApiOutcome(body: unknown): string | undefined {
  if (!body || typeof body !== "object") return undefined;

  const payload = body as { orderStatus?: unknown };
  return typeof payload.orderStatus === "string"
    ? payload.orderStatus
    : undefined;
}
