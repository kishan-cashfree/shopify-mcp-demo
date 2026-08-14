import { describe, it, expect } from "vitest";
import { isFresher, stamp } from "./useWidgetState";
import type { WidgetState } from "../types";

const BASE: WidgetState = { screen: "results", quantities: {}, revision: 4 };

describe("stamp", () => {
  it("advances the revision on every write", () => {
    expect(stamp(BASE).revision).toBe(5);
  });

  it("starts counting for state that has never been stamped", () => {
    const unstamped: WidgetState = { screen: "results", quantities: {} };

    expect(stamp(unstamped).revision).toBe(1);
  });
});

describe("isFresher", () => {
  it("rejects the snapshot a previous widget left behind", () => {
    // The exact revert seen live: a reset landed at one revision and the older
    // widget's whole state replaced it a render later, so the buyer watched
    // the paid receipt flash back over the products they had asked for.
    const incoming: WidgetState = { ...BASE, screen: "checkout", revision: 3 };

    expect(isFresher(incoming, BASE)).toBe(false);
  });

  it("accepts a newer snapshot", () => {
    const incoming: WidgetState = { ...BASE, revision: 5 };

    expect(isFresher(incoming, BASE)).toBe(true);
  });

  it("accepts an equal revision, which is the same state re-delivered", () => {
    // Re-applying identical state is harmless, and refusing it would drop a
    // legitimate host redelivery after a reload.
    expect(isFresher({ ...BASE }, BASE)).toBe(true);
  });

  it("accepts anything when nothing has been stamped yet", () => {
    // First run, or state written by a build before revisions existed.
    const current: WidgetState = { screen: "results", quantities: {} };
    const incoming: WidgetState = { screen: "cart", quantities: {} };

    expect(isFresher(incoming, current)).toBe(true);
  });

  it("rejects unstamped state once a revision exists", () => {
    // An old widget still running the previous build would otherwise clobber
    // every reset the new one makes.
    const incoming: WidgetState = { screen: "checkout", quantities: {} };

    expect(isFresher(incoming, BASE)).toBe(false);
  });
});
