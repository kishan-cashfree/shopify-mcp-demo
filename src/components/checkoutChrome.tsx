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
 * Every screen's primary action, at one height.
 *
 * They had drifted to five: py-3.5 on phone and OTP, py-3 on the address and
 * result screens, py-2.5 on Add to cart, py-2 on both View cart bars. One
 * screen at a time nothing looks wrong; walked end to end the button changes
 * size four times.
 *
 * The height is stated (h-12) rather than derived from padding, because
 * py-3.5 + text-base and py-3 + text-sm are 52px and 44px — matching those by
 * eye is exactly how they drifted. Add `w-full` where the button spans the
 * screen; the bars that sit beside a total leave it off.
 */
export const CTA_BASE =
  "flex h-12 items-center justify-center gap-2 rounded-xl text-base font-semibold text-white disabled:cursor-not-allowed disabled:opacity-40";

/** The screen-spanning CTA. Add `w-full` where the parent does not stretch it. */
export const CTA_CLASS = `${CTA_BASE} px-4`;

/**
 * The same button sized to its label, centred.
 *
 * For a CTA that is not the width of the screen.
 *
 * The width is stated rather than left to the label, because the control that
 * replaces this one is a different shape entirely: once the buyer adds an item,
 * Add to cart gives way to a −/+ stepper. Sized to their own contents the two
 * are different widths, so the button appears to change size at the moment it
 * is pressed. CTA_INLINE_WIDTH is shared by both.
 *
 * Stating the width also settles the stretch problem this used to carry a
 * `self-start` for: a `flex` button in a `flex-col` is spread edge to edge by
 * align-items, but only while its width is auto. `shrink-0` is what it needs
 * now that it shares a row with a secondary button — without it the row
 * squeezes this one to fit the other.
 */
export const CTA_INLINE_WIDTH = "w-44";

export const CTA_INLINE_CLASS = `${CTA_BASE} shrink-0 ${CTA_INLINE_WIDTH}`;

/**
 * A text field, at the same height as the button under it.
 *
 * Both fields were `py-3`, which looked matched and was not: py-3 with
 * text-base is 48px and py-3 with text-lg is 52px, so the OTP box stood 4px
 * taller than its Verify button while the phone box happened to line up. The
 * height is stated for the same reason CTA_CLASS states its own.
 *
 * The colours are left to the caller — the focus ring differs between the two
 * screens and turns red on error.
 */
/**
 * The submit arrow that lives at the end of a field.
 *
 * Round, filled with CTA_BG, and always given an aria-label: an arrow has no
 * accessible name of its own, and on these screens it is the only way forward.
 */
export const FIELD_SUBMIT_CLASS =
  "flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-white disabled:cursor-not-allowed disabled:opacity-30";

/** The arrow itself. Decorative — the button around it carries the name. */
export function ArrowRightIcon() {
  return (
    <svg
      aria-hidden="true"
      focusable="false"
      viewBox="0 0 24 24"
      className="h-5 w-5"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M5 12h13M13 6l6 6-6 6" />
    </svg>
  );
}

export const FIELD_BASE =
  "flex h-12 items-center gap-3 rounded-xl bg-white px-4";

/** The field on its own line. In a row beside a button, use FIELD_BASE. */
export const FIELD_CLASS = `${FIELD_BASE} w-full`;

/**
 * The quieter of two buttons standing next to each other.
 *
 * Outlined in the CTA colour rather than filled with it. Two filled maroon
 * buttons side by side tell a buyer nothing about which one the screen is for;
 * on the product screen, adding is the act and the cart is a destination.
 * Same box as CTA_BASE, so the pair line up.
 */
export const CTA_SECONDARY_CLASS =
  "flex h-12 items-center justify-center gap-2 rounded-xl border-2 px-4 text-base font-semibold disabled:cursor-not-allowed disabled:opacity-40";

/**
 * The compact action inside a catalog card, deliberately not CTA_CLASS.
 *
 * A card is a third of the grid's width and holds an image, two lines of text
 * and a price; a 48px button under that is the loudest thing on the screen and
 * pushes the price out of the tile. One height for every in-card control, and
 * a different one from the screen's own CTA.
 */
export const CTA_COMPACT_CLASS =
  "flex h-10 w-full items-center justify-center rounded-xl px-3 text-sm font-semibold text-white disabled:cursor-not-allowed disabled:opacity-40";

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
 * Whether the host is painting a dark ground.
 *
 * Read from the colour the host actually resolved, NOT from
 * `prefers-color-scheme`. That media query reports the operating system's
 * setting, and Claude's theme is its own control: a buyer running Claude in
 * dark on a light OS would be served the light lockup, whose wordmark is
 * `fill="black"` — a mark that is not merely off-brand but invisible. Getting
 * this wrong has exactly one failure mode and it is the bad one, so the signal
 * has to be what is on the screen rather than what the OS prefers.
 *
 * `--color-surface` is the variable the Apps SDK publishes and `main.css`
 * already paints the body with, defaulting to #ffffff when the host sets
 * nothing. So an unknown host degrades to the light lockup on a light default,
 * which is coherent.
 *
 * Luminance rather than a string match: the value arrives as a resolved
 * `rgb(…)` and its exact colour is the host's business, not ours.
 */
function surfaceIsDark(): boolean {
  if (typeof window === "undefined" || !document.body) return false;

  const resolved = getComputedStyle(document.body).backgroundColor;
  const channels = resolved.match(/\d+(\.\d+)?/g);
  if (!channels || channels.length < 3) return false;

  const [r, g, b] = channels.slice(0, 3).map(Number);
  // Rec. 601 luma, which is enough to answer "is this dark" and needs no
  // gamma work. A fully transparent body reads as rgba(0,0,0,0) — black by
  // these numbers — so alpha is checked before trusting it.
  const alpha = channels[3] === undefined ? 1 : Number(channels[3]);
  if (alpha === 0) return false;

  return (0.299 * r + 0.587 * g + 0.114 * b) / 255 < 0.5;
}

/**
 * The Cashfree lockup, from the brand pack's two full-colour files:
 * `cashfree logo full (color) on white.svg` and `… on black.svg`.
 *
 * Both are used as shipped. Neither is recoloured, redrawn or trimmed — the
 * light file keeps its clip group and the two paths its export draws twice
 * (`paint0` repeats `paint1`, `paint2` sits under an identical `paint3`), and
 * the dark file keeps its own eight-path wordmark. They are separate exports,
 * not one artwork tinted: different viewBoxes (370x80 against 500x109) and
 * different path counts, so neither can stand in for the other.
 *
 * They do agree on proportion, which is why one height suits both — measured
 * from the path data, content aspect is 6.00 in each and content fills 0.763
 * of the light box against 0.761 of the dark. Same `h-5` therefore renders
 * them at the same optical size.
 *
 * The only departures from the files are the two attribute spellings React
 * requires — `clip-path` to `clipPath`, `stop-color` to `stopColor` — and the
 * ids, which come from useId. That last is not cosmetic: PhoneEntry and
 * OtpEntry each render two marks in one document, and the files' baked-in ids
 * (`paint0_linear_1947_2866`, `clip0_1947_2866`) would then be duplicate DOM
 * ids, with every `url(#…)` resolving to whichever copy the document reached
 * first. Same artwork, addressable twice.
 *
 * Inline rather than <img>. The widget is inlined into one HTML document
 * handed to the host, so a file would need either a data: URI paid for on
 * every resources/read, or a remote origin declared in both CSP blocks — the
 * two blocks whose drift once blocked every product image on Claude.
 *
 * The theme is sampled during render rather than in an effect, so the correct
 * lockup is the first one painted; an effect would flash the wrong one. A
 * theme changed mid-session is picked up on the next remount, which in Claude
 * is one scroll away — see the remount note in CLAUDE.md.
 */
export function CashfreeMark({ className = "" }: { className?: string }) {
  const id = useId();
  const clip = `${id}-clip`;
  const p0 = `${id}-p0`;
  const p1 = `${id}-p1`;
  const p2 = `${id}-p2`;
  const p3 = `${id}-p3`;

  // h-5, not the h-3.5 the old traced symbol used. The letterforms fill ~76%
  // of the box, so the name lands at ~15px inside a 20px one — level with the
  // 14px text beside it.
  const shared = `inline-block h-5 w-auto shrink-0 ${className}`;

  if (surfaceIsDark()) {
    return (
      <svg
        role="img"
        aria-label="Cashfree"
        className={shared}
        width="500"
        height="109"
        viewBox="0 0 500 109"
        fill="none"
        xmlns="http://www.w3.org/2000/svg"
      >
      <path d="M139.604 88.3152C133.707 88.3152 128.729 87.1477 124.671 84.8127C120.613 82.4777 117.569 79.2276 115.54 75.0624C113.511 70.8972 112.591 66.0694 112.782 60.5789C112.908 54.7729 113.955 49.4086 115.92 44.4862C117.95 39.5006 120.708 35.1776 124.196 31.5173C127.683 27.7939 131.741 24.9224 136.37 22.9029C141.063 20.8203 146.136 19.7791 151.589 19.7791C159.579 19.7791 165.825 21.767 170.327 25.7428C174.829 29.7187 177.08 35.3354 177.08 42.5929H162.908C162.781 39.0588 161.576 36.3136 159.293 34.3572C157.011 32.3377 153.745 31.328 149.496 31.328C146.136 31.328 143.06 32.0222 140.27 33.4106C137.48 34.7989 135.007 36.7553 132.851 39.2797C130.759 41.804 129.11 44.7701 127.905 48.178C126.7 51.5859 126.066 55.3093 126.003 59.3483C125.876 63.0086 126.415 66.1325 127.62 68.7199C128.825 71.3074 130.6 73.3269 132.946 74.7784C135.356 76.1668 138.273 76.861 141.697 76.861C145.945 76.861 149.496 75.9459 152.35 74.1157C155.203 72.2856 157.328 69.6666 158.723 66.2587H172.895C171.183 70.9287 168.71 74.9046 165.476 78.1863C162.305 81.4679 158.532 83.9923 154.157 85.7593C149.782 87.4633 144.931 88.3152 139.604 88.3152Z" fill="white" />
      <path d="M195.351 88.3152C191.42 88.3152 188.027 87.3686 185.174 85.4753C182.384 83.5821 180.259 81.0262 178.801 77.8076C177.342 74.5259 176.677 70.8656 176.803 66.8267C176.93 62.7877 177.691 59.0643 179.086 55.6564C180.481 52.2485 182.384 49.2824 184.793 46.7581C187.266 44.1706 190.088 42.1827 193.259 40.7943C196.429 39.3428 199.822 38.617 203.436 38.617C207.304 38.617 210.411 39.3112 212.757 40.6996C215.167 42.088 216.942 43.8551 218.084 46.0008L220.652 39.753H232.066L223.601 87.1793H212.187L211.901 80.6475C210.76 81.9728 209.397 83.235 207.811 84.434C206.226 85.6331 204.387 86.5797 202.295 87.2739C200.265 87.9681 197.951 88.3152 195.351 88.3152ZM200.487 77.145C203.277 77.145 205.782 76.4192 208.002 74.9677C210.284 73.5162 212.092 71.5914 213.423 69.1933C214.755 66.732 215.452 64.0183 215.516 61.0522C215.579 58.7803 215.199 56.8239 214.374 55.1831C213.55 53.4792 212.313 52.1539 210.665 51.2072C209.079 50.2606 207.145 49.7873 204.863 49.7873C202.136 49.7873 199.663 50.4815 197.444 51.8699C195.224 53.1952 193.449 55.0569 192.117 57.455C190.849 59.79 190.151 62.4406 190.025 65.4067C189.961 67.6155 190.342 69.635 191.166 71.4652C191.99 73.2322 193.195 74.6206 194.78 75.6304C196.366 76.6401 198.268 77.145 200.487 77.145Z" fill="white" />
      <path d="M250.637 88.3152C246.198 88.3152 242.457 87.5895 239.413 86.138C236.433 84.6865 234.182 82.6985 232.66 80.1742C231.202 77.5867 230.631 74.7153 230.948 71.5598H243.694C243.63 72.9482 243.916 74.1789 244.55 75.2517C245.184 76.3246 246.135 77.1765 247.403 77.8076C248.735 78.3756 250.352 78.6596 252.254 78.6596C253.966 78.6596 255.393 78.4071 256.534 77.9023C257.739 77.3974 258.659 76.7032 259.293 75.8197C259.99 74.9362 260.371 73.958 260.434 72.8851C260.434 71.8123 260.085 70.9603 259.388 70.3292C258.754 69.6981 257.803 69.1617 256.534 68.7199C255.329 68.2782 253.871 67.8995 252.159 67.584C250.066 67.0791 248.006 66.4796 245.976 65.7854C244.011 65.0912 242.235 64.2392 240.65 63.2295C239.128 62.2197 237.923 60.9891 237.035 59.5376C236.148 58.0861 235.736 56.3506 235.799 54.3311C235.862 51.3019 236.814 48.6198 238.652 46.2848C240.555 43.8866 243.123 42.0249 246.357 40.6996C249.591 39.3112 253.269 38.617 257.39 38.617C263.161 38.617 267.631 39.9423 270.802 42.5929C274.036 45.2435 275.589 48.8407 275.462 53.3845H263.192C263.129 51.8699 262.431 50.6708 261.1 49.7873C259.832 48.8407 258.088 48.3673 255.868 48.3673C253.713 48.3673 251.937 48.8407 250.542 49.7873C249.147 50.6708 248.449 51.7752 248.449 53.1005C248.386 53.984 248.703 54.7413 249.401 55.3724C250.162 56.0035 251.208 56.5715 252.539 57.0764C253.871 57.5181 255.488 57.9283 257.39 58.307C259.8 58.875 261.988 59.5061 263.953 60.2002C265.982 60.8313 267.726 61.6517 269.185 62.6615C270.643 63.6712 271.753 64.9019 272.514 66.3534C273.275 67.7417 273.592 69.4457 273.465 71.4652C273.402 74.873 272.355 77.8707 270.326 80.4582C268.36 82.9825 265.665 84.9389 262.241 86.3273C258.817 87.6526 254.949 88.3152 250.637 88.3152Z" fill="white" />
      <path d="M276.317 87.1793L288.302 19.0217H301.143L296.292 46.8527C298.258 44.3284 300.699 42.3405 303.616 40.8889C306.533 39.3743 309.735 38.617 313.223 38.617C317.154 38.617 320.356 39.469 322.829 41.1729C325.302 42.8138 326.983 45.2435 327.87 48.462C328.758 51.6174 328.758 55.5302 327.87 60.2002L323.115 87.1793H310.274L314.84 61.4309C315.537 57.5812 315.252 54.6151 313.983 52.5325C312.779 50.4499 310.464 49.4086 307.04 49.4086C304.884 49.4086 302.855 49.9451 300.953 51.0179C299.114 52.0277 297.528 53.4792 296.197 55.3724C294.929 57.2657 294.041 59.6007 293.533 62.3775L289.158 87.1793H276.317Z" fill="white" />
      <path d="M334.764 87.1793L343.895 35.2092C344.656 31.2333 345.924 28.0779 347.7 25.7428C349.475 23.4078 351.694 21.7039 354.358 20.631C357.021 19.5582 360.033 19.0217 363.394 19.0217H369.006L367.008 29.908H363.394C361.365 29.908 359.843 30.3182 358.828 31.1386C357.814 31.8959 357.116 33.2528 356.736 35.2092L347.604 87.1793H334.764ZM334.669 50.4499L336.571 39.753H366.152L364.25 50.4499H334.669Z" fill="white" />
      <path d="M363.611 87.1793L371.981 39.753H383.395L383.11 48.2727C384.632 46.3163 386.375 44.6439 388.341 43.2555C390.307 41.804 392.495 40.6681 394.904 39.8477C397.314 39.0272 399.818 38.617 402.418 38.617L400.136 52.1539H396.045C394.08 52.1539 392.241 52.3748 390.529 52.8165C388.817 53.1952 387.263 53.8894 385.868 54.8991C384.536 55.8457 383.395 57.1395 382.444 58.7803C381.493 60.4211 380.827 62.4722 380.446 64.9334L376.452 87.1793H363.611Z" fill="white" />
      <path d="M419.277 88.3152C414.965 88.3152 411.224 87.4633 408.054 85.7593C404.947 84.0554 402.569 81.6257 400.92 78.4703C399.271 75.3148 398.51 71.6229 398.637 67.3947C398.764 63.4819 399.557 59.79 401.015 56.3191C402.474 52.8481 404.503 49.7873 407.103 47.1367C409.702 44.4862 412.746 42.4036 416.234 40.8889C419.785 39.3743 423.716 38.617 428.028 38.617C432.277 38.617 435.923 39.469 438.966 41.1729C442.01 42.8769 444.293 45.2119 445.815 48.178C447.4 51.1441 448.129 54.5205 448.002 58.307C448.002 59.7585 447.876 61.21 447.622 62.6615C447.368 64.113 447.051 65.4383 446.671 66.6373H407.768L409.1 58.7803H435.257C435.511 56.6977 435.257 54.9307 434.496 53.4792C433.798 52.0277 432.72 50.9232 431.262 50.1659C429.867 49.4086 428.218 49.03 426.316 49.03C424.16 49.03 422.067 49.5349 420.038 50.5446C418.009 51.4912 416.265 52.9743 414.807 54.9938C413.412 56.9501 412.461 59.4429 411.953 62.4722L411.478 65.2174C411.034 67.6786 411.129 69.8559 411.763 71.7492C412.397 73.6424 413.475 75.157 414.997 76.293C416.582 77.3658 418.58 77.9023 420.989 77.9023C423.399 77.9023 425.46 77.3974 427.172 76.3877C428.884 75.3148 430.311 73.9895 431.452 72.4118H444.483C443.025 75.441 441.027 78.1547 438.491 80.5528C436.018 82.951 433.133 84.8442 429.835 86.2326C426.538 87.621 423.019 88.3152 419.277 88.3152Z" fill="white" />
      <path d="M471.246 88.3152C466.934 88.3152 463.193 87.4633 460.023 85.7593C456.915 84.0554 454.538 81.6257 452.889 78.4703C451.24 75.3148 450.479 71.6229 450.606 67.3947C450.733 63.4819 451.526 59.79 452.984 56.3191C454.442 52.8481 456.472 49.7873 459.071 47.1367C461.671 44.4862 464.715 42.4036 468.203 40.8889C471.754 39.3743 475.685 38.617 479.997 38.617C484.245 38.617 487.892 39.469 490.935 41.1729C493.979 42.8769 496.262 45.2119 497.784 48.178C499.369 51.1441 500.098 54.5205 499.971 58.307C499.971 59.7585 499.844 61.21 499.591 62.6615C499.337 64.113 499.02 65.4383 498.64 66.6373H459.737L461.069 58.7803H487.226C487.479 56.6977 487.226 54.9307 486.465 53.4792C485.767 52.0277 484.689 50.9232 483.231 50.1659C481.836 49.4086 480.187 49.03 478.285 49.03C476.129 49.03 474.036 49.5349 472.007 50.5446C469.978 51.4912 468.234 52.9743 466.776 54.9938C465.381 56.9501 464.43 59.4429 463.922 62.4722L463.447 65.2174C463.003 67.6786 463.098 69.8559 463.732 71.7492C464.366 73.6424 465.444 75.157 466.966 76.293C468.551 77.3658 470.549 77.9023 472.958 77.9023C475.368 77.9023 477.429 77.3974 479.141 76.3877C480.853 75.3148 482.28 73.9895 483.421 72.4118H496.452C494.994 75.441 492.996 78.1547 490.46 80.5528C487.987 82.951 485.101 84.8442 481.804 86.2326C478.507 87.621 474.987 88.3152 471.246 88.3152Z" fill="white" />
      <path d="M61.5411 12.2283C65.0981 12.2283 68.4906 13.3848 71.2383 15.4802L71.241 15.4762C71.6722 15.8414 72.1156 16.1871 72.5262 16.5765L90.0913 31.6164L90.0966 31.6217C94.0556 34.7509 96.0355 39.7741 95.2414 44.7271L95.2307 44.7946L95.2186 44.8621L85.6233 95.1455L77.1242 86.6809L85.6233 43.2018C85.8592 41.6845 85.2448 40.1134 84.0191 39.1409L76.7302 33.0106L68.3919 77.6919L59.9839 69.32L67.5154 28.9709C67.84 27.2392 67.3527 25.411 66.2168 24.064C65.0481 22.6848 63.3591 21.9151 61.5411 21.9151H12.4561L2.71741 12.2283H61.5411Z" fill={`url(#${p0})`} />
      <path d="M58.1618 35.7727L53.1623 62.5224L44.7543 54.1511V53.9907L46.5723 44.3043L47.7084 38.2744H28.8471L19.108 28.5881H52.0911C52.9547 28.5881 54.6359 28.5881 56.1632 28.5881C57.8358 28.5881 59.111 30.0842 58.8409 31.7348C58.5932 33.249 58.3163 34.9177 58.1618 35.7727Z" fill={`url(#${p1})`} />
      <defs>
      <linearGradient id={p0} x1="15.6637" y1="12.2282" x2="15.6637" y2="77.6913" gradientUnits="userSpaceOnUse">
      <stop stopColor="#00ADA1" />
      <stop offset="0.668269" stopColor="#00AD5B" />
      </linearGradient>
      <linearGradient id={p1} x1="25.8921" y1="28.5881" x2="25.8921" y2="62.5224" gradientUnits="userSpaceOnUse">
      <stop stopColor="#FBB016" />
      <stop offset="0.668269" stopColor="#FF8FA7" />
      </linearGradient>
      </defs>
      </svg>
    );
  }

  return (
    <svg
      role="img"
      aria-label="Cashfree"
      className={shared}
      width="370"
      height="80"
      viewBox="0 0 370 80"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
    >
      <g clipPath={`url(#${clip})`}>
      <path d="M103.807 65C99.4671 65 95.8034 64.1407 92.8165 62.4221C89.8296 60.7036 87.5895 58.3115 86.096 55.2459C84.6026 52.1803 83.9258 48.6271 84.0659 44.5861C84.1592 40.3128 84.9293 36.3648 86.376 32.7418C87.8695 29.0724 89.8996 25.8907 92.4665 23.1967C95.0334 20.4563 98.0203 18.3429 101.427 16.8566C104.881 15.3238 108.614 14.5574 112.628 14.5574C118.509 14.5574 123.106 16.0205 126.419 18.9467C129.733 21.873 131.39 26.0068 131.39 31.3484H120.959C120.865 28.7473 119.979 26.7268 118.299 25.2869C116.618 23.8005 114.215 23.0574 111.088 23.0574C108.614 23.0574 106.351 23.5683 104.297 24.5902C102.244 25.612 100.424 27.0519 98.837 28.9098C97.2969 30.7678 96.0835 32.9508 95.1967 35.459C94.31 37.9672 93.8433 40.7077 93.7966 43.6803C93.7033 46.3743 94.1 48.6735 94.9867 50.5779C95.8734 52.4822 97.1802 53.9686 98.907 55.0369C100.68 56.0587 102.827 56.5697 105.348 56.5697C108.474 56.5697 111.088 55.8962 113.188 54.5492C115.288 53.2022 116.852 51.2746 117.878 48.7664H128.309C127.049 52.2036 125.229 55.1298 122.849 57.5451C120.515 59.9604 117.738 61.8183 114.518 63.1189C111.298 64.373 107.728 65 103.807 65Z" fill="black" />
      <path d="M144.837 65C141.943 65 139.447 64.3033 137.346 62.9098C135.293 61.5164 133.729 59.6352 132.656 57.2664C131.583 54.8511 131.093 52.1571 131.186 49.1844C131.279 46.2118 131.839 43.4713 132.866 40.9631C133.893 38.4549 135.293 36.2719 137.066 34.4139C138.887 32.5096 140.963 31.0464 143.297 30.0246C145.63 28.9563 148.127 28.4221 150.787 28.4221C153.634 28.4221 155.921 28.9331 157.648 29.9549C159.421 30.9768 160.728 32.2773 161.568 33.8566L163.458 29.2582H171.859L165.629 64.1639H157.228L157.018 59.3566C156.178 60.332 155.174 61.2609 154.008 62.1434C152.841 63.026 151.488 63.7227 149.947 64.2336C148.454 64.7445 146.75 65 144.837 65ZM148.617 56.7787C150.671 56.7787 152.514 56.2445 154.148 55.1762C155.828 54.1079 157.158 52.6913 158.138 50.9262C159.118 49.1148 159.631 47.1175 159.678 44.9344C159.725 43.2623 159.445 41.8224 158.838 40.6148C158.231 39.3607 157.321 38.3852 156.108 37.6885C154.941 36.9918 153.518 36.6434 151.838 36.6434C149.831 36.6434 148.011 37.1544 146.377 38.1762C144.744 39.1516 143.437 40.5219 142.457 42.2869C141.523 44.0055 141.01 45.9563 140.917 48.1393C140.87 49.765 141.15 51.2514 141.757 52.5984C142.363 53.8989 143.25 54.9208 144.417 55.6639C145.584 56.4071 146.984 56.7787 148.617 56.7787Z" fill="black" />
      <path d="M185.527 65C182.261 65 179.507 64.4658 177.267 63.3975C175.073 62.3292 173.417 60.8661 172.296 59.0082C171.223 57.1038 170.803 54.9904 171.036 52.668H180.417C180.37 53.6899 180.58 54.5956 181.047 55.3852C181.514 56.1749 182.214 56.8019 183.147 57.2664C184.127 57.6844 185.317 57.8934 186.718 57.8934C187.978 57.8934 189.028 57.7077 189.868 57.3361C190.755 56.9645 191.431 56.4536 191.898 55.8033C192.411 55.153 192.691 54.4331 192.738 53.6434C192.738 52.8538 192.481 52.2268 191.968 51.7623C191.501 51.2978 190.801 50.903 189.868 50.5779C188.981 50.2527 187.908 49.974 186.648 49.7418C185.107 49.3702 183.591 48.929 182.097 48.418C180.65 47.9071 179.344 47.2801 178.177 46.5369C177.057 45.7937 176.17 44.888 175.517 43.8197C174.863 42.7514 174.56 41.474 174.607 39.9877C174.653 37.7582 175.353 35.7842 176.707 34.0656C178.107 32.3005 179.997 30.9303 182.377 29.9549C184.757 28.9331 187.464 28.4221 190.498 28.4221C194.745 28.4221 198.035 29.3975 200.369 31.3484C202.749 33.2992 203.892 35.9467 203.799 39.291H194.768C194.722 38.1762 194.208 37.2937 193.228 36.6434C192.295 35.9467 191.011 35.5984 189.378 35.5984C187.791 35.5984 186.484 35.9467 185.457 36.6434C184.431 37.2937 183.917 38.1066 183.917 39.082C183.871 39.7322 184.104 40.2896 184.617 40.7541C185.177 41.2186 185.948 41.6366 186.928 42.0082C187.908 42.3333 189.098 42.6352 190.498 42.9139C192.271 43.332 193.881 43.7964 195.328 44.3074C196.822 44.7719 198.105 45.3757 199.179 46.1189C200.252 46.862 201.069 47.7678 201.629 48.8361C202.189 49.8579 202.422 51.112 202.329 52.5984C202.282 55.1066 201.512 57.3128 200.019 59.2172C198.572 61.0751 196.588 62.515 194.068 63.5369C191.548 64.5123 188.701 65 185.527 65Z" fill="black" />
      <path d="M204.428 64.1639L213.249 14H222.7L219.129 34.4836C220.576 32.6257 222.373 31.1626 224.52 30.0943C226.667 28.9795 229.024 28.4221 231.59 28.4221C234.484 28.4221 236.841 29.0492 238.661 30.3033C240.481 31.5109 241.718 33.2992 242.371 35.668C243.025 37.9904 243.025 40.8702 242.371 44.3074L238.871 64.1639H229.42L232.78 45.2131C233.294 42.3798 233.084 40.1967 232.15 38.6639C231.264 37.1311 229.56 36.3648 227.04 36.3648C225.453 36.3648 223.96 36.7596 222.56 37.5492C221.206 38.2923 220.039 39.3607 219.059 40.7541C218.126 42.1475 217.473 43.8661 217.099 45.9098L213.879 64.1639H204.428Z" fill="black" />
      <path d="M247.445 64.1639L254.165 25.9139C254.725 22.9877 255.659 20.6653 256.965 18.9467C258.272 17.2281 259.906 15.974 261.866 15.1844C263.826 14.3948 266.043 14 268.516 14H272.647L271.177 22.0123H268.516C267.023 22.0123 265.903 22.3142 265.156 22.918C264.409 23.4754 263.896 24.474 263.616 25.9139L256.895 64.1639H247.445ZM247.375 37.1311L248.775 29.2582H270.547L269.146 37.1311H247.375Z" fill="black" />
      <path d="M268.676 64.1639L274.837 29.2582H283.237L283.027 35.5287C284.147 34.0888 285.431 32.8579 286.878 31.8361C288.324 30.7678 289.935 29.9317 291.708 29.3279C293.481 28.724 295.325 28.4221 297.238 28.4221L295.558 38.3852H292.548C291.101 38.3852 289.748 38.5478 288.488 38.873C287.228 39.1516 286.084 39.6626 285.058 40.4057C284.077 41.1025 283.237 42.0546 282.537 43.2623C281.837 44.4699 281.347 45.9795 281.067 47.791L278.127 64.1639H268.676Z" fill="black" />
      <path d="M309.647 65C306.473 65 303.72 64.373 301.386 63.1189C299.099 61.8648 297.349 60.0765 296.136 57.7541C294.922 55.4317 294.362 52.7145 294.456 49.6025C294.549 46.7227 295.132 44.0055 296.206 41.4508C297.279 38.8962 298.773 36.6434 300.686 34.6926C302.6 32.7418 304.84 31.209 307.407 30.0943C310.02 28.9795 312.914 28.4221 316.087 28.4221C319.214 28.4221 321.898 29.0492 324.138 30.3033C326.378 31.5574 328.058 33.276 329.178 35.459C330.345 37.6421 330.882 40.127 330.788 42.9139C330.788 43.9822 330.695 45.0505 330.508 46.1189C330.322 47.1872 330.088 48.1626 329.808 49.0451H301.176L302.156 43.2623H321.408C321.594 41.7295 321.408 40.429 320.848 39.3607C320.334 38.2924 319.541 37.4795 318.467 36.9221C317.441 36.3648 316.227 36.0861 314.827 36.0861C313.24 36.0861 311.7 36.4576 310.207 37.2008C308.713 37.8975 307.43 38.9891 306.357 40.4754C305.33 41.9153 304.63 43.75 304.256 45.9795L303.906 48C303.58 49.8115 303.65 51.4139 304.116 52.8074C304.583 54.2008 305.376 55.3156 306.497 56.1516C307.663 56.9413 309.133 57.3361 310.907 57.3361C312.68 57.3361 314.197 56.9645 315.457 56.2213C316.717 55.4317 317.767 54.4563 318.607 53.2951H328.198C327.125 55.5246 325.655 57.5219 323.788 59.2869C321.968 61.0519 319.844 62.4454 317.417 63.4672C314.991 64.4891 312.4 65 309.647 65Z" fill="black" />
      <path d="M347.896 65C344.722 65 341.969 64.373 339.635 63.1189C337.348 61.8648 335.598 60.0765 334.385 57.7541C333.171 55.4317 332.611 52.7145 332.705 49.6025C332.798 46.7227 333.381 44.0055 334.455 41.4508C335.528 38.8962 337.022 36.6434 338.935 34.6926C340.849 32.7418 343.089 31.209 345.656 30.0943C348.269 28.9795 351.163 28.4221 354.336 28.4221C357.463 28.4221 360.147 29.0492 362.387 30.3033C364.627 31.5574 366.307 33.276 367.427 35.459C368.594 37.6421 369.131 40.127 369.038 42.9139C369.038 43.9822 368.944 45.0505 368.757 46.1189C368.571 47.1872 368.337 48.1626 368.057 49.0451H339.425L340.405 43.2623H359.657C359.843 41.7295 359.657 40.429 359.097 39.3607C358.583 38.2924 357.79 37.4795 356.717 36.9221C355.69 36.3648 354.476 36.0861 353.076 36.0861C351.489 36.0861 349.949 36.4576 348.456 37.2008C346.962 37.8975 345.679 38.9891 344.606 40.4754C343.579 41.9153 342.879 43.75 342.505 45.9795L342.155 48C341.829 49.8115 341.899 51.4139 342.365 52.8074C342.832 54.2008 343.626 55.3156 344.746 56.1516C345.912 56.9413 347.382 57.3361 349.156 57.3361C350.929 57.3361 352.446 56.9645 353.706 56.2213C354.966 55.4317 356.016 54.4563 356.857 53.2951H366.447C365.374 55.5246 363.904 57.5219 362.037 59.2869C360.217 61.0519 358.093 62.4454 355.666 63.4672C353.24 64.4891 350.649 65 347.896 65Z" fill="black" />
      <path d="M46.3528 9C48.9708 9 51.4677 9.8512 53.49 11.3934L53.4919 11.3904C53.8093 11.6592 54.1357 11.9137 54.4378 12.2003L67.3658 23.2696L67.3697 23.2735C70.2835 25.5766 71.7407 29.2737 71.1562 32.9191L71.1484 32.9688L71.1395 33.0185L64.0773 70.0271L57.822 63.7971L64.0773 31.7965C64.2509 30.6797 63.7988 29.5234 62.8967 28.8077L57.532 24.2957L51.395 57.1812L45.2067 51.0194L50.7499 21.3225C50.9888 20.048 50.6302 18.7025 49.7942 17.7111C48.934 16.696 47.6909 16.1294 46.3528 16.1294H10.2263L3.05859 9H46.3528Z" fill="black" />
      <path d="M46.3528 9C48.9708 9 51.4677 9.8512 53.49 11.3934L53.4919 11.3904C53.8093 11.6592 54.1357 11.9137 54.4378 12.2003L67.3658 23.2696L67.3697 23.2735C70.2835 25.5766 71.7407 29.2737 71.1562 32.9191L71.1484 32.9688L71.1395 33.0185L64.0773 70.0271L57.822 63.7971L64.0773 31.7965C64.2509 30.6797 63.7988 29.5234 62.8967 28.8077L57.532 24.2957L51.395 57.1812L45.2067 51.0194L50.7499 21.3225C50.9888 20.048 50.6302 18.7025 49.7942 17.7111C48.934 16.696 47.6909 16.1294 46.3528 16.1294H10.2263L3.05859 9H46.3528Z" fill={`url(#${p0})`} />
      <path d="M46.3528 9C48.9708 9 51.4677 9.8512 53.49 11.3934L53.4919 11.3904C53.8093 11.6592 54.1357 11.9137 54.4378 12.2003L67.3658 23.2696L67.3697 23.2735C70.2835 25.5766 71.7407 29.2737 71.1562 32.9191L71.1484 32.9688L71.1395 33.0185L64.0773 70.0271L57.822 63.7971L64.0773 31.7965C64.2509 30.6797 63.7988 29.5234 62.8967 28.8077L57.532 24.2957L51.395 57.1812L45.2067 51.0194L50.7499 21.3225C50.9888 20.048 50.6302 18.7025 49.7942 17.7111C48.934 16.696 47.6909 16.1294 46.3528 16.1294H10.2263L3.05859 9H46.3528Z" fill={`url(#${p1})`} />
      <path d="M43.8662 26.3269L40.1865 46.0147L33.9983 39.8534V39.7354L35.3363 32.6062L36.1725 28.1682H22.2905L15.1226 21.0391H39.3981C40.0337 21.0391 41.2711 21.0391 42.3952 21.0391C43.6262 21.0391 44.5648 22.1402 44.366 23.3551C44.1837 24.4695 43.9799 25.6977 43.8662 26.3269Z" fill="black" />
      <path d="M43.8662 26.3269L40.1865 46.0147L33.9983 39.8534V39.7354L35.3363 32.6062L36.1725 28.1682H22.2905L15.1226 21.0391H39.3981C40.0337 21.0391 41.2711 21.0391 42.3952 21.0391C43.6262 21.0391 44.5648 22.1402 44.366 23.3551C44.1837 24.4695 43.9799 25.6977 43.8662 26.3269Z" fill={`url(#${p2})`} />
      <path d="M43.8662 26.3269L40.1865 46.0147L33.9983 39.8534V39.7354L35.3363 32.6062L36.1725 28.1682H22.2905L15.1226 21.0391H39.3981C40.0337 21.0391 41.2711 21.0391 42.3952 21.0391C43.6262 21.0391 44.5648 22.1402 44.366 23.3551C44.1837 24.4695 43.9799 25.6977 43.8662 26.3269Z" fill={`url(#${p3})`} />
      </g>
      <defs>
      <linearGradient id={p0} x1="12.5871" y1="8.99994" x2="12.5871" y2="57.1808" gradientUnits="userSpaceOnUse">
      <stop stopColor="#00ADA1" />
      <stop offset="0.668269" stopColor="#00AD5B" />
      </linearGradient>
      <linearGradient id={p1} x1="12.5871" y1="8.99994" x2="12.5871" y2="57.1808" gradientUnits="userSpaceOnUse">
      <stop stopColor="#00ADA1" />
      <stop offset="0.668269" stopColor="#00AD5B" />
      </linearGradient>
      <linearGradient id={p2} x1="20.1157" y1="21.0391" x2="20.1157" y2="46.0147" gradientUnits="userSpaceOnUse">
      <stop stopColor="#00ADA1" />
      <stop offset="0.668269" stopColor="#00AD5B" />
      </linearGradient>
      <linearGradient id={p3} x1="20.1157" y1="21.0391" x2="20.1157" y2="46.0147" gradientUnits="userSpaceOnUse">
      <stop stopColor="#FBB016" />
      <stop offset="0.668269" stopColor="#FF8FA7" />
      </linearGradient>
      <clipPath id={clip}>
      <rect width="370" height="80" fill="white" />
      </clipPath>
      </defs>
    </svg>
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
