#!/usr/bin/env bash
# Install this framework into a project, through harness-install.
#
# This script used to do the installing itself. It no longer does, and the
# reason is not tidiness:
#
#   * It wrote CLAUDE.md and AGENTS.md with `cat >`, destroying whatever the
#     project already had in them.
#   * With tools=all it wrote AGENTS.md twice — codex first, antigravity
#     second — so codex's instructions were silently lost every time.
#   * It was interactive, so it could not run unattended.
#   * A crash mid-install left a tree nobody could describe: no journal, no
#     lockfile, nothing to roll back to.
#
# harness-install fixes all four by construction: fenced blocks instead of
# overwrites, a plan that refuses colliding writes, flags instead of prompts,
# and a journal that survives a power cut.
#
# What this script still owns is the part that is not installation: seeding the
# docs/architecture tree the framework writes into.
#
# Usage:
#   scripts/install.sh [target-dir] [extra harness-install flags...]
#
#   scripts/install.sh .
#   scripts/install.sh . --runtime claude --dry-run
#   scripts/install.sh /srv/app --runtime claude,codex --mode copy

set -euo pipefail

SOURCE_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
TARGET_DIR="${1:-$(pwd)}"
if [ "$#" -gt 0 ]; then shift; fi
TARGET_DIR="$(cd "$TARGET_DIR" && pwd)"

if ! command -v harness-install >/dev/null 2>&1; then
  cat >&2 <<'MSG'
harness-install is not on PATH.

  git clone git@github.com:hugo-cruz-loop/harness-install.git
  cd harness-install && npm install && npm run build && npm link

Refusing to fall back to the old copy-and-overwrite installer: it destroyed
CLAUDE.md and AGENTS.md content, and a fallback nobody notices is worse than a
missing dependency somebody fixes.
MSG
  exit 2
fi

mkdir -p "$TARGET_DIR/docs/architecture/requirements" \
         "$TARGET_DIR/docs/architecture/runbooks"

RUNBOOK="$TARGET_DIR/docs/architecture/runbooks/system-runbook.md"
if [ ! -f "$RUNBOOK" ]; then
  cat > "$RUNBOOK" <<'MSG'
# System Runbook

## Despliegue
TBD

## Troubleshooting
TBD

## Contacto
TBD
MSG
fi

exec harness-install install \
  --source "file://${SOURCE_DIR}/framework" \
  --target "$TARGET_DIR" \
  --package sdd-monolito \
  "$@"
