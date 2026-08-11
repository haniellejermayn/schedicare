# Google Workspace setup (live Calendar + Gmail)

Live mode makes **real** calendar events and sends **real** email after staff
approval. Use a
throwaway/demo Google account — never a production clinic account.

## 1. Google Cloud project + OAuth client (~5 minutes)

1. https://console.cloud.google.com → create project `schedicare-demo`.
2. **APIs & Services → Library**: enable **Google Calendar API** and **Gmail API**.
3. **APIs & Services → OAuth consent screen**: External → app name
   `SchediCare demo` → add your Google account under **Test users** (required —
   the app stays in *Testing*, no verification needed).
4. **Credentials → Create credentials → OAuth client ID** → *Web application*:
   - Authorized redirect URI: `http://localhost:3000/api/oauth/callback`
5. Copy the client id + secret into `.env.local`:

```
CALENDAR_PROVIDER=google
MAIL_PROVIDER=gmail
GOOGLE_CLIENT_ID=....apps.googleusercontent.com
GOOGLE_CLIENT_SECRET=GOCSPX-...
GOOGLE_REDIRECT_URI=http://localhost:3000/api/oauth/callback
```

## 2. Connect the account

Restart web + worker, open **Settings → Connections**, press **Connect Google**, and
approve the three scopes. SchediCare requests the minimum:

- `calendar.events` — create/read/delete events on the mapped calendars
- `gmail.compose` — create and send drafts
- `gmail.readonly` — read replies **on known threads only**

This is external-service authorization, not an app login; tokens are stored in
the local SQLite DB and refreshed automatically. **Reconnect Google** replaces
them.

## 3. Map doctors to calendars

Create two calendars in Google Calendar (e.g. *Dr. Santos* and *Dr. Reyes*),
copy each **Calendar ID** (calendar Settings → *Integrate calendar*), and paste
them into **Settings → Connections → Doctor calendar mapping**. Keeping the `sim-`
ids leaves that doctor on the simulated provider.

Press **Verify** on the Calendar and Gmail cards — you should see event counts
and your Gmail address.

## 4. Patient inboxes: `DEMO_PATIENT_EMAIL` plus-aliasing

Seeded patients need inboxes you can actually reply from. Set

```
DEMO_PATIENT_EMAIL=you@gmail.com
```

and re-run `npm run setup`. Every patient becomes a **plus-alias** of that
address — Teresa is `you+teresa.navarro@gmail.com`, Miguel
`you+miguel.torres@gmail.com`, and
so on. Gmail delivers all aliases to your single inbox, and because each offer
lives on its own thread, replying from your inbox routes the answer back to the
right patient automatically. Left empty, patients get `@riverside-demo.example`
addresses (only usable with the simulated provider).

## 5. How live mail behaves (the safety rails)

- Agents produce patient copy behind the staff approval gate. After approval,
  the executor creates and sends the Gmail draft; a retained draft is shown
  only when sending fails.
- The worker polls **known thread ids** at `GMAIL_POLL_MS` (3 s in the live
  demo) for replies (no inbox-wide
  reading), dedupes on message id, runs the reply guard, then the interpret →
  route → replan loop — identical to the simulated path.
- Calendar reads/creates and Gmail draft creation have labeled simulated
  fallbacks. A Gmail send failure retains the draft and requires staff recovery
  rather than risking a duplicate send (see FALLBACK_MODE.md).

## Troubleshooting

- **`redirect_uri_mismatch`** — the URI in Google Cloud must equal
  `GOOGLE_REDIRECT_URI` exactly (scheme, port, path).
- **403 `access_denied`** — add your account under *Test users*.
- **Events not visible** — you mapped a calendar the connected account can't
  write to; use calendars owned by that account.
- **No replies detected** — reply in the same thread (normal "Reply"), allow at
  least one configured polling interval, and check the worker log.
