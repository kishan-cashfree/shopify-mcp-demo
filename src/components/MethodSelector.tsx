import { useCallback, useEffect, useRef, useState } from "react";
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
    // orderId is required by the tool's schema — `z.string().min(1)`,
    // "required for card payment reconciliation" — and was added to
    // cashfree-here in 8c39bf2 without this side following. Without it the
    // model cannot form a valid call and abandons the payment out loud:
    // "I'm missing the order ID needed to load the saved-card checkout."
    needs: ["customerId", "orderId"],
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
 * How long to wait before re-sending the handoff.
 *
 * No longer a verdict. The old note here claimed a blocked dispatch "produces
 * no server contact at all, ever" — true on ChatGPT, where an allowed dispatch
 * lands in 13-30ms, and false on Claude, which asks the buyer to confirm the
 * prompt and then to approve the tool. Measured there: `tools/call UpiTool`
 * arrived 12.8s after this window closed, on a payment that went through.
 *
 * So this only decides when to try the handoff again. Deciding anything else
 * from it told buyers they were blocked while their payment was one click
 * away.
 */
const CONFIRM_TIMEOUT_MS = 4_000;
const CONFIRM_POLL_MS = 700;

/**
 * How many times to re-send the handoff, on a host that sends it for us.
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

/**
 * Retrying only helps where the handoff can vanish without trace.
 *
 * On MCP Apps the follow-up is not sent, it is offered: the host drops the
 * text into the composer and waits for the buyer. A second attempt re-fills
 * that composer, so the buyer is shown the same prompt twice and sending both
 * runs the payment tool twice — observed at 16:43:45 and again at 16:43:52,
 * the second landing after the summary screen had already moved on.
 *
 * Nothing is lost there, so there is nothing to recover: ask once, and let the
 * open-ended wait do the rest.
 */
function attemptsFor(hostType: string): number {
  return hostType === "mcp_apps" ? 1 : DISPATCH_ATTEMPTS;
}

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
  const [awaiting, setAwaiting] = useState(false);

  // Stops the open-ended poll when the widget goes away, and lets a newer
  // method selection retire the previous one's poll rather than racing it.
  const unmounted = useRef(false);
  const run = useRef(0);
  useEffect(() => {
    unmounted.current = false;
    return () => {
      unmounted.current = true;
    };
  }, []);

  /** One ask: has a payment tool handler run for this session yet? */
  const pollOnce = useCallback(async () => {
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
        return Boolean(body.dispatchedTool);
      }
    } catch {
      // A failed poll is not proof either way — keep waiting.
    }
    return false;
  }, [baseUrl, paymentSessionId]);

  /**
   * Waits for the server to report that a payment tool handler actually ran.
   *
   * Neither dispatch path proves a payment started: asking the model to call a
   * tool resolves whether or not it does. Advancing on the attempt alone
   * parked the buyer on a "waiting for payment" screen for a payment that had
   * never begun.
   *
   * `timeoutMs: null` polls until the widget unmounts or a newer selection
   * supersedes this one. That is the Claude case — the handoff is not lost,
   * it is sitting in front of the buyer waiting to be confirmed.
   */
  const confirmDispatch = useCallback(
    async (timeoutMs: number | null, token: number) => {
      const deadline = timeoutMs === null ? Infinity : Date.now() + timeoutMs;

      while (!unmounted.current && run.current === token && Date.now() < deadline) {
        if (await pollOnce()) return true;
        await new Promise((resolve) => setTimeout(resolve, CONFIRM_POLL_MS));
      }

      return false;
    },
    [pollOnce],
  );

  const dispatch = useCallback(
    async (method: Method) => {
      const args: Record<string, unknown> = { paymentSessionId };
      for (const need of method.needs ?? []) {
        if (need === "orderId") args.orderId = orderId;
        if (need === "customerId") args.customerId = customerId;
      }

      setBusy(method.id);
      setError(null);
      setAwaiting(false);
      const token = ++run.current;
      const host = getClientPlatform();

      try {
        const attempts = attemptsFor(host.type);
        for (let attempt = 1; attempt <= attempts; attempt++) {
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

          if (await confirmDispatch(CONFIRM_TIMEOUT_MS, token)) {
            // The handoff is done, so retire the instruction naming this tool
            // and session before it can be acted on a second time.
            await host.clearModelContext().catch(() => {});
            // Advances to our result screen on every path, the same as the
            // external link does. The cashfree-here widget below carries its
            // own verdict, but it never saw the Shopify cart and so cannot say
            // what was bought — that receipt is ours, and a buyer gets the
            // same screen however they paid.
            onDispatched();
            return;
          }
        }

        // Nothing yet — which is not the same as refused. Claude asks the
        // buyer to confirm the prompt and then to approve the tool, and a
        // measured run had the tool fire 12.8s after this point. So say what
        // is actually true and keep listening; the buttons come back so
        // another method or the link stays available meanwhile.
        setAwaiting(true);
        setBusy(null);
        if (await confirmDispatch(null, token)) {
          await host.clearModelContext().catch(() => {});
          onDispatched();
        }
        return;
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

      {awaiting && (
        <div className="flex flex-col gap-2 rounded-xl bg-black/5 p-3">
          {/* This used to read "this chat blocked the payment step", which is
              false on any host that asks first: the request is sitting in the
              composer waiting for the buyer. Telling someone they are blocked
              when they are one click away sends them to pay by another route
              — twice. The poll below is still running, so if they do confirm,
              this screen advances on its own however long it takes. */}
          <p className="text-sm">
            Confirm the prompt in the composer to continue — this chat asks
            before a payment step can run.
          </p>
          <a
            href={checkoutUrl}
            target="_blank"
            rel="noreferrer"
            // Moves to the verification screen as the tab opens, so the buyer
            // returns to something that is already watching for the result.
            // Without this the working path ended at a link and never
            // confirmed anything.
            //
            // The anchor is the only thing that opens on ChatGPT — the host's
            // own external-open navigated away and killed the connector
            // mid-payment. Inside Claude's widget iframe it is the opposite:
            // the click does nothing at all and no tab appears, so the buyer
            // is left on a dead link with a payment they cannot complete.
            // openLink is the sanctioned route there, so each host gets the
            // one that works for it.
            onClick={(event) => {
              const host = getClientPlatform();
              if (host.type === "mcp_apps") {
                event.preventDefault();
                void host.openExternal({ href: checkoutUrl });
              }
              onDispatched();
            }}
            className="rounded-xl bg-black/90 px-4 py-3 text-center text-sm font-semibold text-white"
          >
            Pay {amountLabel} on Cashfree
          </a>
          <p className="text-xs text-secondary">
            Or pay in a new tab instead. Come back afterwards and this widget
            will report the result either way.
          </p>
        </div>
      )}

      <p className="text-center text-[10px] text-secondary opacity-60">
        build {(window as { __BUILD__?: string }).__BUILD__ ?? "dev"}
      </p>
    </div>
  );
}
