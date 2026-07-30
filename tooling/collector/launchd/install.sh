#!/usr/bin/env bash
#
# install.sh — render the plist template and load the daily collector job.
#
#   ./launchd/install.sh            # daily at 09:20 local
#   ./launchd/install.sh 07 05      # daily at 07:05 local
#
# Idempotent: re-running re-renders the plist and reloads the agent, which is
# what you want after editing the template, moving the checkout, or upgrading
# bun (the plist hard-codes bun's path, because launchd has no useful PATH).
#
# Installing does NOT run the job — `RunAtLoad` is false. Use the kickstart
# command printed at the end to run it once on demand.

set -euo pipefail

HOUR="${1:-9}"
MINUTE="${2:-20}"

LABEL="com.coreybaines.home-collector"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
COLLECTOR_DIR="$(cd "${SCRIPT_DIR}/.." && pwd)"
TEMPLATE="${SCRIPT_DIR}/${LABEL}.plist.template"
AGENTS_DIR="${HOME}/Library/LaunchAgents"
PLIST="${AGENTS_DIR}/${LABEL}.plist"
LOG_FILE="${HOME}/Library/Logs/${LABEL}.log"

# launchd resolves nothing for you: an absolute path or nothing works.
BUN="$(command -v bun || true)"
if [[ -z "${BUN}" ]]; then
  echo "error: bun is not on PATH. Install it, or edit BUN in this script." >&2
  exit 1
fi

if [[ ! -f "${TEMPLATE}" ]]; then
  echo "error: template not found at ${TEMPLATE}" >&2
  exit 1
fi

# Gitignored on purpose — its `repos` entries name private checkout directories
# and this monorepo is public (ADR 008) — so a fresh clone genuinely has none.
if [[ ! -f "${COLLECTOR_DIR}/collector.config.json" ]]; then
  echo "error: no collector.config.json in ${COLLECTOR_DIR}" >&2
  echo "       it is gitignored; start from the committed template:" >&2
  echo "       cp ${COLLECTOR_DIR}/collector.config.example.json ${COLLECTOR_DIR}/collector.config.json" >&2
  exit 1
fi

# Strip the leading zero a human would type ("07") before launchd sees it: the
# plist wants an <integer>, and "07" is not one.
HOUR=$((10#${HOUR}))
MINUTE=$((10#${MINUTE}))

mkdir -p "${AGENTS_DIR}" "$(dirname "${LOG_FILE}")"

sed \
  -e "s|{{BUN}}|${BUN}|g" \
  -e "s|{{COLLECTOR_DIR}}|${COLLECTOR_DIR}|g" \
  -e "s|{{LOG_FILE}}|${LOG_FILE}|g" \
  -e "s|{{HOUR}}|${HOUR}|g" \
  -e "s|{{MINUTE}}|${MINUTE}|g" \
  "${TEMPLATE}" > "${PLIST}"

# Fails the install rather than letting launchd reject a malformed plist later
# with a message that mentions neither the file nor the reason.
plutil -lint "${PLIST}" > /dev/null

# `bootout` before `bootstrap` is the modern replacement for unload/load, and the
# `|| true` covers the first install, where there is nothing to boot out.
launchctl bootout "gui/$(id -u)/${LABEL}" 2>/dev/null || true
launchctl bootstrap "gui/$(id -u)" "${PLIST}"
launchctl enable "gui/$(id -u)/${LABEL}"

printf '\n  Installed %s\n' "${LABEL}"
printf '    plist    %s\n' "${PLIST}"
printf '    runs     daily at %02d:%02d local\n' "${HOUR}" "${MINUTE}"
printf '    log      %s\n' "${LOG_FILE}"
printf '    command  %s run %s/collector.ts --push --quiet\n\n' "${BUN}" "${COLLECTOR_DIR}"

printf '  Run it once now:   launchctl kickstart -k gui/%s/%s\n' "$(id -u)" "${LABEL}"
printf '  Watch the log:     tail -f %s\n' "${LOG_FILE}"
printf '  Remove it:         %s/uninstall.sh\n\n' "${SCRIPT_DIR}"

if [[ -z "${COLLECTOR_INGEST_TOKEN:-}" && ! -s "${HOME}/.config/home-collector/token" ]]; then
  printf '  WARNING: no ingest token found. The job will run and refuse to push.\n'
  printf '           See README.md, "Issuing a token".\n\n'
fi
