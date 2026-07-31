#!/usr/bin/env bash
#
# seed-config.sh — write apps/ios/Config/Config.local.plist from the repo-root
# .env, without ever printing the values it copies.
#
# ═══════════════════════════════════════════════════════════════════════════
#  What this is for
# ═══════════════════════════════════════════════════════════════════════════
#
# The iOS app needs the Convex deployment URL, Clerk publishable key, and the
# web origin that shares that Clerk environment. Xcode
# cannot read a `.env`, and `apps/ios` is deliberately outside the Bun
# workspace, so something has to carry them across. This is that something.
#
# The alternative — typing them into the Xcode UI — is how an iOS app ends up
# pointed at a stale deployment for three days. Deriving them from the same
# file apps/web reads means the two clients cannot disagree about which backend
# they are talking to.
#
# Both values are public by design (see Config.local.example.plist for why, at
# length). This script still refuses to echo them, because a value that is safe
# to ship in a client bundle is not automatically safe to paste into an agent
# transcript, a CI log or a screen-share. Cheap discipline, no downside.
#
# ═══════════════════════════════════════════════════════════════════════════
#  Contract
# ═══════════════════════════════════════════════════════════════════════════
#
#   - Idempotent. Run it as often as you like; it rewrites the file each time.
#   - Never exits non-zero for a *missing* value. A fresh clone with no `.env`
#     gets the placeholder template instead, so `xcodegen generate` and
#     `xcodebuild` both still succeed and the app reports "not configured" at
#     runtime from Config.swift. A toolchain that dies at generate time teaches
#     you nothing about which variable was absent.
#   - DOES exit non-zero if `.env` exists but a value is malformed, because
#     that is a typo rather than an un-set-up machine.
#
# Usage:
#     cd apps/ios && ./scripts/seed-config.sh
#
# Normally run as the first half of the regen command in README.md:
#     ./scripts/seed-config.sh && xcodegen generate

set -euo pipefail

# Belt and braces: `set -x` anywhere up the chain (a CI runner's default, an
# impatient debugger) would echo every expansion of $CONVEX_URL and $CLERK_KEY
# below. Turn it off explicitly rather than trusting the caller.
set +x

# ---------------------------------------------------------------------------
# Paths
# ---------------------------------------------------------------------------
# Resolved from this script's own location, not from $PWD, so the script works
# from anywhere — including from an Xcode build phase, whose working directory
# is not the one you would guess.

SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
IOS_DIR="$(cd -- "$SCRIPT_DIR/.." && pwd)"
REPO_ROOT="$(cd -- "$IOS_DIR/../.." && pwd)"

ENV_FILE="$REPO_ROOT/.env"
OUT_FILE="$IOS_DIR/Config/Config.local.plist"
EXAMPLE_FILE="$IOS_DIR/Config/Config.local.example.plist"

# ---------------------------------------------------------------------------
# read_env KEY
# ---------------------------------------------------------------------------
# Prints the value of KEY from $ENV_FILE on stdout, or nothing if absent.
#
# Deliberately NOT `source .env`: that would execute the file (a value
# containing backticks or $() is arbitrary code), and it would also drag every
# other variable in the file — CLERK_SECRET_KEY, OPENAI_API_KEY, the Convex
# deploy key — into this process's environment for no reason. Parsing one line
# with awk touches only the key asked for.
#
# Handles `KEY=value`, `KEY="value"`, `KEY='value'` and leading `export `.
read_env() {
  local key="$1"
  [ -f "$ENV_FILE" ] || return 0
  awk -v key="$key" '
    {
      line = $0
      sub(/^[[:space:]]*export[[:space:]]+/, "", line)
      if (index(line, key "=") != 1) next
      v = substr(line, length(key) + 2)
      # Strip one layer of matching surrounding quotes, if present.
      if (length(v) >= 2) {
        first = substr(v, 1, 1); last = substr(v, length(v), 1)
        if ((first == "\"" && last == "\"") || (first == "'"'"'" && last == "'"'"'"))
          v = substr(v, 2, length(v) - 2)
      }
      print v
      exit
    }
  ' "$ENV_FILE"
}

# ---------------------------------------------------------------------------
# Read
# ---------------------------------------------------------------------------

CONVEX_URL="$(read_env NEXT_PUBLIC_CONVEX_URL)"
CLERK_KEY="$(read_env NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY)"
WEB_ORIGIN="$(read_env NEXT_PUBLIC_SITE_URL)"

missing=()
[ -n "$CONVEX_URL" ] || missing+=("NEXT_PUBLIC_CONVEX_URL")
[ -n "$CLERK_KEY" ] || missing+=("NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY")

if [ ${#missing[@]} -gt 0 ]; then
  if [ -f "$ENV_FILE" ]; then
    echo "seed-config: .env found but missing: ${missing[*]}" >&2
  else
    echo "seed-config: no .env at repo root ($REPO_ROOT/.env)" >&2
  fi
  echo "seed-config: writing placeholders from Config.local.example.plist." >&2
  echo "seed-config: the app will build and report 'not configured' at launch." >&2
  cp "$EXAMPLE_FILE" "$OUT_FILE"
  # Exit 0 on purpose — see the Contract note at the top of this file.
  exit 0
fi

# ---------------------------------------------------------------------------
# Validate
# ---------------------------------------------------------------------------
# A present-but-wrong value is a typo in a file someone edited by hand, and it
# is worth failing loudly for: the symptom otherwise is a sign-in screen that
# spins forever with no error, which costs an afternoon to trace back here.
#
# Error messages name the VARIABLE and the expected SHAPE, never the value.

fail=0

case "$CONVEX_URL" in
  https://*.convex.cloud) ;;
  *)
    echo "seed-config: NEXT_PUBLIC_CONVEX_URL is not a Convex deployment URL." >&2
    echo "             expected shape: https://<deployment>.convex.cloud" >&2
    fail=1
    ;;
esac

case "$CLERK_KEY" in
  pk_test_* | pk_live_*) ;;
  sk_*)
    # Worth its own branch. Pasting the SECRET key here would put a
    # server-side credential into a client bundle — the one genuinely
    # dangerous mistake available in this script's blast radius.
    echo "seed-config: NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY holds a SECRET key (sk_…)." >&2
    echo "             That must never reach a client bundle. Use the pk_… key." >&2
    fail=1
    ;;
  *)
    echo "seed-config: NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY is not a publishable key." >&2
    echo "             expected shape: pk_test_… (dev) or pk_live_… (production)" >&2
    fail=1
    ;;
esac

[ "$fail" -eq 0 ] || exit 1

# Keep the upload route in the same Clerk environment as its bearer token. A
# development checkout defaults to the local web app; live builds default to
# the canonical site. Preview/tunnel deployments opt in with
# NEXT_PUBLIC_SITE_URL in the same .env used by apps/web.
if [ -z "$WEB_ORIGIN" ]; then
  case "$CLERK_KEY" in
    pk_test_*) WEB_ORIGIN="http://localhost:3000" ;;
    *) WEB_ORIGIN="https://coreybaines.com" ;;
  esac
fi
WEB_ORIGIN="${WEB_ORIGIN%/}"

case "$WEB_ORIGIN" in
  https://* | http://localhost:* | http://127.0.0.1:*) ;;
  *)
    echo "seed-config: NEXT_PUBLIC_SITE_URL must use https (localhost may use http)." >&2
    exit 1
    ;;
esac

# ---------------------------------------------------------------------------
# Write
# ---------------------------------------------------------------------------
# `plutil` rather than a heredoc: it escapes the values for XML correctly and
# validates the result. A heredoc would produce a subtly broken plist for any
# value containing `&` or `<`, and the failure would surface as a nil at
# runtime rather than as an error here.

mkdir -p "$(dirname "$OUT_FILE")"
rm -f "$OUT_FILE"
plutil -create xml1 "$OUT_FILE"
plutil -replace ConvexURL -string "$CONVEX_URL" "$OUT_FILE"
plutil -replace ClerkPublishableKey -string "$CLERK_KEY" "$OUT_FILE"
plutil -replace WebOrigin -string "$WEB_ORIGIN" "$OUT_FILE"
plutil -lint "$OUT_FILE" >/dev/null

# ---------------------------------------------------------------------------
# Report
# ---------------------------------------------------------------------------
# The Convex URL is printed: it is the single most useful thing to see here
# ("am I about to write to the dev deployment or the production one?"), and it
# is a public endpoint that is already visible in any browser's network tab.
#
# The Clerk key is NOT printed, only described. `pk_test_` vs `pk_live_` is the
# part that carries the same "which environment" information, and it is the
# part that is safe to say out loud.

case "$CLERK_KEY" in
  pk_test_*) clerk_env="development (pk_test_…)" ;;
  *) clerk_env="PRODUCTION (pk_live_…)" ;;
esac

echo "seed-config: wrote Config/Config.local.plist"
echo "             ConvexURL            $CONVEX_URL"
echo "             ClerkPublishableKey  $clerk_env, ${#CLERK_KEY} chars"
echo "             WebOrigin            $WEB_ORIGIN"
