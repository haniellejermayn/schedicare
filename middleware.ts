import { NextResponse, type NextRequest } from "next/server";

/**
 * Network boundary between the read-only audience view and the rest of the app.
 *
 * `npm run dev:lan` binds 0.0.0.0 so a phone can scan the projected QR and open
 * /live. That also puts /ops on the venue wi-fi, and this app has no login — so
 * without this, anyone in the room could open the front desk and approve
 * recommendations, which sends real mail and writes real calendar events.
 *
 * The split is the Host header: a request that arrived at localhost came from
 * the machine running the server (the presenting laptop), and gets everything.
 * A request that arrived at the LAN address came from another device, and may
 * reach only what /live actually needs.
 *
 * IMPORTANT FOR THE PRESENTER: use http://localhost:3000 on the laptop, not the
 * LAN IP. Browsing to http://192.168.x.x:3000/ops would lock you out of your
 * own console.
 *
 * This stops someone browsing to a URL, which is the realistic risk in a
 * classroom. It is not authentication and does not pretend to be: a Host header
 * can be forged by anyone who sets out to. Real auth is out of scope for the
 * capstone.
 */

/** Host values meaning "the machine running the server". */
const LOCAL_HOST = /^(localhost|127\.0\.0\.1|\[::1\])(:\d+)?$/i;

/** Pages another device may open. */
const AUDIENCE_PAGES = ["/live"];

/** Exact read-only endpoint used by the audience board. */
const AUDIENCE_APIS: ReadonlyArray<{
  path: RegExp;
  methods: readonly string[];
}> = [
  { path: /^\/api\/live\/demo$/, methods: ["GET"] },
];

/** Anything in /public — the logo, icons. Public by definition. */
const STATIC_FILE = /\.[a-z0-9]+$/i;

export function middleware(req: NextRequest) {
  if (LOCAL_HOST.test(req.headers.get("host") ?? "")) return NextResponse.next();

  const { pathname } = req.nextUrl;
  const method = req.method.toUpperCase();

  const allowed =
    STATIC_FILE.test(pathname) ||
    AUDIENCE_PAGES.some(
      (p) => pathname === p || pathname.startsWith(`${p}/`),
    ) ||
    AUDIENCE_APIS.some(
      (r) => r.path.test(pathname) && r.methods.includes(method),
    );

  if (allowed) return NextResponse.next();

  // A plain 404 rather than a 403 — "there is nothing here" invites less
  // curiosity than "you are not allowed in here".
  return new NextResponse(
    "<!doctype html><meta charset=utf-8><title>404</title>" +
      "<body style=\"font:16px system-ui;padding:3rem;color:#17212b\">" +
      "<h1 style=\"font-size:1.2rem\">404</h1>" +
      "<p>This page could not be found.</p>",
    { status: 404, headers: { "content-type": "text/html; charset=utf-8" } },
  );
}

export const config = {
  // Skip Next's own asset and HMR routes entirely — they must keep working on
  // a phone or the audience view cannot render or hot-reload.
  matcher: ["/((?!_next).*)"],
};
