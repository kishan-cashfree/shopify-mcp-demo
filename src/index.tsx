// Must be imported first so Tailwind layers exist before any component styles.
import "./main.css";

import { useEffect } from "react";
import { createRoot } from "react-dom/client";
import { useDocumentTheme } from "@openai/apps-sdk-ui/theme";
import { LoadingIndicator } from "@openai/apps-sdk-ui/components/Indicator";
import { useToolResponseMetadata, useToolInput } from "./hooks/useOpenAiGlobal";
import { useMcpApp } from "./hooks/useMcpApp";
import { App } from "./components/App";
import { isOpenAiLegacy } from "./utils/platform";
import type { ToolResponseMetadata } from "./types";

interface HostContext {
  theme?: string;
  styles?: { variables?: Record<string, string | undefined> };
}

function applyHostContext(ctx: HostContext | null) {
  if (ctx?.theme) {
    document.documentElement.setAttribute("data-theme", ctx.theme);
  }
  if (ctx?.styles?.variables) {
    const root = document.documentElement;
    for (const [key, value] of Object.entries(ctx.styles.variables)) {
      if (value !== undefined) {
        root.style.setProperty(`--${key}`, value);
      }
    }
  }
}

function OpenAiToolRouter() {
  const toolMeta = useToolResponseMetadata() as ToolResponseMetadata | null;
  const toolInput = useToolInput();
  useDocumentTheme();
  return <App toolMeta={toolMeta} toolInput={toolInput} />;
}

function McpToolRouter() {
  const { isConnected, error, toolResponseMetadata, toolInput, hostContext } =
    useMcpApp();

  useEffect(() => {
    if (hostContext) applyHostContext(hostContext as HostContext);
  }, [hostContext]);

  if (error) {
    return (
      <div className="flex h-64 flex-col items-center justify-center">
        <p className="text-lg font-medium text-red-500">Connection Error</p>
        <p className="mt-2 text-sm text-secondary">{error.message}</p>
      </div>
    );
  }

  if (!isConnected) {
    return (
      <div className="flex h-64 flex-col items-center justify-center">
        <LoadingIndicator size={48} strokeWidth={4} />
        <p className="mt-4 text-sm text-secondary">Connecting…</p>
      </div>
    );
  }

  return (
    <App
      toolMeta={toolResponseMetadata as ToolResponseMetadata | null}
      toolInput={toolInput}
    />
  );
}

function Root() {
  return isOpenAiLegacy() ? <OpenAiToolRouter /> : <McpToolRouter />;
}

const container = document.getElementById("root");
if (container) {
  createRoot(container).render(<Root />);
}
