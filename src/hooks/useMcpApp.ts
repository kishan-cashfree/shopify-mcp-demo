import { useCallback, useEffect, useState } from "react";
import { type McpUiHostContext } from "@modelcontextprotocol/ext-apps";
import { getClientPlatform } from "../utils/platform";
import type { WidgetState, ToolOutput, ToolResponseMetadata } from "../types";

interface UseMcpAppReturn {
  error: Error | null;
  isConnected: boolean;
  hostContext: McpUiHostContext | null;
  toolInput: Record<string, unknown> | null;
  toolOutput: ToolOutput | null;
  toolResponseMetadata: ToolResponseMetadata | null;
  widgetState: WidgetState | null;
  setWidgetState: (state: WidgetState) => void;
  callTool: (name: string, args: Record<string, unknown>) => Promise<unknown>;
  sendFollowUpMessage: (options: {
    prompt: string;
    userMessage?: string;
  }) => Promise<void>;
  requestDisplayMode: (options: {
    mode: "inline" | "fullscreen" | "pip";
  }) => Promise<void>;
  openExternal: (options: { href: string }) => Promise<void>;
}

/**
 * A view onto the shared host bridge — it does not own one.
 *
 * This hook used to construct its own `App` and connect it, while
 * `getClientPlatform()` constructed and connected a second for the payment
 * handoff. The MCP Apps transport is a single postMessage channel, so the two
 * handshakes raced and whichever lost answered "Not connected" to everything
 * after it. Seen live: a buyer reached the payment methods, picked one, and
 * got a red "Not connected" with no `tools/call` ever arriving at the server.
 *
 * It also explains the drop rate the dispatch retry was built around — a
 * handoff that works about half the time is what a two-way race looks like,
 * not a flaky host.
 *
 * The unmount cleanup here used to call `app.close()`. The platform client is
 * a module singleton that outlives any one React tree, so closing it on a
 * screen change would have shut the bridge for every later payment.
 */
export function useMcpApp(): UseMcpAppReturn {
  const host = getClientPlatform();

  // The client is the source of truth; this exists only to repaint on change.
  const [, setRevision] = useState(0);

  useEffect(() => {
    const unsubscribe = host.subscribe(() => setRevision((n) => n + 1));
    // Idempotent — resolves the in-flight handshake if one is already running.
    void host.connect().catch(() => {
      // Surfaced through host.error rather than thrown into render.
    });
    return unsubscribe;
  }, [host]);

  const setWidgetState = useCallback(
    (state: WidgetState) => host.setWidgetState(state),
    [host],
  );

  const callTool = useCallback(
    (name: string, args: Record<string, unknown>) => host.callTool(name, args),
    [host],
  );

  const sendFollowUpMessage = useCallback(
    (options: { prompt: string; userMessage?: string }) =>
      host.sendFollowUpMessage(options),
    [host],
  );

  const requestDisplayMode = useCallback(
    (options: { mode: "inline" | "fullscreen" | "pip" }) =>
      host.requestDisplayMode(options),
    [host],
  );

  const openExternal = useCallback(
    (options: { href: string }) => host.openExternal(options),
    [host],
  );

  return {
    error: host.error,
    isConnected: host.isConnected,
    hostContext: host.getHostContext(),
    toolInput: host.toolInput,
    toolOutput: host.toolOutput,
    toolResponseMetadata: host.toolResponseMetadata,
    widgetState: host.widgetState,
    setWidgetState,
    callTool,
    sendFollowUpMessage,
    requestDisplayMode,
    openExternal,
  };
}
