import { useSyncExternalStore } from "react";
import { getClientPlatform, type ClientPlatform } from "../utils/platform";

/**
 * Hook to subscribe to platform global values
 * Works through the ClientPlatform abstraction for both OpenAI legacy and MCP Apps
 */
export function useOpenAiGlobal<K extends keyof ClientPlatform>(
  key: K,
): ClientPlatform[K] {
  return useSyncExternalStore(
    (onChange) => getClientPlatform().subscribe(onChange),
    () => getClientPlatform()[key],
  );
}

export function useToolInput() {
  return useOpenAiGlobal("toolInput");
}

export function useToolOutput() {
  return useOpenAiGlobal("toolOutput");
}

export function useToolResponseMetadata() {
  return useOpenAiGlobal("toolResponseMetadata");
}

export function useTheme() {
  return useOpenAiGlobal("theme");
}

export function useDisplayMode() {
  return useOpenAiGlobal("displayMode");
}

export function useLocale() {
  return useOpenAiGlobal("locale");
}
