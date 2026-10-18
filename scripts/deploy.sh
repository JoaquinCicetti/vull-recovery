#!/usr/bin/env bash
# One deploy, two modes — same site (www.vull.com.ar), same Supabase project.
#
#   scripts/deploy.sh          → PROD mode: real Talo account
#   scripts/deploy.sh dev      → DEV mode:  Talo sandbox + "Simular pago" button
#                                           + "DEV MODE" badge on every page
#   SKIP_SECRETS=1 scripts/deploy.sh …   → Worker only, leave Supabase alone
#   scripts/deploy.sh [mode] --strict    → fail (instead of warn) when a
#                                           required edge secret is missing
#
# The mode is two things switched together, so they can never disagree:
#   1. Supabase secrets ← supabase/.env.<mode>   (Talo keys, TALO_TEST, DEV_MODE)
#   2. The Worker build's NEXT_PUBLIC_DEV_MODE / NEXT_PUBLIC_TALO_ENABLED
#
# Secrets files (gitignored), same keys in both:
#   supabase/.env.prod   TALO_USER_ID, TALO_CLIENT_ID, TALO_CLIENT_SECRET,
#                        TALO_TEST=false, DEV_MODE=false
#   supabase/.env.dev    the SANDBOX account, TALO_TEST=true, DEV_MODE=true
# TALO_WEBHOOK_SECRET / TALO_RECONCILE_TOKEN are ours, not Talo's: leave them
# out and they stay as they are.
#
# Every other edge secret (email, push, cron tokens…) is set once by hand; the
# canonical list is supabase/.env.secrets.example. Each deploy compares it with
# `supabase secrets list` and warns about any required one that is missing.
#
# A payment still pending when the mode flips belongs to the other Talo account
# and won't settle until you flip back — don't switch with real payments open.
#
# Browser config: NEXT_PUBLIC_* are inlined at build time, and Next lets
# .env.local override .env.production even in `next build`, so the values are
# exported here first (process env wins over every .env file).
set -euo pipefail
cd "$(dirname "$0")/.."

mode=prod
strict=false
for arg in "$@"; do
  case "$arg" in
    prod|dev) mode="$arg" ;;
    --strict) strict=true ;;
    *) echo "usage: $0 [prod|dev] [--strict]" >&2; exit 1 ;;
  esac
done
case "$mode" in
  prod) dev=false ;;
  dev)  dev=true ;;
esac
secrets_file="supabase/.env.$mode"

die() { echo "✗ $*" >&2; exit 1; }
# Value of KEY in an env file (last wins, surrounding quotes stripped).
val() { grep -E "^$2=" "$1" | tail -1 | cut -d= -f2- | sed -E 's/^"(.*)"$/\1/'; }

# ── Browser config ──────────────────────────────────────────────────────────
[ -f .env.production ] || die "missing .env.production"
while IFS= read -r line; do export "$line"; done \
  < <(grep -E '^NEXT_PUBLIC_[A-Z0-9_]+=' .env.production)
export NEXT_PUBLIC_DEV_MODE="$dev"
# Dev mode exists to exercise Talo, so its option is always shown there.
[ "$dev" = true ] && export NEXT_PUBLIC_TALO_ENABLED=true
case "${NEXT_PUBLIC_SITE_URL:-}" in
  https://*) ;;
  *) die "NEXT_PUBLIC_SITE_URL must be an https URL" ;;
esac

# ── Supabase secrets ────────────────────────────────────────────────────────
if [ "${SKIP_SECRETS:-}" != 1 ]; then
  [ -f "$secrets_file" ] || die "missing $secrets_file (see the header of $0)"
  for k in TALO_USER_ID TALO_CLIENT_ID TALO_CLIENT_SECRET; do
    [ -n "$(val "$secrets_file" "$k")" ] || die "$secrets_file: $k is empty"
  done
  # A sandbox file can't reach prod mode by accident, nor the reverse.
  [ "$(val "$secrets_file" DEV_MODE)" = "$dev" ] || die "$secrets_file: DEV_MODE must be $dev"
  [ "$(val "$secrets_file" TALO_TEST)" = "$dev" ] || die "$secrets_file: TALO_TEST must be $dev"

  echo "→ Supabase secrets ← $secrets_file (DEV_MODE=$dev TALO_TEST=$dev)"
  pnpm exec supabase secrets set --env-file "$secrets_file"
fi

# ── Required edge secrets present? ──────────────────────────────────────────
# Names above "# @optional" in supabase/.env.secrets.example. A missing one is
# how every email silently no-op'd until 2026-10-13 and the crons 401'd.
check_secrets() {
  local listed missing=() k
  if ! listed="$(pnpm exec supabase secrets list 2>/dev/null)"; then
    echo "⚠ could not list Supabase secrets (not linked / not logged in?); skipping the check" >&2
    [ "$strict" = true ] && die "--strict: secrets not verified"
    return 0
  fi
  for k in $(sed '/^# @optional/q' supabase/.env.secrets.example | grep -oE '^[A-Z0-9_]+=' | tr -d '='); do
    grep -qw "$k" <<<"$listed" || missing+=("$k")
  done
  if grep -qw EMAIL_SINK_URL <<<"$listed"; then
    echo "⚠ EMAIL_SINK_URL is set on the project: emails go to a dev sink. Unset it." >&2
    [ "$strict" = true ] && die "--strict: EMAIL_SINK_URL must not be a deployed secret"
  fi
  if [ ${#missing[@]} -gt 0 ]; then
    echo "⚠ missing edge secrets: ${missing[*]} (see supabase/.env.secrets.example)" >&2
    [ "$strict" = true ] && die "--strict: required secrets missing"
  else
    echo "→ required edge secrets: all set"
  fi
}
check_secrets

# ── Worker ──────────────────────────────────────────────────────────────────
echo "→ Worker ($mode mode): DEV_MODE=$dev TALO=${NEXT_PUBLIC_TALO_ENABLED:-false} SITE_URL=$NEXT_PUBLIC_SITE_URL"
pnpm exec opennextjs-cloudflare build
pnpm exec opennextjs-cloudflare deploy
