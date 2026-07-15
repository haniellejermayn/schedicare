# Google Workspace setup (live Calendar + Gmail)

Live mode makes **real** calendar events and **real** email drafts. Use a
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

Restart web + worker, open **/integrations**, press **Connect Google**, and
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
them into **/integrations → Doctor → calendar mapping**. Keeping the `sim-`
ids leaves that doctor on the simulated provider.

Press **Verify** on the Calendar and Gmail cards — you should see event counts
and your Gmail address.

## 4. Patient inboxes: `DEMO_PATIENT_EMAIL` plus-aliasing

Seeded patients need inboxes you can actually reply from. Set

```
DEMO_PATIENT_EMAIL=you@gmail.com
```

and re-run `npm run setup`. Every patient becomes a **plus-alias** of that
address — Teresa is `you+teresa@gmail.com`, Miguel `you+miguel@gmail.com`, and
so on. Gmail delivers all aliases to your single inbox, and because each offer
lives on its own thread, replying from your inbox routes the answer back to the
right patient automatically. Left empty, patients get `@riverside-demo.example`
addresses (only usable with the simulated provider).

## 5. How live mail behaves (the safety rails)

- Agents produce **drafts only**, and only after staff approve the
  recommendation. Each recommendation card then shows *"Gmail draft is ready —
  nothing goes to the patient until you press Send."*
- The worker polls **known thread ids** every 20 s for replies (no inbox-wide
  reading), dedupes on message id, runs the reply guard, then the interpret →
  route → replan loop — identical to the simulated path.
- Any Calendar/Gmail failure marks the service unhealthy and degrades that
  component to its simulated twin, labeled, without stopping the case
  (see FALLBACK_MODE.md).

## Troubleshooting

- **`redirect_uri_mismatch`** — the URI in Google Cloud must equal
  `GOOGLE_REDIRECT_URI` exactly (scheme, port, path).
- **403 `access_denied`** — add your account under *Test users*.
- **Events not visible** — you mapped a calendar the connected account can't
  write to; use calendars owned by that account.
- **No replies detected** — reply in the same thread (normal "Reply"), give the
  20 s poll a moment, and check the worker log.
