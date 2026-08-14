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

async function freshClient() {
  calls.length = 0;
  updateModelContext.mockClear();
  sendMessage.mockClear();
  vi.resetModules();
  const mod = await import("./platform");
  // No window.openai, so the factory builds the MCP Apps client.
  return mod.getClientPlatform();
}

describe("MCP Apps handoff — model context lifetime", () => {
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
