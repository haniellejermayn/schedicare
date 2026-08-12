# Demo operator checklist

## Start

For the August 13 presentation (appointments and disruption on August 14):

```powershell
$env:DEMO_NOW="2026-08-13T10:00:00.000Z"
npm run demo
```

Wait for `Starting web (http://localhost:3000) and worker`.

Open:

- `http://localhost:3000/doctor`
- `http://localhost:3000/ops`
- `http://localhost:3000/live`
- `http://localhost:3000/book`
- the `schedicare.test@gmail.com` inbox
- the clinic Google Calendar

## Operate the demo

1. **Doctor:** click **I can't come in** → choose **August 14** → **Family emergency** → confirm.
2. **Wait about 2 minutes:** open the case in **Front desk** when all 3 suggestions are ready.
3. **Front desk:** click **Approve all 3** → **Yes — approve all**.
4. **Patient Gmail:** reply to the newest three offer threads:
   - Camille: `yes, that's fine with me thank you`
   - Grace: `wag nalang po, pacancel nalang ng appointment thanks`
   - Miguel: `If okay lang po, pwede po kaya Saturday afternoon? Preferably after lunch po sana`
5. **Front desk:** Grace → **Follow up** → **Declined** → **Save outcome**.
6. **Front desk:** Miguel → **Review constraints** → **Search matching slots** → offer the first valid Saturday-afternoon slot.
7. **Front desk:** approve Miguel's new offer when it reaches **Needs your review**.
8. **Patient Gmail:** reply to Miguel's newest message: `yes, that's fine with me thank you`.
9. **Verify:** `/live` says **All three settled**; the case says **2 confirmed · 1 closed by staff**; Calendar contains the OOO block, Camille, and Miguel, with no Grace hold.
10. **Optional patient-view proof:** in `/book`, select Camille or Miguel and show the confirmed replacement visit.

## Stop or reset

- Stop: press `Ctrl+C` once in the demo terminal.
- Clean reset: rerun the two **Start** commands above.

Do not make cancellations/ghosting a presentation theme. Mention SMS, calls, Viber, and Messenger only as future integrations.
