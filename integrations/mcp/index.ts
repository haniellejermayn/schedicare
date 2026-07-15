/**
 * MCP readiness path. Direct Google APIs are the implemented core integration;
 * this transport layer is a real (non-fake) MCP client that can be pointed at
 * a Google Workspace MCP endpoint when one is available to the team. It never
 * claims to be connected when it is not: the health check performs an actual
 * MCP initialize + tools/list over Streamable HTTP and reports exactly what
 * happened. See docs/MCP_SETUP.md and docs/MCP_FEASIBILITY.md.
 */
import { env } from "@/core/env";
import { setServiceHealth } from "@/core/status";

export type McpStatus =
  | { state: "disabled"; detail: string }
  | { state: "configured_unauthenticated"; detail: string; url?: string }
  | { state: "connected"; detail: string; url: string; tools: string[] }
  | { state: "unavailable"; detail: string; url?: string }
  | { state: "fallback"; detail: string };

export interface McpTransport {
  readonly name: string;
  status(): Promise<McpStatus>;
  healthCheck(): Promise<McpStatus>;
}

export class DisabledMcpTransport implements McpTransport {
  readonly name = "disabled";
  async status(): Promise<McpStatus> {
    return {
      state: "disabled",
      detail: "MCP_TRANSPORT=disabled — direct Google APIs are the active integration path.",
    };
  }
  async healthCheck(): Promise<McpStatus> {
    return this.status();
  }
}

type ConnectFn = (url: string) => Promise<{ tools: string[] }>;

async function defaultConnect(url: string): Promise<{ tools: string[] }> {
  // Imported lazily so the app runs even if the SDK is absent in exotic setups.
  const { Client } = await import("@modelcontextprotocol/sdk/client/index.js");
  const { StreamableHTTPClientTransport } = await import("@modelcontextprotocol/sdk/client/streamableHttp.js");
  const client = new Client({ name: "schedicare", version: "1.0.0" });
  const transport = new StreamableHTTPClientTransport(new URL(url));
  try {
    await client.connect(transport);
    const res = await client.listTools();
    return { tools: (res.tools ?? []).map((t) => t.name) };
  } finally {
    await client.close().catch(() => undefined);
  }
}

export class GoogleWorkspaceMcpTransport implements McpTransport {
  readonly name = "google-workspace";
  constructor(
    private urls: { calendar?: string; gmail?: string },
    private connect: ConnectFn = defaultConnect,
    private timeoutMs = 6000
  ) {}

  private firstUrl(): string | undefined {
    return this.urls.calendar || this.urls.gmail || undefined;
  }

  async status(): Promise<McpStatus> {
    const url = this.firstUrl();
    if (!url) {
      return {
        state: "configured_unauthenticated",
        detail: "MCP_TRANSPORT=http but no GOOGLE_CALENDAR_MCP_URL / GOOGLE_GMAIL_MCP_URL set.",
      };
    }
    return {
      state: "configured_unauthenticated",
      detail: "Endpoint configured. Run the health check to verify (initialize + tools/list).",
      url,
    };
  }

  async healthCheck(): Promise<McpStatus> {
    const url = this.firstUrl();
    if (!url) return this.status();
    try {
      const result = await Promise.race([
        this.connect(url),
        new Promise<never>((_, rej) => setTimeout(() => rej(new Error(`MCP handshake timed out after ${this.timeoutMs}ms`)), this.timeoutMs)),
      ]);
      return {
        state: "connected",
        detail: `MCP initialize + tools/list succeeded — ${result.tools.length} tool(s) discovered.`,
        url,
        tools: result.tools.slice(0, 25),
      };
    } catch (e) {
      return {
        state: "unavailable",
        detail: `MCP endpoint unreachable or handshake failed: ${String((e as Error).message).slice(0, 180)}`,
        url,
      };
    }
  }
}

export function getMcpTransport(connect?: ConnectFn): McpTransport {
  const e = env();
  if (e.MCP_TRANSPORT === "disabled") return new DisabledMcpTransport();
  return new GoogleWorkspaceMcpTransport(
    { calendar: e.GOOGLE_CALENDAR_MCP_URL || undefined, gmail: e.GOOGLE_GMAIL_MCP_URL || undefined },
    connect
  );
}

export async function runMcpHealthCheck(): Promise<McpStatus> {
  const t = getMcpTransport();
  const s = await t.healthCheck();
  setServiceHealth("mcp", {
    status: s.state === "connected" ? "ok" : s.state === "disabled" ? "disabled" : "error",
    detail: s.detail,
  });
  return s;
}
