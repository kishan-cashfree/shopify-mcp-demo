/**
 * The shared surface of the Cashfree checkout screens.
 *
 * One definition per token because two hand-maintained copies of the same
 * colour is exactly how this widget's two CSP blocks came to disagree and
 * block every product image on Claude. Phone entry, OTP, address and payment
 * are one continuous flow to a buyer; they have to look like it.
 */
/**
 * Every primary call to action — Continue, Verify, Checkout, Add, Add to cart.
 *
 * Taken from the storefront's own add-to-cart button (computed background
 * #3B0A00, white text) so the widget's buttons read as the store's, not as a
 * generic checkout's. One constant because these screens are one flow: a
 * second copy is how two hand-maintained CSP blocks came to disagree and block
 * every product image on Claude.
 */
export const CTA_BG = "#3b0a00";

/**
 * The Cashfree mark's dot and the focus ring on a text field.
 *
 * Deliberately the same value as CTA_BG rather than a blue of its own: the
 * whole checkout is meant to read as the store's, and a blue dot beside a
 * maroon button looked like two brands sharing a screen. Kept as its own
 * export so a future decision to distinguish them is one line, not a hunt.
 */
export const BRAND_MARK = CTA_BG;


/**
 * The discount badge, kept distinct from the CTA on purpose: a "-13%" pill in
 * the button colour reads as something to press.
 */
export const ACCENT_BLUE = "#3b5ce8";
/* FIELD_DARK (#1c1c1e) used to fill the catalog cards and the cart panel. The
   blocks read as unfinished against the host's white chrome, so the panels are
   white now and #1c1c1e survives only as their body copy, inline in each
   component. Nothing imports a fill colour any more. */

/**
 * The Cashfree wordmark, as text rather than an image.
 *
 * No asset is fetched: the widget is inlined into one HTML document handed to
 * the host, so an <img> would need either a data: URI (weight in every
 * resources/read) or a remote origin declared in the widget CSP. A dot and a
 * word cost neither.
 */
export function CashfreeMark({ className = "" }: { className?: string }) {
  return (
    <span className={`inline-flex items-center gap-1 font-semibold ${className}`}>
      <span
        aria-hidden="true"
        className="h-2 w-2 rounded-full"
        style={{ backgroundColor: BRAND_MARK }}
      />
      Cashfree
    </span>
  );
}

/** "Login with ● cashfree" — the attribution line above each step's heading. */
export function LoginWithCashfree() {
  return (
    <p className="mt-4 flex items-center gap-1.5 text-sm text-secondary">
      Login with <CashfreeMark className="text-secondary" />
    </p>
  );
}

/** "🔒 Secured by ● cashfree" — the footer every checkout step carries. */
export function SecuredByCashfree() {
  return (
    <p className="mt-8 flex items-center justify-center gap-1.5 text-sm text-tertiary">
      <span aria-hidden="true">🔒</span>
      Secured by <CashfreeMark className="text-secondary" />
    </p>
  );
}

/**
 * A back link. The chevron is aria-hidden so the accessible name stays exactly
 * the label — this widget has already shipped a name that ran together as
 * "Red1 in cart".
 */
export function BackLink({
  label,
  onClick,
}: {
  label: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="-ml-1 flex items-center gap-1 self-start text-sm text-secondary"
    >
      <span aria-hidden="true">‹</span>
      {label}
    </button>
  );
}
