import { useCallback, useState } from "react";
import { getClientPlatform } from "../utils/platform";

interface MethodSelectorProps {
  baseUrl: string;
  paymentSessionId: string;
  orderId: string;
  /** Cashfree customer id, matching the one the order was created with. */
  customerId: string;
  /** Cashfree hosted checkout, used when the host suppresses the dispatch. */
  checkoutUrl: string;
  amountLabel: string;
  onDispatched: () => void;
  onBack: () => void;
}

interface Method {
  id: string;
  label: string;
  toolName: string;
  /** Extra arguments this tool's schema requires beyond paymentSessionId. */
  needs?: ("orderId" | "customerId")[];
}

const METHODS: Method[] = [
  { id: "upi", label: "UPI", toolName: "UpiTool" },
  { id: "netbanking", label: "Netbanking", toolName: "NetbankingTool" },
  {
    id: "saved_card",
    label: "Saved card",
    toolName: "CardPaymentTool",
    needs: ["customerId"],
  },
  {
    id: "new_card",
    label: "New card",
    toolName: "NewCardPaymentTool",
    needs: ["orderId"],
  },
  {
    id: "checkout",
    label: "All payment methods",
    toolName: "CheckoutTool",
    needs: ["orderId"],
  },
];

/**
 * How long to wait for the server to confirm a handler actually ran.
 *
 * Was 8s. Measurement since then: a dispatch the host allows lands in well
 * under a second — the `tools/call` shows up 13-30ms after the follow-up —
 * while a blocked one produces no server contact at all, ever. So the wait is
 * only covering a dropped handoff, not a slow host, and 4s is as conclusive
 * as 8 was.
 */
const CONFIRM_TIMEOUT_MS = 4_000;
const CONFIRM_POLL_MS = 700;

/**
 * How many times to ask before calling it blocked.
 *
 * The widget-to-model handoff drops silently — demo/server.ts puts it at
 * roughly half of attempts — and a dropped message is indistinguishable from
 * the host suppressing the tool. Measured here in one session: the same UPI
 * request dispatched on one attempt and produced nothing on another, same
 * build. Retrying turns a coin flip into near-certainty and costs a few
 * seconds when it works first time.
 *
 * Cut from 3 to 2. Three attempts at 8s left the widget frozen for 24s before
 * admitting defeat, which reads as broken. Two at 4s is 8s total — still two
 * independent shots at a coin-flip handoff, at a third of the dead time.
 */
const DISPATCH_ATTEMPTS = 2;

export function MethodSelector({
  baseUrl,
  paymentSessionId,
  orderId,
  customerId,
  checkoutUrl,
  amountLabel,
  onDispatched,
  onBack,
}: MethodSelectorProps) {
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [blocked, setBlocked] = useState(false);

  /**
   * Waits for the server to report that a payment tool handler actually ran.
   *
   * Neither dispatch path proves a payment started: asking the model to call a
   * tool resolves whether or not it does, and the host silently suppresses
   * payment tools. Advancing on the attempt alone parked the buyer on a
   * "waiting for payment" screen for a payment that had never begun.
   */
  const confirmDispatch = useCallback(async () => {
    const deadline = Date.now() + CONFIRM_TIMEOUT_MS;

    while (Date.now() < deadline) {
      try {
        const response = await fetch(`${baseUrl}/api/pay/dispatched`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ paymentSessionId }),
        });
        if (response.ok) {
          const body = (await response.json()) as {
            dispatchedTool?: string | null;
          };
          if (body.dispatchedTool) return true;
        }
      } catch {
        // A failed poll is not proof either way — keep waiting.
      }
      await new Promise((resolve) => setTimeout(resolve, CONFIRM_POLL_MS));
    }

    return false;
  }, [baseUrl, paymentSessionId]);

  const dispatch = useCallback(
    async (method: Method) => {
      const args: Record<string, unknown> = { paymentSessionId };
      for (const need of method.needs ?? []) {
        if (need === "orderId") args.orderId = orderId;
        if (need === "customerId") args.customerId = customerId;
      }

      setBusy(method.id);
      setError(null);
      setBlocked(false);
      const host = getClientPlatform();

      try {
        for (let attempt = 1; attempt <= DISPATCH_ATTEMPTS; attempt++) {
          try {
            // Model-invoked first: only that makes the host render the tool's
            // widget. callTool runs the handler but nothing appears.
            await host.sendFollowUpMessage({
              prompt:
                `The user chose ${method.label} inside the store widget. ` +
                `Call only the \`${method.toolName}\` tool with exactly ` +
                `${JSON.stringify(args)} so the Cashfree payment widget renders. ` +
                `Do not use any other tools and do not answer conversationally.`,
              // demo sends this alongside the prompt and we did not. It is
              // what the host shows as the user's turn, so its absence may
              // leave the follow-up looking unattributed — a second candidate
              // for why dispatch is suppressed here but not there.
              userMessage: `Continue with ${method.label}.`,
            });
          } catch {
            await host.callTool(method.toolName, args);
          }

          if (await confirmDispatch()) {
            // Advances to our result screen on every path, the same as the
            // external link does. The cashfree-here widget below carries its
            // own verdict, but it never saw the Shopify cart and so cannot say
            // what was bought — that receipt is ours, and a buyer gets the
            // same screen however they paid.
            onDispatched();
            return;
          }
        }

        // Every attempt went unanswered. Either the host is suppressing this
        // tool or the handoff dropped repeatedly — the buyer cannot tell those
        // apart and cannot fix either, so give them a route that works.
        setBlocked(true);
      } catch (caught) {
        setError((caught as Error).message || "Couldn't start the payment.");
      } finally {
        setBusy(null);
      }
    },
    [paymentSessionId, orderId, customerId, confirmDispatch, onDispatched],
  );

  return (
    <div className="flex flex-col gap-3 p-4">
      <button
        type="button"
        onClick={onBack}
        className="self-start text-sm text-secondary underline"
      >
        Back
      </button>

      <h2 className="text-base font-semibold">Pay {amountLabel}</h2>
      <p className="text-sm text-secondary">
        Cashfree handles the payment inside this conversation.
      </p>

      <div className="flex flex-col gap-2">
        {METHODS.map((method) => (
          <button
            key={method.id}
            type="button"
            disabled={busy !== null}
            onClick={() => void dispatch(method)}
            className="rounded-xl border border-black/15 px-4 py-3 text-left text-sm font-medium disabled:opacity-40"
          >
            {busy === method.id ? `Starting ${method.label}…` : method.label}
          </button>
        ))}
      </div>

      {error && <p className="text-sm text-red-600">{error}</p>}

      {blocked && (
        <div className="flex flex-col gap-2 rounded-xl bg-black/5 p-3">
          {/* Said plainly rather than left as a spinner. The host accepted the
              request and then declined to run the tool — not something the
              buyer can fix by waiting or pressing the same button again. */}
          <p className="text-sm">
            This chat blocked the in-conversation payment step.
          </p>
          <a
            href={checkoutUrl}
            target="_blank"
            rel="noreferrer"
            // Moves to the verification screen as the tab opens, so the buyer
            // returns to something that is already watching for the result.
            // Without this the working path ended at a link and never
            // confirmed anything.
            onClick={onDispatched}
            className="rounded-xl bg-black/90 px-4 py-3 text-center text-sm font-semibold text-white"
          >
            Pay {amountLabel} on Cashfree
          </a>
          <p className="text-xs text-secondary">
            Opens Cashfree checkout in a new tab. Come back afterwards and this
            widget will confirm the payment.
          </p>
        </div>
      )}

      <p className="text-center text-[10px] text-secondary opacity-60">
        build {(window as { __BUILD__?: string }).__BUILD__ ?? "dev"}
      </p>
    </div>
  );
}
