#!/bin/bash
set -euo pipefail

BASE_URL="${1:-${SMOKE_BASE_URL:-https://ship.187.77.7.226.sslip.io}}"
EMAIL="${SMOKE_EMAIL:-dev@ship.local}"
PASSWORD="${SMOKE_PASSWORD:-admin123}"

COOKIE_JAR="$(mktemp)"
trap 'rm -f "$COOKIE_JAR"' EXIT

echo "Smoke target: $BASE_URL"

echo "1. Health"
curl -fsS "$BASE_URL/health"
echo

echo "2. CSRF token"
CSRF_JSON="$(curl -fsS -c "$COOKIE_JAR" "$BASE_URL/api/csrf-token")"
CSRF_TOKEN="$(printf '%s' "$CSRF_JSON" | node -e "let body='';process.stdin.on('data',d=>body+=d);process.stdin.on('end',()=>console.log(JSON.parse(body).token));")"

echo "3. Login"
LOGIN_JSON="$(curl -fsS -b "$COOKIE_JAR" -c "$COOKIE_JAR" \
  -H 'content-type: application/json' \
  -H "x-csrf-token: $CSRF_TOKEN" \
  -d "{\"email\":\"$EMAIL\",\"password\":\"$PASSWORD\"}" \
  "$BASE_URL/api/auth/login")"
printf '%s' "$LOGIN_JSON" | node -e "let body='';process.stdin.on('data',d=>body+=d);process.stdin.on('end',()=>{const data=JSON.parse(body);if(!data.success){process.exit(1)};console.log('login ok:', data.data.user.email)})"

echo "4. App shell"
curl -fsSI "$BASE_URL" >/dev/null

echo "Smoke passed"
