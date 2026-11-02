#!/usr/bin/env bash
# Mints a PayPal sandbox access token from .env and merges it into
# ~/.claude/settings.json for the PayPal AI Toolkit plugin's MCP server.
#
# Tokens last ~9 hours. Re-run this when /paypal:setup reports a 401,
# then fully restart Claude Code.
#
#   bash scripts/paypal-token.sh
set -euo pipefail

cd "$(dirname "$0")/.."
[ -f .env ] || { echo "no .env found"; exit 1; }
set -a; . ./.env; set +a

TOKEN=$(curl -s -X POST https://api-m.sandbox.paypal.com/v1/oauth2/token \
  -u "$PAYPAL_CLIENT_ID:$PAYPAL_CLIENT_SECRET" \
  -d "grant_type=client_credentials" \
  | python3 -c 'import json,sys; print(json.load(sys.stdin).get("access_token",""))')

[ -n "$TOKEN" ] || { echo "could not mint a token — check PAYPAL_CLIENT_ID/SECRET in .env"; exit 1; }

SETTINGS="$HOME/.claude/settings.json"
cp "$SETTINGS" "$SETTINGS.bak"

TOKEN="$TOKEN" python3 - "$SETTINGS" <<'PY'
import json, os, sys
path = sys.argv[1]
with open(path) as f:
    cfg = json.load(f)
cfg.setdefault("env", {})["PAYPAL_SANDBOX_ACCESS_TOKEN"] = os.environ["TOKEN"]
with open(path, "w") as f:
    json.dump(cfg, f, indent=2)
    f.write("\n")
print(f"  wrote PAYPAL_SANDBOX_ACCESS_TOKEN ({os.environ['TOKEN'][:12]}…) to {path}")
PY

echo "  backup at $SETTINGS.bak"
echo
echo "  Now FULLY quit and reopen Claude Code, then run /paypal:setup"
