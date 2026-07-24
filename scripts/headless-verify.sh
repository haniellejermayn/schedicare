#!/usr/bin/env bash
# Headless verification: production server + worker, full flagship flow via HTTP.
set -u
cd "$(dirname "$0")/.."
PORT="${HEADLESS_PORT:-$((3100 + RANDOM % 400))}"
BASE="http://localhost:$PORT"
export DATABASE_URL="file:./.tmp/headless.db"
export PACING_MS=200
# Intentionally no AUTO_SIMULATE_REPLIES / MAIL_PROVIDER overrides: this mirrors
# `npm run dev` + `npm run worker` with no .env (MAIL_PROVIDER defaults to gmail,
# degrades to simulated) and verifies auto-replies key off the EFFECTIVE provider.
# Clear any stale servers from a previous run, then start clean
NEXT_PAT="[n]ext-server"; WORKER_PAT="[t]sx worker/index.ts"
pkill -f "$NEXT_PAT" 2>/dev/null; pkill -f "$WORKER_PAT" 2>/dev/null
command -v fuser >/dev/null 2>&1 && fuser -k "$PORT/tcp" 2>/dev/null
sleep 1
rm -f .tmp/headless.db* .tmp/headless.graph.db*

pass=0; fail=0
ok()  { pass=$((pass+1)); echo "  ✓ $1"; }
bad() { fail=$((fail+1)); echo "  ✗ $1"; }

echo "[headless] seeding…"
npx tsx scripts/setup.ts > /tmp/headless-setup.log 2>&1 || { echo "seed failed"; exit 1; }

echo "[headless] starting web ($PORT) + worker…"
npx next start -p $PORT > /tmp/headless-web.log 2>&1 &
WEB=$!
npx tsx worker/index.ts > /tmp/headless-worker.log 2>&1 &
WORKER=$!
trap 'kill $WEB $WORKER 2>/dev/null' EXIT

py() { python3 -c "$1"; }
jget() { curl -s "$BASE$1"; }
jpost() { curl -s -X POST -H 'Content-Type: application/json' ${2:+-d "$2"} "$BASE$1"; }

# Wait for web
for i in $(seq 1 60); do curl -sf "$BASE/api/status" > /dev/null && break; sleep 1; done
STATUS=$(jget /api/status)
echo "$STATUS" | grep -q '"mode":"resilience"' && ok "status: resilience mode active" || bad "status mode: $STATUS"

# Pages render
for p in /ops /book /doctor /settings; do
  code=$(curl -s -o /dev/null -w "%{http_code}" "$BASE$p")
  [ "$code" = "200" ] && ok "GET $p → 200" || bad "GET $p → $code"
done
# Legacy URLs redirect into /settings
for p in /integrations /admin; do
  loc=$(curl -s -o /dev/null -w "%{redirect_url}" "$BASE$p")
  case "$loc" in
    *"/settings"*) ok "GET $p → redirects to /settings" ;;
    *) bad "GET $p → no /settings redirect (got: $loc)" ;;
  esac
done

# Wait for the boot sweep to open the secondary cases
sleep 4
SWEEP=$(jget /api/cases)
echo "$SWEEP" | grep -q '"confirmation"' && ok "sweep: confirmation case (Paolo) opened" || bad "sweep: no confirmation case"
echo "$SWEEP" | grep -q '"no_show_risk"' && ok "sweep: no-show-risk case (Dennis) opened" || bad "sweep: no risk case"
echo "$SWEEP" | grep -q '"slot_recovery"' && ok "sweep: slot-recovery case (Liza) opened" || bad "sweep: no slot-recovery case"

# Trigger the flagship cascade
R=$(jpost /api/doctor/doc_santos/unavailable '{"date":"2026-08-10","reason":"Family emergency"}')
echo "$R" | grep -q '"ok":true' && ok "emergency button accepted" || bad "emergency: $R"

# Poll for awaiting_approval doctor_emergency case
CASE_ID=""
for i in $(seq 1 40); do
  CASE_ID=$(jget /api/cases | py "
import sys, json
d = json.load(sys.stdin)
for c in d['cases']:
    if c['type'] == 'doctor_emergency' and c['state'] == 'awaiting_approval':
        print(c['id']); break
")
  [ -n "$CASE_ID" ] && break
  sleep 1
done
[ -n "$CASE_ID" ] && ok "cascade reached awaiting_approval (case $CASE_ID)" || { bad "cascade never reached awaiting_approval"; tail -20 /tmp/headless-worker.log; exit 1; }

DETAIL=$(jget "/api/cases/$CASE_ID")
N=$(echo "$DETAIL" | py "import sys,json; d=json.load(sys.stdin); print(len(d['recommendations']))")
[ "$N" = "6" ] && ok "6 recommendations proposed" || bad "expected 6 recommendations, got $N"

# Staff decisions: approve Teresa/Camille/Miguel/Andres, modify Jose, reject Grace
DECIDE=$(echo "$DETAIL" | py "
import sys, json
d = json.load(sys.stdin)
out = []
for r in d['recommendations']:
    p = r['payload']; name = p.get('patientName','')
    if name.startswith('Jose'):
        alt = next((o['id'] for o in p['options'] if o['id'] != p.get('chosenOptionId')), p['options'][0]['id'])
        out.append((r['id'], 'modify', alt))
    elif name.startswith('Grace'):
        out.append((r['id'], 'reject', ''))
    else:
        out.append((r['id'], 'approve', ''))
for rid, action, opt in out: print(f'{rid}|{action}|{opt}')
")
echo "$DECIDE" | while IFS='|' read -r RID ACTION OPT; do
  case "$ACTION" in
    approve) BODY='{"action":"approve"}';;
    modify)  BODY="{\"action\":\"modify\",\"optionId\":\"$OPT\"}";;
    reject)  BODY='{"action":"reject","reason":"Prefers a phone call — front desk will ring her"}';;
  esac
  RES=$(jpost "/api/recommendations/$RID/decision" "$BODY")
  echo "$RES" | grep -q '"ok":true' || echo "  ✗ decision $ACTION on $RID failed: $RES"
done
ok "staff decisions submitted (4 approve / 1 modify / 1 reject)"

# Wait for execution + persona replies + Miguel counter → replan awaiting approval
REPLAN_ID=""
for i in $(seq 1 60); do
  REPLAN_ID=$(jget "/api/cases/$CASE_ID" | py "
import sys, json
d = json.load(sys.stdin)
for r in d['recommendations']:
    if r['status'] == 'proposed' and r['payload'].get('replanOf'):
        print(r['id']); break
")
  [ -n "$REPLAN_ID" ] && break
  sleep 2
done
[ -n "$REPLAN_ID" ] && ok "Miguel counter produced a replan awaiting approval" || bad "no replan appeared (check /tmp/headless-worker.log)"

if [ -n "$REPLAN_ID" ]; then
  jpost "/api/recommendations/$REPLAN_ID/decision" '{"action":"approve"}' > /dev/null
  ok "replan approved"
fi

# Wait for resolution
STATE=""
for i in $(seq 1 60); do
  STATE=$(jget "/api/cases/$CASE_ID" | py "import sys,json; print(json.load(sys.stdin)['case']['state'])")
  [ "$STATE" = "resolved" ] && break
  sleep 2
done
[ "$STATE" = "resolved" ] && ok "case resolved end-to-end" || bad "final state: $STATE"

BOARD=$(jget "/api/cases/$CASE_ID" | py "
import sys, json
s = json.load(sys.stdin)['scoreboard']
print(f\"rebooked={s['rebooked']} confirmed={s['confirmed']} needsCall={s['declinedOrCallback']} minutes={s['minutesRecovered']}\")
")
echo "  ▸ scoreboard: $BOARD"
echo "$BOARD" | grep -q "rebooked=5 confirmed=5" && ok "scoreboard: 5 rebooked, 5 confirmed" || bad "scoreboard unexpected: $BOARD"

# Feed streams
FEED=$(timeout 4 curl -sN "$BASE/api/feed?caseId=$CASE_ID" | head -c 4000)
echo "$FEED" | grep -q "event: timeline" && ok "SSE feed streams timeline events" || bad "SSE feed empty"

# Audit shows human decisions
AUDIT=$(jget "/api/admin/audit?q=recommendation")
echo "$AUDIT" | grep -q "recommendation.reject" && ok "audit trail includes the rejection" || bad "audit missing rejection"

echo
echo "[headless] PASS=$pass FAIL=$fail"
kill $WEB $WORKER 2>/dev/null
[ "$fail" = "0" ] || exit 1
