# MCP feasibility notes

**Question:** should SchediCare's calendar/mail effects run over MCP instead of
direct Google APIs?

**Short answer:** not for this capstone's execution path; yes as a health-checked
readiness layer, which is what shipped.

## What we validated

- The `CalendarProvider` / `MailProvider` interfaces (create/list/delete event,
  draft/send/poll replies) map 1:1 onto typical Google-Workspace MCP tool sets —
  no interface change would be needed to swap transports.
- `GoogleWorkspaceMcpTransport` connects over Streamable HTTP with the official
  SDK, lists tools, times out politely, and reports one of five explicit states
  on `/integrations`. Unreachable endpoints degrade to a report, never a crash
  (tested).

## Why direct APIs stayed the execution path

1. **The approval gate needs exact semantics.** The executor re-validates and
   then must know precisely what a "create event" did (id, status) to record
   effects and support supersede/cancel. Direct typed clients give this;
   generic MCP tool results vary by server implementation.
2. **Draft-then-explicit-send is a hard product rule.** Gmail's draft
   lifecycle (create draft → staff presses Send → send *that* draft id) is
   guaranteed by the API; most community MCP gmail servers expose "send email"
   without a separable draft step, which would silently weaken the human gate.
3. **Failure-mode ownership.** Resilience mode depends on distinguishing
   auth vs quota vs network errors per service to flip individual components;
   an MCP hop makes those signals server-dependent.
4. **One less moving part in a live demo.**

## When MCP becomes the right call

A clinic suite exposing an *official* MCP server with draft-level mail tools
and typed event results would flip points 1–2. The provider factory would gain
`CALENDAR_PROVIDER=mcp` / `MAIL_PROVIDER=mcp` implementations backed by the
existing transport — an isolated change (`integrations/factory.ts` +
one provider file each), with the simulated twins still covering resilience.
