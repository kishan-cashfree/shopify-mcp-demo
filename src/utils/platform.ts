import { App, type McpUiHostContext } from "@modelcontextprotocol/ext-apps";
import type { WidgetState, ToolOutput, ToolResponseMetadata } from "../types";

async function clearModelContext(app: App): Promise<void> {
  await app.updateModelContext({
    content: [],
    structuredContent: {},
  });
}

export interface ClientPlatform {
  type: "openai_legacy" | "mcp_apps";

  theme: "light" | "dark";
  locale: string;
  displayMode: "inline" | "fullscreen" | "pip";
  toolInput: Record<string, unknown> | null;
  toolOutput: ToolOutput | null;
  toolResponseMetadata: ToolResponseMetadata | null;
  widgetState: WidgetState | null;

  maxHeight: number;
  safeArea: { top: number; bottom: number; left: number; right: number };
  view: string;
  userAgent: string;

  /** Whether the host handshake has completed. */
  isConnected: boolean;
  /** Set when the handshake failed, so a screen can say so instead of hanging. */
  error: Error | null;

  /**
   * Idempotent. The transport is one postMessage channel, so a second
   * handshake races the first and the loser answers "Not connected" to every
   * later call — which is how a buyer reached the payment methods and got a
   * red error with no tools/call ever reaching the server.
   */
  connect(): Promise<void>;
  setWidgetState(state: WidgetState | unknown): void;
  callTool(name: string, args: Record<string, unknown>): Promise<unknown>;
  /**
   * Drops the instruction handed to the model for a follow-up.
   *
   * Separate from sendFollowUpMessage because the two hosts finish the handoff
   * at different moments: ChatGPT sends immediately, Claude only proposes the
   * text and waits for the buyer. Clearing on the caller's signal — once a
   * dispatch is confirmed — is the only point both agree on.
   */
  clearModelContext(): Promise<void>;

  sendFollowUpMessage(options: {
    prompt: string;
    userMessage?: string;
  }): Promise<void>;
  requestDisplayMode(options: {
    mode: "inline" | "fullscreen" | "pip";
  }): Promise<void>;
  openExternal(options: { href: string }): Promise<void>;
  requestClose(): void;

  subscribe(callback: () => void): () => void;
  getHostContext(): McpUiHostContext | null;
}

// ----------------------------------------------------------------------------
// Legacy OpenAI Apps SDK Implementation
// ----------------------------------------------------------------------------

class LegacyOpenAiClient implements ClientPlatform {
  readonly type = "openai_legacy";
  private listeners: Set<() => void> = new Set();

  constructor() {
    window.addEventListener("openai:set_globals", () => {
      this.notifyListeners();
    });
  }

  async connect(): Promise<void> {
    if (!window.openai) {
      console.warn("LegacyOpenAiClient: window.openai is missing");
    }
  }

  /** No handshake to wait for — the host injects window.openai synchronously. */
  get isConnected() {
    return true;
  }

  get error(): Error | null {
    return null;
  }

  get theme() {
    return window.openai?.theme ?? "light";
  }

  get locale() {
    return window.openai?.locale ?? "en-US";
  }

  get displayMode() {
    return window.openai?.displayMode ?? "inline";
  }

  get toolInput() {
    return window.openai?.toolInput ?? null;
  }

  get toolOutput() {
    return (window.openai?.toolOutput as ToolOutput | undefined) ?? null;
  }

  get toolResponseMetadata() {
    return (
      (window.openai?.toolResponseMetadata as
        | ToolResponseMetadata
        | undefined) ?? null
    );
  }

  get widgetState() {
    return (window.openai?.widgetState as WidgetState | undefined) ?? null;
  }

  get maxHeight() {
    return window.openai?.maxHeight ?? 0;
  }

  get safeArea() {
    return window.openai?.safeArea ?? { top: 0, bottom: 0, left: 0, right: 0 };
  }

  get view() {
    return window.openai?.view ?? "main";
  }

  get userAgent() {
    return window.openai?.userAgent ?? "";
  }

  setWidgetState(state: WidgetState | unknown): void {
    if (window.openai?.setWidgetState) {
      window.openai.setWidgetState(state as WidgetState);
    }
  }

  async callTool(
    name: string,
    args: Record<string, unknown>,
  ): Promise<unknown> {
    if (!window.openai?.callTool) {
      throw new Error("window.openai.callTool not available");
    }
    return window.openai.callTool(name, args);
  }

  async sendFollowUpMessage(options: {
    prompt: string;
    userMessage?: string;
  }): Promise<void> {
    if (window.openai?.sendFollowUpMessage) {
      // userMessage is forwarded rather than dropped. demo's copy of this
      // bridge discards it, so on ChatGPT its callers' userMessage never
      // reaches the host at all — which means it cannot be what makes demo
      // work. Forwarded here so the field is at least testable instead of
      // silently inert.
      await window.openai.sendFollowUpMessage({
        prompt: options.prompt,
        ...(options.userMessage ? { userMessage: options.userMessage } : {}),
      });
    }
  }

  async clearModelContext(): Promise<void> {
    // ChatGPT carries the instruction in sendFollowUpMessage itself and has no
    // separate model context to drop, so there is nothing to undo.
  }

  async requestDisplayMode(options: {
    mode: "inline" | "fullscreen" | "pip";
  }): Promise<void> {
    if (window.openai?.requestDisplayMode) {
      await window.openai.requestDisplayMode(options);
    }
  }

  async openExternal(options: { href: string }): Promise<void> {
    if (window.openai?.openExternal) {
      window.openai.openExternal(options);
    } else {
      window.open(options.href, "_blank", "noopener,noreferrer");
    }
  }

  requestClose(): void {
    window.openai?.requestClose?.();
  }

  subscribe(callback: () => void): () => void {
    this.listeners.add(callback);
    return () => this.listeners.delete(callback);
  }

  getHostContext(): null {
    return null;
  }

  private notifyListeners() {
    for (const listener of this.listeners) {
      listener();
    }
  }
}

// ----------------------------------------------------------------------------
// MCP Apps SDK Implementation
// ----------------------------------------------------------------------------

class McpAppsClient implements ClientPlatform {
  readonly type = "mcp_apps";
  private app: App;
  private listeners: Set<() => void> = new Set();

  private _toolInput: Record<string, unknown> | null = null;
  private _toolOutput: ToolOutput | null = null;
  private _toolResponseMetadata: ToolResponseMetadata | null = null;
  private _widgetState: WidgetState | null = null;
  private _connected = false;
  private _error: Error | null = null;
  /** The in-flight handshake, so concurrent callers await one rather than open another. */
  private _handshake: Promise<void> | null = null;

  constructor() {
    this.app = new App({
      name: "Good Food",
      version: "1.0.0",
    });

    this._widgetState = this.readOpenAIWidgetState() ?? this.readStoredWidgetState();

    this.app.ontoolinput = (params) => {
      this._toolInput = params.arguments as Record<string, unknown>;
      this.notifyListeners();
    };

    this.app.ontoolresult = (params) => {
      this._toolOutput =
        ((params as any).structuredContent as ToolOutput) ?? null;
      const meta = ((params as any)._meta as ToolResponseMetadata) ?? {};
      this._toolResponseMetadata = meta;
      this.notifyListeners();
    };

    this.app.onhostcontextchanged = () => {
      this.notifyListeners();
    };

    this.app.onerror = (caught: unknown) => {
      // Routine on this transport: the host replies to ids it no longer
      // tracks. Surfacing it would paint a connection error over a widget
      // that is working.
      if (String(caught).includes("unknown message ID")) return;
      this._error = caught instanceof Error ? caught : new Error(String(caught));
      this.notifyListeners();
    };

    window.addEventListener("openai:set_globals", () => {
      this._widgetState = this.readOpenAIWidgetState() ?? this._widgetState;
      this.notifyListeners();
    });
  }

  get isConnected() {
    return this._connected;
  }

  get error() {
    return this._error;
  }

  async connect(): Promise<void> {
    if (this._handshake) return this._handshake;

    this._handshake = this.app
      .connect()
      .then(() => {
        this._connected = true;
        this._error = null;
        // Any instruction left over from a previous turn names a tool and a
        // session that are no longer live. Clearing on connect stops it being
        // acted on again.
        void clearModelContext(this.app).catch(() => {});
        this.notifyListeners();
      })
      .catch((caught) => {
        this._error =
          caught instanceof Error ? caught : new Error(String(caught));
        // Let a later caller retry rather than latching the failure forever.
        this._handshake = null;
        this.notifyListeners();
        throw this._error;
      });

    return this._handshake;
  }

  get theme() {
    return (this.app.getHostContext()?.theme as "light" | "dark") ?? "light";
  }

  get locale() {
    return this.app.getHostContext()?.locale ?? "en-US";
  }

  get displayMode() {
    return (
      (this.app.getHostContext()?.displayMode as
        | "inline"
        | "fullscreen"
        | "pip") ?? "inline"
    );
  }

  get toolInput() {
    return this._toolInput;
  }

  get toolOutput() {
    return this._toolOutput;
  }

  get toolResponseMetadata() {
    return this._toolResponseMetadata;
  }

  get widgetState() {
    return this._widgetState;
  }

  get maxHeight() {
    return (this.app.getHostContext()?.viewport as any)?.maxHeight ?? 0;
  }

  get safeArea() {
    return (
      this.app.getHostContext()?.safeAreaInsets ?? {
        top: 0,
        bottom: 0,
        left: 0,
        right: 0,
      }
    );
  }

  get view() {
    return "main";
  }

  get userAgent() {
    return this.app.getHostContext()?.userAgent ?? "";
  }

  setWidgetState(state: WidgetState | unknown): void {
    this._widgetState = state as WidgetState;

    try {
      if (window.openai?.setWidgetState) {
        window.openai.setWidgetState(state as WidgetState);
      }
      localStorage.setItem("goodfood_widget_state", JSON.stringify(state));
      this.notifyListeners();
    } catch (e) {
      console.error("Failed to save widget state", e);
    }

    void this.app
      .updateModelContext({
        structuredContent: {
          widgetState: state as WidgetState,
        },
      })
      .catch(() => {
        // Ignore hosts that do not enable update-model-context.
      });
  }

  async callTool(
    name: string,
    args: Record<string, unknown>,
  ): Promise<unknown> {
    return this.app.callServerTool({ name, arguments: args });
  }

  async sendFollowUpMessage(options: {
    prompt: string;
    userMessage?: string;
  }): Promise<void> {
    if (options.userMessage) {
      await this.app.updateModelContext({
        content: [{ type: "text", text: options.prompt }],
        structuredContent: {
          appContext: options.prompt,
          widgetState: this._widgetState,
        },
      });
      // Deliberately NOT cleared here. On Claude sendMessage only proposes
      // the text into the composer and returns; the buyer has not sent it yet.
      // Clearing at this point deleted the paymentSessionId mid-decision and
      // the model answered "I don't have an active checkout session yet".
      // MethodSelector clears once a dispatch is confirmed instead.
      await this.app.sendMessage({
        role: "user",
        content: [{ type: "text", text: options.userMessage }],
      });
      return;
    }

    await this.app.sendMessage({
      role: "user",
      content: [{ type: "text", text: options.prompt }],
    });
  }

  async clearModelContext(): Promise<void> {
    await clearModelContext(this.app).catch(() => {
      // Ignore cleanup failures — a stale context is overwritten by the next
      // handoff anyway, and throwing here would fail a payment that worked.
    });
  }

  async requestDisplayMode(options: {
    mode: "inline" | "fullscreen" | "pip";
  }): Promise<void> {
    await this.app.requestDisplayMode(options);
  }

  async openExternal(options: { href: string }): Promise<void> {
    try {
      const result = await this.app.openLink({ url: options.href });
      if (result?.isError) {
        window.open(options.href, "_blank", "noopener,noreferrer");
      }
    } catch {
      console.log(
        "openExternal: Response matching error (link may have opened)",
      );
    }
  }

  requestClose(): void {
    console.warn("requestClose not supported in MCP Apps");
  }

  subscribe(callback: () => void): () => void {
    this.listeners.add(callback);
    return () => this.listeners.delete(callback);
  }

  getHostContext(): McpUiHostContext | null {
    return this.app.getHostContext() ?? null;
  }

  private readStoredWidgetState(): WidgetState | null {
    try {
      const stored = localStorage.getItem("goodfood_widget_state");
      return stored ? (JSON.parse(stored) as WidgetState) : null;
    } catch {
      return null;
    }
  }

  private readOpenAIWidgetState(): WidgetState | null {
    try {
      return (window.openai?.widgetState as WidgetState | undefined) ?? null;
    } catch {
      return null;
    }
  }

  private notifyListeners() {
    for (const listener of this.listeners) {
      listener();
    }
  }
}

// ----------------------------------------------------------------------------
// Factory / Singleton
// ----------------------------------------------------------------------------

let clientInstance: ClientPlatform | null = null;

export function isOpenAiLegacy(): boolean {
  return typeof window !== "undefined" && !!window.openai;
}

export function getClientPlatform(): ClientPlatform {
  if (clientInstance) {
    return clientInstance;
  }

  if (isOpenAiLegacy()) {
    console.log("Detected Legacy OpenAI Environment");
    clientInstance = new LegacyOpenAiClient();
  } else {
    console.log("Using MCP Apps Client");
    const mcpClient = new McpAppsClient();
    mcpClient.connect().catch((err) => {
      console.error("Failed to connect MCP Apps Client:", err);
    });
    clientInstance = mcpClient;
  }

  return clientInstance!;
}
