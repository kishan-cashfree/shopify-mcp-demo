/**
 * Hosts Cashfree's checkout SDK connects to once a payment starts.
 *
 * cashfree-here's widget CSP lists sandbox/api/sdk/cashfreelogo but not these,
 * so its checkout frame loads and then hangs on "Establishing secure
 * connection…" — the frame is allowed, its own calls are not. Our widget had
 * the identical gap and the identical symptom, and adding these cleared it.
 *
 * Patched by wrapping the package's resource handler rather than editing the
 * package: this repo does not own cashfree-here, and a wrapper is easy to
 * remove once the package ships these hosts itself.
 */
export const CASHFREE_PAYMENT_HOSTS = [
  "https://payments-test.cashfree.com",
  "https://payments.cashfree.com",
];

interface CspBlock {
  connect_domains?: string[];
  frame_domains?: string[];
  resource_domains?: string[];
}

interface UiCspBlock {
  connectDomains?: string[];
  frameDomains?: string[];
}

export interface WidgetResult {
  contents?: {
    uri?: string;
    _meta?: {
      "openai/widgetCSP"?: CspBlock;
      ui?: { csp?: UiCspBlock };
    };
  }[];
}

function merge(existing: string[] | undefined): string[] {
  return [...new Set([...(existing ?? []), ...CASHFREE_PAYMENT_HOSTS])];
}

export function augmentCashfreeCsp<T extends WidgetResult>(result: T): T {
  for (const content of result.contents ?? []) {
    const csp = content._meta?.["openai/widgetCSP"];
    if (csp) {
      csp.connect_domains = merge(csp.connect_domains);
      csp.frame_domains = merge(csp.frame_domains);
    }

    // Both blocks are kept in step: hosts read one or the other depending on
    // version, and guessing which is live would be a silent failure.
    const ui = content._meta?.ui?.csp;
    if (ui) {
      ui.connectDomains = merge(ui.connectDomains);
      ui.frameDomains = merge(ui.frameDomains);
    }
  }

  return result;
}
