import { useState, useEffect, useCallback, SetStateAction } from "react";
import { useOpenAiGlobal } from "./useOpenAiGlobal";
import { getClientPlatform } from "../utils/platform";
import type { WidgetState } from "../types";

/** Marks a write as newer than everything already stored. */
export function stamp<T extends WidgetState>(state: T): T {
  return { ...state, revision: (state.revision ?? 0) + 1 };
}

/**
 * Whether an incoming snapshot should be allowed to replace the current one.
 *
 * Every earlier widget in a conversation stays live and writes to the same
 * localStorage key, with nothing ordering them. Without this, the widget
 * showing a fresh search could be overwritten wholesale by the one still
 * displaying a finished payment.
 */
export function isFresher(incoming: WidgetState, current: WidgetState): boolean {
  if (current.revision === undefined) return true;
  return (incoming.revision ?? -1) >= current.revision;
}

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
    if (widgetStateFromWindow == null) return;
    _setWidgetState((prev) =>
      isFresher(widgetStateFromWindow, prev) ? widgetStateFromWindow : prev,
    );
  }, [widgetStateFromWindow]);

  const setWidgetState = useCallback((state: SetStateAction<T>) => {
    _setWidgetState((prevState) => {
      const next =
        typeof state === "function"
          ? (state as (prev: T) => T)(prevState)
          : state;

      if (next == null) return next;
      // Unchanged state must not burn a revision — every widget writes on
      // render, and bumping regardless would have them ratchet past each
      // other forever.
      if (next === prevState) return prevState;

      const stamped = stamp(next);
      getClientPlatform().setWidgetState(stamped);
      return stamped;
    });
  }, []);

  return [widgetState, setWidgetState] as const;
}
