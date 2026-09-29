#!/usr/bin/env bash
# Smoke-check a deployed Worker (3c.1, ARCHITECTURE §18.3). Run by deploy.yml after each deploy,
# and by hand: `bash scripts/smoke-deploy.sh https://app.maxoff.in https://maxoff.pixoraclips.workers.dev`.
#
#   1. GET /api/health answers 200 "ok" (the database was reached) and is never cached.
#   2. A redirect the proxy answers itself (GET /today, signed out → /login) carries every
#      security header: proved on the Worker, where next.config.ts's headers() rule does not
#      reach a proxy redirect.
#   3. With a second argument, that address (the workers.dev one) answers 308 to the first,
#      path and query kept, and carries the headers too.
#   4. The Continue page a one-time link lands on (GET /auth/confirm?token_hash=…&type=recovery,
#      3cB review) answers 200 with its own headers (AUTH_LINK_ROUTE_HEADERS in
#      src/core/http/response-headers.ts): cache-control no-store, x-robots-tag noindex,
#      referrer-policy no-referrer. The GET verifies nothing, so a never-issued token is safe to
#      send (e2e/warm.setup.ts warms the same URL).
#
# Only curl. Exit 1 on the first failure, naming it.
set -euo pipefail

origin="${1:?usage: smoke-deploy.sh <app origin> [workers.dev origin]}"
origin="${origin%/}"
alias_origin="${2:-}"
alias_origin="${alias_origin%/}"

fail() {
  echo "::error::smoke: $*"
  exit 1
}

# Lower-cased "name: value" lines of a response's headers, following no redirect.
headers_of() {
  curl -sS -o /dev/null -D - --max-redirs 0 "$@" | tr -d '\r' | tr '[:upper:]' '[:lower:]'
}

header() {
  # $1 = the captured headers, $2 = the name: prints the value (first occurrence) or nothing.
  printf '%s\n' "$1" | awk -v name="$2:" 'index($0, name) == 1 { sub(/^[^:]*: */, ""); print; exit }'
}

expect_security_headers() {
  local captured="$1" where="$2"
  local expected=(
    "x-frame-options|deny"
    "content-security-policy|frame-ancestors 'none'"
    "x-content-type-options|nosniff"
    "referrer-policy|strict-origin-when-cross-origin"
    "permissions-policy|camera=(), microphone=(), geolocation=()"
    "strict-transport-security|max-age=63072000; includesubdomains"
  )
  local pair name value got
  for pair in "${expected[@]}"; do
    name="${pair%%|*}"
    value="${pair#*|}"
    got="$(header "$captured" "$name")"
    [ "$got" = "$value" ] || fail "$where: $name is '${got:-missing}', expected '$value'"
  done
}

# 1. Health.
health_status="$(curl -sS -o /tmp/smoke-health.txt -w '%{http_code}' --max-redirs 0 "$origin/api/health")"
[ "$health_status" = "200" ] || fail "$origin/api/health answered $health_status (body: $(head -c 200 /tmp/smoke-health.txt))"
[ "$(cat /tmp/smoke-health.txt)" = "ok" ] || fail "$origin/api/health did not answer 'ok'"
health_headers="$(headers_of "$origin/api/health")"
[ "$(header "$health_headers" cache-control)" = "no-store" ] || fail "/api/health must be cache-control: no-store"
echo "smoke: /api/health ok"

# 2. A proxy redirect carries the headers.
redirect_headers="$(headers_of "$origin/today")"
status_line="$(printf '%s\n' "$redirect_headers" | head -n 1)"
case "$status_line" in
  *" 307"*|*" 308"*|*" 302"*) ;;
  *) fail "$origin/today signed out should redirect, got: $status_line" ;;
esac
location="$(header "$redirect_headers" location)"
case "$location" in
  */login?next=*) ;;
  *) fail "$origin/today should redirect to /login?next=…, got '${location:-missing}'" ;;
esac
expect_security_headers "$redirect_headers" "$origin/today (proxy redirect)"
echo "smoke: security headers on the proxy's redirect ok"

# 3. The workers.dev address → the custom domain.
if [ -n "$alias_origin" ]; then
  alias_headers="$(headers_of "$alias_origin/leave?month=2026-10")"
  status_line="$(printf '%s\n' "$alias_headers" | head -n 1)"
  case "$status_line" in
    *" 308"*) ;;
    *) fail "$alias_origin should answer 308, got: $status_line" ;;
  esac
  location="$(header "$alias_headers" location)"
  [ "$location" = "$origin/leave?month=2026-10" ] || fail "$alias_origin should redirect to $origin/leave?month=2026-10, got '${location:-missing}'"
  expect_security_headers "$alias_headers" "$alias_origin (canonical redirect)"
  echo "smoke: $alias_origin → $origin ok"
fi

# 4. The Continue page keeps a one-time link out of caches, indexes and referrers.
confirm_url="$origin/auth/confirm?token_hash=$(printf '%056d' 0)&type=recovery"
confirm_status="$(curl -sS -o /dev/null -w '%{http_code}' --max-redirs 0 "$confirm_url")"
[ "$confirm_status" = "200" ] || fail "$origin/auth/confirm answered $confirm_status, expected 200 (the Continue page)"
confirm_headers="$(headers_of "$confirm_url")"
case "$(header "$confirm_headers" cache-control)" in
  *no-store*) ;;
  *) fail "/auth/confirm must be cache-control: no-store, got '$(header "$confirm_headers" cache-control)'" ;;
esac
case "$(header "$confirm_headers" x-robots-tag)" in
  *noindex*) ;;
  *) fail "/auth/confirm must be x-robots-tag: noindex, got '$(header "$confirm_headers" x-robots-tag)'" ;;
esac
[ "$(header "$confirm_headers" referrer-policy)" = "no-referrer" ] \
  || fail "/auth/confirm must be referrer-policy: no-referrer, got '$(header "$confirm_headers" referrer-policy)'"
echo "smoke: the Continue page's headers ok"

echo "smoke: all checks passed for $origin"
