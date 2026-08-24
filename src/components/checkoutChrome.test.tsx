import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { CashfreeMark, LoginWithCashfree, SecuredByCashfree } from "./checkoutChrome";

describe("CashfreeMark", () => {
  it("draws the Cashfree symbol inline, fetching nothing", () => {
    // The widget is inlined into one HTML document handed to the host. An
    // <img> would need either a data: URI paid for in every resources/read or
    // a remote origin declared in both CSP blocks. Inline SVG needs neither.
    const { container } = render(<CashfreeMark />);

    expect(container.querySelector("svg")).toBeInTheDocument();
    expect(container.querySelector("img")).toBeNull();
  });

  it("carries no backing rectangle", () => {
    // The brand pack ships the symbol on a baked-in disc: circular/Light.svg
    // opens with <rect fill="white"/> and circular/Dark.svg with
    // <rect fill="black"/>, the paths after them identical. Shipping either
    // asset as-is paints that disc behind the mark, so the light one shows a
    // white plate on Claude's dark theme. The rect is dropped; the gradient
    // reads on both grounds unaided.
    const { container } = render(<CashfreeMark />);

    expect(container.querySelector("svg rect")).toBeNull();
  });

  it("keeps the symbol out of the accessible name", () => {
    // Accessible names concatenate children with no separator — the defect
    // that shipped "Red1 in cart". The word carries the meaning.
    render(<CashfreeMark />);

    expect(screen.getByText("Cashfree")).toBeInTheDocument();
    const svg = document.querySelector("svg");
    expect(svg).toHaveAttribute("aria-hidden", "true");
  });

  it("gives every mark on a screen its own gradient ids", () => {
    // PhoneEntry and OtpEntry render both LoginWithCashfree and
    // SecuredByCashfree, so two marks share one document. The symbol's fills
    // are url(#id) references: with a fixed id the second mark's gradients are
    // duplicate DOM ids, and every fill resolves to whichever came first.
    const { container } = render(
      <>
        <LoginWithCashfree />
        <SecuredByCashfree />
      </>,
    );

    const ids = [...container.querySelectorAll("linearGradient")].map((g) => g.id);
    expect(ids.length).toBeGreaterThan(2);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("points every fill at a gradient that exists in the same mark", () => {
    const { container } = render(<CashfreeMark />);

    const defined = new Set(
      [...container.querySelectorAll("linearGradient")].map((g) => g.id),
    );
    const used = [...container.querySelectorAll("path")].map((p) =>
      (p.getAttribute("fill") ?? "").replace(/^url\(#(.*)\)$/, "$1"),
    );

    expect(used.length).toBeGreaterThan(0);
    for (const id of used) expect(defined.has(id)).toBe(true);
  });
});
