# MCP setup (experimental readiness path)

SchediCare's default Google integration is the direct Calendar/Gmail APIs.
The Model Context Protocol path exists to prove the integration layer is
transport-agnostic: the same provider interfaces can be served over MCP.

## Current state

`MCP_TRANSPORT=disabled` by default. The `/integrations` MCP card shows the
transport state and a **Verify** button that performs a real health check
(connect → `listTools` → report tool names) using
`@modelcontextprotocol/sdk`'s Streamable HTTP client.

## Trying it

1. Run any MCP server that exposes Google Workspace tools over Streamable
   HTTP — e.g. the community `google-workspace-mcp` projects, or
   `mcp-remote`-bridged calendar/gmail servers. Note their HTTP endpoints.
2. Configure:

```
MCP_TRANSPORT=http
GOOGLE_CALENDAR_MCP_URL=http://localhost:8811/mcp
GOOGLE_GMAIL_MCP_URL=http://localhost:8812/mcp
```

3. Restart, open **/integrations**, press **Verify** on the MCP card. States:
   `disabled`, `configured_unauthenticated`, `connected` (with tool list),
   `unavailable` (endpoint unreachable — reported, never thrown), `fallback`.

The health check is covered by tests (`tests/providers.test.ts`) including the
unreachable-endpoint path. Scheduling effects continue to flow through the
direct providers regardless of MCP state — see MCP_FEASIBILITY.md for why.
