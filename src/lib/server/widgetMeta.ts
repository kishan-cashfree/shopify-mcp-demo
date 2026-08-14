/**
 * The `_meta` that tells a host which widget a tool renders into.
 *
 * Two ecosystems name this differently and neither reads the other's key:
 *
 *   ChatGPT    `openai/outputTemplate`
 *   MCP Apps   `_meta.ui.resourceUri`, with `ui/resourceUri` as the legacy
 *              flat form — `@modelcontextprotocol/ext-apps` documents hosts
 *              as checking the nested key first and falling back to the flat
 *              one, so we emit both.
 *
 * Declaring only the OpenAI key is invisible rather than broken: Claude
 * connected, listed the tools and resources, called SearchProducts four times
 * and never issued a single `resources/read`, because as far as it could tell
 * the tool had no UI at all.
 */
export interface WidgetMeta extends Record<string, unknown> {
  "openai/outputTemplate": string;
  "openai/widgetAccessible": true;
  ui: { resourceUri: string };
  "ui/resourceUri": string;
}

export function widgetToolMeta(
  uri: string,
  extra: Record<string, unknown> = {},
): WidgetMeta {
  return {
    ...extra,
    "openai/outputTemplate": uri,
    // Lets the widget call tools back through the host.
    "openai/widgetAccessible": true,
    ui: { resourceUri: uri },
    "ui/resourceUri": uri,
  };
}

/**
 * The widget's resource URI, versioned by build.
 *
 * Hosts cache the widget per conversation and keep rendering whatever the
 * thread was created with — a constant URI gives them no way to tell a rebuilt
 * widget from the old one. Measured: Claude issued `resources/read` for a new
 * build at 16:14 and the open chat still rendered the copy fetched at 15:58,
 * so three fixes in a row looked like they had not worked.
 *
 * Versioning the URI makes each build a distinct resource, which no cache can
 * shadow. The tool metadata and the registration both derive from this, so
 * they cannot drift apart.
 */
export function widgetUri(buildId: string): string {
  return `ui://widget/shopify-store-${buildId}.html`;
}

export interface WidgetCspDomains {
  /** fetch / XHR / WebSocket targets. */
  connect: string[];
  /** Images, scripts, styles, fonts, media. */
  resource: string[];
  /** Nested iframes. */
  frame: string[];
  /** Where the host may send the buyer. OpenAI-only; MCP Apps has no analogue. */
  redirect: string[];
}

/**
 * The CSP a UI resource declares, in both ecosystems' spellings.
 *
 * The two blocks were previously written out by hand and drifted: the OpenAI
 * one listed resource and frame domains, the MCP Apps one listed only connect.
 * Since an omitted list means *deny*, every product image from Shopify's CDN
 * was blocked on Claude while ChatGPT rendered them — a divergence invisible
 * on either host alone. Deriving both from one argument is what stops that
 * happening again.
 */
export function widgetCspMeta(domains: WidgetCspDomains) {
  return {
    "openai/widgetPrefersBorder": true as const,
    "openai/widgetCSP": {
      connect_domains: domains.connect,
      resource_domains: domains.resource,
      frame_domains: domains.frame,
      redirect_domains: domains.redirect,
    },
    ui: {
      prefersBorder: true as const,
      csp: {
        connectDomains: domains.connect,
        resourceDomains: domains.resource,
        frameDomains: domains.frame,
      },
    },
  };
}
