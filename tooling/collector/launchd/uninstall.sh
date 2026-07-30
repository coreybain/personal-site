#!/usr/bin/env bash
#
# uninstall.sh — stop and remove the daily collector job.
#
# Leaves the log file and the token alone. Removing the agent is a decision about
# scheduling; deleting the token is a decision about credentials, and the right
# way to make that one is to revoke the token in admin so the *server* stops
# accepting it (`ingestTokens.revoke` — a tombstone, not a delete).

set -euo pipefail

LABEL="com.coreybaines.home-collector"
PLIST="${HOME}/Library/LaunchAgents/${LABEL}.plist"

if launchctl print "gui/$(id -u)/${LABEL}" > /dev/null 2>&1; then
  launchctl bootout "gui/$(id -u)/${LABEL}"
  echo "  Booted out ${LABEL}"
else
  echo "  ${LABEL} was not loaded"
fi

if [[ -f "${PLIST}" ]]; then
  rm "${PLIST}"
  echo "  Removed ${PLIST}"
else
  echo "  No plist at ${PLIST}"
fi

printf '\n  The log at ~/Library/Logs/%s.log and any token file were left in place.\n' "${LABEL}"
printf '  To stop the server accepting pushes, revoke the token in admin.\n\n'
