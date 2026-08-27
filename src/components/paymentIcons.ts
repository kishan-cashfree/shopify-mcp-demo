/**
 * Brand marks shown beside each payment filter on the pay screen.
 *
 * The URLs are the ones `payments-icons-library@1.1.9` returns for
 * `getIcon(<key>, "svg")` — the same library cashfree-here uses. They are
 * copied rather than imported, for two reasons measured here:
 *
 *  - the package ships one 28KB UMD bundle with no ESM entry and no types
 *    (cashfree-here hand-writes an ambient `.d.ts` for it), and everything it
 *    does is map a string to a CDN URL. Bundling it into a widget that is
 *    inlined into a single HTML document to buy twelve strings is a bad trade.
 *  - it has no mode-level logo to offer. `getModesIcons(mode, "svg")` returns
 *    the *members* of a category — 8 cardschemes, 29 upi apps, 79 cardbanks —
 *    not one mark for "credit card" or "netbanking", and there is no
 *    `netbanking` category at all (banks are keyed individually and routed to
 *    the `nb/` path by PAYMENT_MODE_MAPPING). Worse, the lookup is fuzzy and
 *    never returns null: `getIcon("card")`, `getIcon("credit")` and
 *    `getIcon("netbanking")` all resolve to `pg/nb/svg/default.svg`, which
 *    utility.js names DEFAULT_URL — the not-found placeholder. Reaching for a
 *    mode icon therefore yields a wrong picture, not a missing one. Hence
 *    brands, curated from the categories the library does publish.
 *
 * To refresh after a library bump, run in a checkout that has it installed —
 * getModesIcons is the canonical listing, getIcon resolves one key:
 *   node -e 'import("payments-icons-library").then(({default:i})=>
 *     ["cardschemes","upi","cardbanks"].forEach(m=>
 *       console.log(m, i.getModesIcons(m,"svg").map(x=>x.icon_name).join(","))))'
 *
 * `https://cashfreelogo.cashfree.com` is already declared as a widget resource
 * domain in `src/lib/server/app.ts`; without it the host blocks every one of
 * these and a failed <img> reports nothing to the server.
 */
export interface PaymentIcon {
  /** Brand name. Carried as `title`, so a blocked icon still says something. */
  name: string;
  url: string;
}

const CDN = "https://cashfreelogo.cashfree.com/assets_images/pg";

/**
 * Illustrative, not exhaustive: the hosted page decides what it actually
 * offers. Three per row is what fits beside the label without wrapping on the
 * narrowest widget column.
 */
export const PAYMENT_METHOD_ICONS: Record<string, PaymentIcon[]> = {
  upi: [
    { name: "Google Pay", url: `${CDN}/upi/svg/gpay.svg` },
    { name: "PhonePe", url: `${CDN}/wallet/svg/phonepe.svg` },
    { name: "Paytm", url: `${CDN}/wallet/svg/paytm.svg` },
  ],
  // One cluster, because there is one card row. RuPay takes the third slot
  // rather than Amex: this row is now credit and debit together, RuPay is
  // debit-heavy in India and Amex issues almost no debit here, so Amex would
  // misstate the larger half of what the row covers.
  card: [
    { name: "Visa", url: `${CDN}/card/svg/visa.svg` },
    { name: "Mastercard", url: `${CDN}/card/svg/mastercard.svg` },
    { name: "RuPay", url: `${CDN}/card/svg/rupay.svg` },
  ],
  nb: [
    { name: "HDFC Bank", url: `${CDN}/nb/svg/hdfc.svg` },
    { name: "ICICI Bank", url: `${CDN}/nb/svg/icici.svg` },
    { name: "State Bank of India", url: `${CDN}/nb/svg/sbi.svg` },
  ],
};
