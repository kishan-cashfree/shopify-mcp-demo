import { describe, it, expect } from "vitest";
import { loadCashfreeConfig } from "./config";

const CREDS = {
  CASHFREE_CLIENT_ID: "id-123",
  CASHFREE_CLIENT_SECRET: "secret-456",
} as NodeJS.ProcessEnv;

describe("loadCashfreeConfig", () => {
  it("defaults to sandbox when CASHFREE_ENV is unset", () => {
    // The direction of this default is the whole point: a missing or misspelled
    // env var must not be able to charge a real card.
    const config = loadCashfreeConfig({ ...CREDS });

    expect(config.environment).toBe("sandbox");
    expect(config.baseUrl).toBe("https://sandbox.cashfree.com");
  });

  it.each(["Production", "prod", "PRODUCTION", "", "live"])(
    "stays on sandbox for CASHFREE_ENV=%o",
    (value) => {
      // Only the exact string "production" opts in. Anything close-but-wrong
      // falls back to sandbox rather than guessing what was meant.
      const config = loadCashfreeConfig({ ...CREDS, CASHFREE_ENV: value });

      expect(config.environment).toBe("sandbox");
      expect(config.baseUrl).toBe("https://sandbox.cashfree.com");
    },
  );

  it("switches to the live API only on an exact 'production'", () => {
    const config = loadCashfreeConfig({
      ...CREDS,
      CASHFREE_ENV: "production",
    });

    expect(config.environment).toBe("production");
    expect(config.baseUrl).toBe("https://api.cashfree.com");
  });

  it("passes the credentials through untouched", () => {
    const config = loadCashfreeConfig({ ...CREDS });

    expect(config.clientId).toBe("id-123");
    expect(config.clientSecret).toBe("secret-456");
  });

  it("throws when the client id is missing", () => {
    // Failing at boot beats failing at the payment step, where the buyer is
    // already waiting and the error surfaces as a dead widget.
    expect(() =>
      loadCashfreeConfig({ CASHFREE_CLIENT_SECRET: "secret-456" }),
    ).toThrow(/CASHFREE_CLIENT_ID/);
  });

  it("throws when the client secret is missing", () => {
    expect(() => loadCashfreeConfig({ CASHFREE_CLIENT_ID: "id-123" })).toThrow(
      /CASHFREE_CLIENT_SECRET/,
    );
  });

  it("treats an empty credential as missing rather than valid", () => {
    // .env.example ships these blank, so "" is the realistic failure, not
    // undefined — and an empty key would otherwise reach Cashfree as a 401.
    expect(() =>
      loadCashfreeConfig({
        CASHFREE_CLIENT_ID: "",
        CASHFREE_CLIENT_SECRET: "secret-456",
      }),
    ).toThrow(/CASHFREE_CLIENT_ID/);
  });
});
