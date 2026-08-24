import { useId } from "react";
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
 * The focus ring on a text field.
 *
 * Deliberately the same value as CTA_BG rather than a blue of its own: the
 * whole checkout is meant to read as the store's, and a blue ring above a
 * maroon button looked like two brands sharing a screen. It used to colour a
 * dot standing in for the Cashfree symbol as well; the real symbol carries its
 * own gradients now, so this is the ring alone. Kept as its own export so a
 * future decision to distinguish it from the CTA is one line, not a hunt.
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
 * The Cashfree symbol, traced from the brand pack's `circular/Light.svg` and
 * `circular/Dark.svg`.
 *
 * Those two files differ by exactly one node — a `<rect>` filled white in the
 * light one and black in the dark one — and carry identical paths and
 * gradients after it. So there is no light and dark symbol to choose between;
 * there is one symbol and a plate behind it. The plate is dropped here, which
 * is what makes a single component correct on both themes: the teal-to-green
 * and amber-to-pink gradients hold their own on white and on Claude's dark
 * ground, and nothing paints a disc that only suits one of them.
 *
 * Inline rather than an <img>: the widget is inlined into one HTML document
 * handed to the host, so a file would need either a data: URI paid for in
 * every resources/read or a remote origin declared in both CSP blocks — the
 * two blocks whose drift once blocked every product image on Claude.
 *
 * The gradient ids come from useId because the fills reference them by
 * `url(#…)`. PhoneEntry and OtpEntry each render two marks in one document,
 * and a fixed id would make the second pair duplicates — every fill then
 * resolving to whichever gradient the document happened to reach first.
 */
export function CashfreeSymbol({ className = "" }: { className?: string }) {
  const id = useId();
  const arch = `${id}-arch`;
  const inner = `${id}-inner`;

  return (
    <svg
      aria-hidden="true"
      focusable="false"
      className={className}
      viewBox="70 117 243 219"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
    >
      <path
        d="M223.266 121.05C232.298 121.05 240.912 123.986 247.889 129.307L247.895 129.297C248.99 130.224 250.116 131.102 251.159 132.091L295.76 170.28L295.774 170.293C305.826 178.239 310.854 190.994 308.837 203.571L308.81 203.742L308.779 203.914L284.415 331.593L262.834 310.1L284.415 199.698C285.014 195.845 283.454 191.856 280.342 189.386L261.834 173.82L240.661 287.275L219.311 266.017L238.436 163.563C239.26 159.165 238.022 154.523 235.138 151.103C232.171 147.601 227.882 145.646 223.266 145.646H98.629L73.9004 121.05H223.266Z"
        fill={`url(#${arch})`}
      />
      <path
        d="M214.687 180.833L201.992 248.756L180.643 227.5V227.093L185.259 202.497L188.144 187.186H140.251L115.521 162.59H199.272C201.465 162.59 205.734 162.59 209.612 162.59C213.859 162.59 217.097 166.389 216.411 170.581C215.782 174.425 215.079 178.663 214.687 180.833Z"
        fill={`url(#${inner})`}
      />
      <defs>
        <linearGradient
          id={arch}
          x1="106.774"
          y1="121.05"
          x2="106.774"
          y2="287.274"
          gradientUnits="userSpaceOnUse"
        >
          <stop stopColor="#00ADA1" />
          <stop offset="0.668269" stopColor="#00AD5B" />
        </linearGradient>
        <linearGradient
          id={inner}
          x1="132.748"
          y1="162.59"
          x2="132.748"
          y2="248.756"
          gradientUnits="userSpaceOnUse"
        >
          <stop stopColor="#FBB016" />
          <stop offset="0.668269" stopColor="#FF8FA7" />
        </linearGradient>
      </defs>
    </svg>
  );
}

/**
 * The Cashfree lockup: the real symbol, then the name as text.
 *
 * The name stays text on purpose. The brand pack's full wordmark ships in
 * fixed black (`Light Background`) or fixed white (`Dark background`), and
 * these marks sit inside lines whose colour is the host's — `text-secondary`,
 * `text-tertiary`. An image wordmark would therefore be invisible on one of
 * the two themes unless both files shipped and something chose between them at
 * runtime, and the widget cannot read the host's theme. Text inherits it for
 * free, so only the symbol — which is theme-independent — is drawn.
 *
 * This replaced a maroon dot standing in for the symbol. The dot was never the
 * brand; it was a placeholder from before the assets existed here.
 */
export function CashfreeMark({ className = "" }: { className?: string }) {
  return (
    <span className={`inline-flex items-center gap-1 font-semibold ${className}`}>
      <CashfreeSymbol className="h-3.5 w-auto shrink-0" />
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
