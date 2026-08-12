import { useState, useEffect, useCallback, useRef } from "react";
import { App, type McpUiHostContext } from "@modelcontextprotocol/ext-apps";
import type { WidgetState, ToolOutput, ToolResponseMetadata } from "../types";

interface McpAppState {
  app: App | null;
  error: Error | null;
  isConnected: boolean;
  hostContext: McpUiHostContext | null;
  toolInput: Record<string, unknown> | null;
  toolOutput: ToolOutput | null;
  toolResponseMetadata: ToolResponseMetadata | null;
  widgetState: WidgetState | null;
}

interface UseMcpAppReturn extends McpAppState {
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

async function clearModelContext(app: App): Promise<void> {
  await app.updateModelContext({
    content: [],
    structuredContent: {},
  });
}

function readPersistedWidgetState(): WidgetState | null {
  try {
    if (window.openai?.widgetState) {
      return window.openai.widgetState;
    }
  } catch {
    // Ignore host bridge read failures.
  }

  return null;
}

export function useMcpApp(): UseMcpAppReturn {
  const [state, setState] = useState<McpAppState>({
    app: null,
    error: null,
    isConnected: false,
    hostContext: null,
    toolInput: null,
    toolOutput: null,
    toolResponseMetadata: null,
    widgetState: readPersistedWidgetState(),
  });

  useEffect(() => {
    let mounted = true;

    const app = new App({
      name: "Good Food",
      version: "1.0.0",
    });

    app.onteardown = async () => {
      console.log("[Good Food MCP] App is being torn down");
      return {};
    };

    app.ontoolinput = async (params) => {
      console.log("[Good Food MCP] Received tool input:", params);
      if (mounted) {
        setState((prev) => ({
          ...prev,
          toolInput: params.arguments as Record<string, unknown>,
        }));
      }
    };

    app.ontoolresult = async (result) => {
      console.log("[Good Food MCP] Received tool result:", result);
      if (mounted) {
        const structuredContent = (result as any).structuredContent as
          | ToolOutput
          | undefined;
        const meta = ((result as any)._meta as ToolResponseMetadata) ?? {};

        setState((prev) => ({
          ...prev,
          toolOutput: structuredContent ?? null,
          toolResponseMetadata: meta,
        }));
      }
    };

    app.ontoolcancelled = (params) => {
      console.log("[Good Food MCP] Tool call cancelled:", params.reason);
    };

    app.onerror = (error) => {
      const errorMsg = String(error);
      if (errorMsg.includes("unknown message ID")) {
        return;
      }
      console.error("[Good Food MCP] App error:", error);
      if (mounted) {
        setState((prev) => ({
          ...prev,
          error: error instanceof Error ? error : new Error(String(error)),
        }));
      }
    };

    app.onhostcontextchanged = (ctx) => {
      console.log("[Good Food MCP] Host context changed:", ctx);
      if (mounted) {
        setState((prev) => ({
          ...prev,
          hostContext: { ...prev.hostContext, ...ctx } as McpUiHostContext,
        }));
      }
    };

    const handleGlobalsChanged = () => {
      const nextWidgetState = readPersistedWidgetState();
      if (mounted) {
        setState((prev) => ({
          ...prev,
          widgetState: nextWidgetState,
        }));
      }
    };

    window.addEventListener("openai:set_globals", handleGlobalsChanged);

    app
      .connect()
      .then(() => {
        if (mounted) {
          void clearModelContext(app).catch(() => {
            // Best-effort reset so stale hidden follow-up prompts do not leak into later turns.
          });
          console.log("[Good Food MCP] Connected successfully");
          setState((prev) => ({
            ...prev,
            app,
            isConnected: true,
            hostContext: app.getHostContext() ?? null,
            widgetState: readPersistedWidgetState(),
          }));
        }
      })
      .catch((err) => {
        if (mounted) {
          console.error("[Good Food MCP] Connection failed:", err);
          setState((prev) => ({
            ...prev,
            error: err instanceof Error ? err : new Error(String(err)),
          }));
        }
      });

    return () => {
      mounted = false;
      window.removeEventListener("openai:set_globals", handleGlobalsChanged);
      void app.close().catch(() => {
        // Ignore close failures during teardown.
      });
    };
  }, []);

  // Keep a ref to the latest widget state so sendFollowUpMessage always has
  // access to the current value without needing it in its dependency array.
  const widgetStateRef = useRef(state.widgetState);
  widgetStateRef.current = state.widgetState;

  const setWidgetState = useCallback((widgetState: WidgetState) => {
    setState((prev) => ({
      ...prev,
      widgetState,
    }));

    try {
      if (window.openai?.setWidgetState) {
        window.openai.setWidgetState(widgetState);
      }
    } catch (e) {
      console.error("[Good Food MCP] Failed to save widget state:", e);
    }

    if (state.app) {
      void state.app
        .updateModelContext({
          structuredContent: {
            widgetState,
          },
        })
        .catch(() => {
          // Non-fatal in hosts that do not surface model-context updates to UI state.
        });
    }
  }, [state.app]);

  const callTool = useCallback(
    async (name: string, args: Record<string, unknown>): Promise<unknown> => {
      if (!state.app) {
        throw new Error("MCP App not connected");
      }
      return state.app.callServerTool({ name, arguments: args });
    },
    [state.app],
  );

  const sendFollowUpMessage = useCallback(
    async (options: {
      prompt: string;
      userMessage?: string;
    }): Promise<void> => {
      if (!state.app) {
        console.warn("[Good Food MCP] Cannot send message: not connected");
        return;
      }

      if (options.userMessage) {
        // Two-step: send technical prompt as both content and structuredContent
        // (Claude reads structuredContent via widget context), then send clean
        // user-facing message so the paymentSessionId stays hidden from the input.
        // Include the current widgetState so Claude also has booking/order context.
        await state.app.updateModelContext({
          content: [{ type: "text", text: options.prompt }],
          structuredContent: {
            appContext: options.prompt,
            widgetState: widgetStateRef.current,
          },
        });
        const result = await state.app.sendMessage({
          role: "user",
          content: [{ type: "text", text: options.userMessage }],
        });
        if (result.isError) {
          throw new Error("Host rejected the follow-up message.");
        }
        await clearModelContext(state.app).catch(() => {
          // Ignore cleanup failures; the follow-up has already been sent.
        });
      } else {
        // Single message (conversational prompts)
        const result = await state.app.sendMessage({
          role: "user",
          content: [{ type: "text", text: options.prompt }],
        });
        if (result.isError) {
          throw new Error("Host rejected the follow-up message.");
        }
        await clearModelContext(state.app).catch(() => {
          // Ignore cleanup failures; the follow-up has already been sent.
        });
      }
    },
    [state.app],
  );

  const requestDisplayMode = useCallback(
    async (options: {
      mode: "inline" | "fullscreen" | "pip";
    }): Promise<void> => {
      if (!state.app) {
        return;
      }
      await state.app.requestDisplayMode(options);
    },
    [state.app],
  );

  const openExternal = useCallback(
    async (options: { href: string }): Promise<void> => {
      if (!state.app) {
        return;
      }
      try {
        const result = await state.app.openLink({ url: options.href });
        if (result?.isError) {
          window.open(options.href, "_blank", "noopener,noreferrer");
        }
      } catch (err) {
        console.log(
          "[Good Food MCP] openExternal: Response matching error (link may have opened):",
          err,
        );
      }
    },
    [state.app],
  );

  return {
    ...state,
    setWidgetState,
    callTool,
    sendFollowUpMessage,
    requestDisplayMode,
    openExternal,
  };
}
