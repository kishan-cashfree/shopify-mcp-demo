import { useState, useEffect, useCallback, SetStateAction } from "react";
import { useOpenAiGlobal } from "./useOpenAiGlobal";
import { getClientPlatform } from "../utils/platform";
import type { WidgetState } from "../types";

/**
 * Hook to manage widget state that persists across renders
 * Syncs with host (legacy or MCP) via ClientPlatform
 */
export function useWidgetState<T extends WidgetState>(
  defaultState: T | (() => T),
): readonly [T, (state: SetStateAction<T>) => void] {
  const widgetStateFromWindow = useOpenAiGlobal("widgetState") as T | null;

  const [widgetState, _setWidgetState] = useState<T>(() => {
    if (widgetStateFromWindow != null) {
      return widgetStateFromWindow;
    }
    return typeof defaultState === "function"
      ? (defaultState as () => T)()
      : defaultState;
  });

  useEffect(() => {
    if (widgetStateFromWindow != null) {
      _setWidgetState(widgetStateFromWindow);
    }
  }, [widgetStateFromWindow]);

  const setWidgetState = useCallback((state: SetStateAction<T>) => {
    _setWidgetState((prevState) => {
      const newState =
        typeof state === "function"
          ? (state as (prev: T) => T)(prevState)
          : state;

      if (newState != null) {
        getClientPlatform().setWidgetState(newState);
      }

      return newState;
    });
  }, []);

  return [widgetState, setWidgetState] as const;
}
