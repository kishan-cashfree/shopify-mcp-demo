import { describe, it, expect, vi } from "vitest";

/**
 * The MCP Apps handoff, isolated from the singleton in platform.ts.
 *
 * `App` is mocked at the package boundary so the call ORDER is observable —
 * that is the whole defect. On ChatGPT `sendMessage` sends, so clearing the
 * context immediately afterwards is harmless. On Claude `sendMessage` only
 * proposes text into the composer and returns, so an immediate clear deletes
 * the paymentSessionId while the buyer is still deciding whether to send it.
 * Observed live: "I don't have an active checkout session yet."
 */
const calls: string[] = [];
const updateModelContext = vi.fn(async (arg: Record<string, unknown>) => {
  const content = arg.content as unknown[] | undefined;
  calls.push(content && content.length ? "setContext" : "clearContext");
});
const sendMessage = vi.fn(async () => {
  calls.push("sendMessage");
});

vi.mock("@modelcontextprotocol/ext-apps", () => ({
  App: class {
    updateModelContext = updateModelContext;
    sendMessage = sendMessage;
    connect = vi.fn().mockResolvedValue(undefined);
    ontoolinput = null;
    ontoolresult = null;
  },
}));

async function connectedClient() {
  calls.length = 0;
  updateModelContext.mockClear();
  sendMessage.mockClear();
  vi.resetModules();
  const mod = await import("./platform");
  // No window.openai, so the factory builds the MCP Apps client.
  const host = mod.getClientPlatform();
  await host.connect();
  return host;
}

/**
 * The handoff calls, with the connect-time housekeeping dropped.
 *
 * Connecting clears the model context — see the dedicated test below — and
 * that lands before any handoff begins. These assertions are about the order
 * of the handoff itself.
 */
async function freshClient() {
  const host = await connectedClient();
  calls.length = 0;
  updateModelContext.mockClear();
  return host;
}

describe("MCP Apps handoff — model context lifetime", () => {
  it("drops a previous turn's instruction when the bridge connects", async () => {
    // A handoff the buyer never confirmed leaves "call UpiTool with
    // session_abc" sitting in the model context. Reconnecting on a later turn
    // with that still present invites a payment tool to run against a session
    // that is long gone, so connecting starts from a clean context.
    await connectedClient();

    expect(calls).toEqual(["clearContext"]);
  });

  it("connects once however many callers ask", async () => {
    // Two handshakes race on one postMessage channel and the loser answers
    // "Not connected" to every later call.
    const host = await connectedClient();
    calls.length = 0;

    await host.connect();
    await host.connect();

    expect(calls).toEqual([]);
  });

  it("leaves the context in place after proposing the message", async () => {
    // Claude has not sent anything yet at this point; the buyer still has to
    // confirm. Clearing here is what lost the session id.
    const host = await freshClient();

    await host.sendFollowUpMessage({
      prompt: "Call UpiTool with session_abc",
      userMessage: "Continue with UPI.",
    });

    expect(calls).toEqual(["setContext", "sendMessage"]);
    expect(calls).not.toContain("clearContext");
  });

  it("puts the instruction in the context before proposing the message", async () => {
    const host = await freshClient();

    await host.sendFollowUpMessage({
      prompt: "Call UpiTool with session_abc",
      userMessage: "Continue with UPI.",
    });

    expect(calls.indexOf("setContext")).toBeLessThan(
      calls.indexOf("sendMessage"),
    );
    const [arg] = updateModelContext.mock.calls[0];
    expect(JSON.stringify(arg)).toContain("session_abc");
  });

  it("clears the context only when asked", async () => {
    // The instruction must not outlive the handoff — a lingering "call
    // UpiTool with session_abc" invites the model to run a payment tool again
    // on an unrelated later turn. The caller decides when that moment is.
    const host = await freshClient();

    await host.sendFollowUpMessage({
      prompt: "Call UpiTool with session_abc",
      userMessage: "Continue with UPI.",
    });
    await host.clearModelContext();

    expect(calls).toEqual(["setContext", "sendMessage", "clearContext"]);
  });
});
