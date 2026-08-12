import { describe, it, expect, vi } from "vitest";
import { checkStorefrontAccess, storefrontWarning } from "./storefront";

function response(status: number, location?: string) {
  return {
    status,
    headers: { get: (h: string) => (h === "location" ? (location ?? null) : null) },
  } as unknown as Response;
}

describe("checkStorefrontAccess", () => {
  it("reports a password gate when the root redirects to /password", async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValue(
        response(302, "https://shop.myshopify.com/password"),
      );

    const result = await checkStorefrontAccess("shop.myshopify.com", fetchImpl);

    expect(result).toEqual({ reachable: true, passwordProtected: true });
    // Must not follow the redirect: following it lands on a 200 password page
    // and the gate becomes invisible.
    expect(fetchImpl.mock.calls[0][1]).toMatchObject({ redirect: "manual" });
  });

  it("reports an open storefront on 200", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(response(200));

    const result = await checkStorefrontAccess("shop.myshopify.com", fetchImpl);

    expect(result).toEqual({ reachable: true, passwordProtected: false });
  });

  it("treats a redirect that is not the password page as open", async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValue(response(302, "https://shop.myshopify.com/en-in"));

    const result = await checkStorefrontAccess("shop.myshopify.com", fetchImpl);

    expect(result.passwordProtected).toBe(false);
  });

  it("reports unreachable rather than throwing when the network fails", async () => {
    const fetchImpl = vi.fn().mockRejectedValue(new Error("ENOTFOUND"));

    const result = await checkStorefrontAccess("nope.myshopify.com", fetchImpl);

    // A boot-time probe must never prevent the server from starting.
    expect(result.reachable).toBe(false);
    expect(result.detail).toMatch(/ENOTFOUND/);
  });
});

describe("storefrontWarning", () => {
  it("reports a password gate without claiming checkout is blocked", () => {
    const warning = storefrontWarning(
      { reachable: true, passwordProtected: true },
      "shop.myshopify.com",
    );

    expect(warning).toMatch(/password/i);
    // Measured on a live gated store: /checkouts/cn/ returns 200 while the
    // storefront root redirects to /password. Saying checkout is blocked sends
    // someone to change a setting that is not the problem.
    expect(warning).toMatch(/checkout/i);
    expect(warning).not.toMatch(/checkout link redirects|cannot be reached/i);
    expect(warning).toMatch(/catalog|search/i);
  });

  it("returns null for an open store", () => {
    expect(
      storefrontWarning(
        { reachable: true, passwordProtected: false },
        "shop.myshopify.com",
      ),
    ).toBeNull();
  });

  it("warns when the store could not be reached", () => {
    const warning = storefrontWarning(
      { reachable: false, passwordProtected: false, detail: "ENOTFOUND" },
      "nope.myshopify.com",
    );

    expect(warning).toMatch(/couldn't reach|could not reach/i);
    expect(warning).toContain("nope.myshopify.com");
  });
});
