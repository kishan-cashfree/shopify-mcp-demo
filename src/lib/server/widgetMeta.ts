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
