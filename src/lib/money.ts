/**
 * Minor units → major units, using the currency's own decimal count rather
 * than a hardcoded 100. JPY has none, and dividing it would bill a hundredth
 * of the real amount.
 *
 * Shared rather than duplicated per integration: Cashfree wants a number and
 * Shopify wants a decimal string, but underneath it is one currency rule, and
 * two copies of a currency rule is how one of them ends up wrong.
 */
export function decimalDigits(currency: string): number {
  return (
    new Intl.NumberFormat("en", {
      style: "currency",
      currency,
    }).resolvedOptions().maximumFractionDigits ?? 2
  );
}

export function toMajor(amountMinor: number, currency: string): number {
  return amountMinor / 10 ** decimalDigits(currency);
}

/**
 * The same value as a decimal string, which is what Shopify's Decimal scalar
 * takes. `toMajor` alone would send 1200 for ₹1,200.00 and 0.1 + 0.2 arithmetic
 * for anything that does not divide cleanly; fixing the digits at the
 * currency's own count keeps the string exact.
 */
export function toMajorString(amountMinor: number, currency: string): string {
  return toMajor(amountMinor, currency).toFixed(decimalDigits(currency));
}
