import { readFileSync } from "node:fs";
import { describe, it, expect, afterEach } from "vitest";
import { render, screen } from "@testing-library/react";
import { CashfreeMark, LoginWithCashfree, SecuredByCashfree } from "./checkoutChrome";

/**
 * The brand pack's own file, read off disk.
 *
 * In src/assets rather than a __fixtures__ folder: the UCP fixtures next door
 * are captured Shopify responses — evidence of what an external system sent —
 * while these are the canonical assets this widget ships. Same comparison,
 * honest about which kind of thing it is.
 *
 * Deliberately NOT imported by the component, which inlines the same artwork
 * as JSX. Two independent copies is the whole point: a test that read the one
 * source the component read would pass whatever either of them said.
 *
 * Read from the repo root, not import.meta.url — these tests run in jsdom,
 * where import.meta.url is an http: URL that readFileSync refuses.
 */
const brandFile = (theme: "light" | "dark") =>
  readFileSync(`src/assets/cashfree-logo-${theme}.svg`, "utf8");

const dOf = (svg: string) => [...svg.matchAll(/ d="([^"]+)"/g)].map((m) => m[1]);
const stopsOf = (svg: string) =>
  [...svg.matchAll(/stop-?[Cc]olor="([^"]+)"/g)].map((m) => m[1]);
const fillsOf = (el: HTMLElement) =>
  [...el.querySelectorAll("path")].map((p) => p.getAttribute("fill"));

describe("CashfreeMark", () => {
  afterEach(() => {
    // The surface probe reads document.body, which testing-library does not
    // reset between tests — a leaked dark background would silently flip every
    // later assertion to the wrong lockup.
    document.body.style.backgroundColor = "";
  });

  it("draws the Cashfree symbol inline, fetching nothing", () => {
    // The widget is inlined into one HTML document handed to the host. An
    // <img> would need either a data: URI paid for in every resources/read or
    // a remote origin declared in both CSP blocks. Inline SVG needs neither.
    const { container } = render(<CashfreeMark />);

    expect(container.querySelector("svg")).toBeInTheDocument();
    expect(container.querySelector("img")).toBeNull();
  });

  it("renders the light brand file's artwork with nothing altered", () => {
    // The assets are shipped as-is, so drift is what is worth catching: a
    // future tidy-up that drops the duplicate paths or re-exports the logo
    // fails here rather than in front of an audience. src/assets holds byte
    // copies of the brand pack's two full-colour files.
    const { container } = render(<CashfreeMark />);

    expect(dOf(container.innerHTML)).toEqual(dOf(brandFile("light")));
    expect(stopsOf(container.innerHTML)).toEqual(stopsOf(brandFile("light")));
  });

  it("swaps to the dark brand file when the host paints a dark ground", () => {
    // Not prefers-color-scheme: Claude's theme is its own control, so a buyer
    // in dark mode on a light OS would otherwise get the black wordmark on a
    // dark ground — invisible, which is the whole failure this avoids.
    document.body.style.backgroundColor = "rgb(28, 28, 30)";
    const { container } = render(<CashfreeMark />);

    expect(dOf(container.innerHTML)).toEqual(dOf(brandFile("dark")));
    expect(container.querySelector("svg")).toHaveAttribute(
      "viewBox",
      "0 0 500 109",
    );
  });

  it("falls back to the light lockup when the host sets no surface", () => {
    // getComputedStyle returns rgba(0, 0, 0, 0) for an unpainted body, which
    // is black by luminance. Reading that as "dark" would serve the white
    // wordmark onto the white default — the inverse of the bug above.
    document.body.style.backgroundColor = "";
    const { container } = render(<CashfreeMark />);

    expect(container.querySelector("svg")).toHaveAttribute(
      "viewBox",
      "0 0 370 80",
    );
  });

  it("names itself Cashfree, since the word is drawn rather than written", () => {
    // The wordmark is now the brand pack's own letterforms, so there is no
    // text node left to read. An aria-hidden lockup would make
    // SecuredByCashfree announce "Secured by" and stop.
    render(<CashfreeMark />);

    const svg = document.querySelector("svg");
    expect(svg).toHaveAttribute("role", "img");
    expect(svg).toHaveAttribute("aria-label", "Cashfree");
    expect(screen.getByLabelText("Cashfree")).toBeInTheDocument();
  });

  it("keeps each file's own wordmark colour", () => {
    // Ten black paths in the light file, eight white ones in the dark file —
    // they are separate exports, not one artwork tinted, which is also why
    // neither can stand in for the other.
    const light = render(<CashfreeMark />).container;
    expect(fillsOf(light).filter((f) => f === "black")).toHaveLength(10);

    document.body.style.backgroundColor = "rgb(28, 28, 30)";
    const dark = render(<CashfreeMark />).container;
    expect(fillsOf(dark).filter((f) => f === "white")).toHaveLength(8);
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
    const used = [...container.querySelectorAll("path")]
      .map((p) => p.getAttribute("fill") ?? "")
      .filter((fill) => fill.startsWith("url(#"))
      .map((fill) => fill.replace(/^url\(#(.*)\)$/, "$1"));

    expect(used.length).toBeGreaterThan(0);
    for (const id of used) expect(defined.has(id)).toBe(true);
  });
});
