import { useState, useEffect } from "react";
import { getClientPlatform } from "../utils/platform";
import type { McpUiHostContext } from "@modelcontextprotocol/ext-apps";

/**
 * Hook to access MCP Apps host context (theme, styles, fonts, safe area)
 * Returns null for legacy OpenAI environment
 */
export function useHostContext(): McpUiHostContext | null {
  const [context, setContext] = useState<McpUiHostContext | null>(null);

  useEffect(() => {
    const platform = getClientPlatform();

    const initialContext = platform.getHostContext();
    setContext(initialContext);

    const unsubscribe = platform.subscribe(() => {
      const updatedContext = platform.getHostContext();
      setContext(updatedContext);
    });

    return unsubscribe;
  }, []);

  return context;
}
