#!/usr/bin/env bash
set -euo pipefail

SOURCE_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
TARGET_DIR="$(pwd)"

ask_csv() {
  local prompt="$1"
  local default="$2"
  local value
  read -r -p "$prompt [$default]: " value
  echo "${value:-$default}"
}

contains() {
  case ",$1," in *",$2,"*) return 0;; *) return 1;; esac
}

TOOLS="$(ask_csv 'Install for tools (codex,claude,antigravity,all)' 'all')"
STACK="$(ask_csv 'Selected stack (go,python,rust,react,postgres,redis,mongodb,all)' 'all')"

mkdir -p "$TARGET_DIR/docs/architecture/requirements" "$TARGET_DIR/docs/architecture/runbooks"
mkdir -p "$TARGET_DIR/.atl/agents/subagents" "$TARGET_DIR/.atl/templates"
cp -R "$SOURCE_DIR/framework/agents/"* "$TARGET_DIR/.atl/agents/"
cp -R "$SOURCE_DIR/framework/templates/"* "$TARGET_DIR/.atl/templates/"

install_skills_dir() {
  local dest="$1"
  mkdir -p "$dest"
  for skill_dir in "$SOURCE_DIR/framework/skills"/*; do
    local name
    name="$(basename "$skill_dir")"
    case "$name" in
      postgres-ddl-proposal)
        contains "$STACK" all || contains "$STACK" postgres || continue ;;
      frontend-layer-spec)
        contains "$STACK" all || contains "$STACK" react || contains "$STACK" typescript || continue ;;
      *) ;;
    esac
    rm -rf "$dest/$name"
    mkdir -p "$dest/$name"
    cp -R "$skill_dir/"* "$dest/$name/"
  done
}

install_codex() {
  mkdir -p "$TARGET_DIR/.codex/skills"
  install_skills_dir "$TARGET_DIR/.codex/skills"
  cat > "$TARGET_DIR/AGENTS.md" <<'EOF'
# Project Architecture Documentation Agent

Use `.atl/agents/orchestrator.md` as the architecture documentation orchestrator.
Use `.atl/templates/service-specification.md` as the canonical final specification template.
Resolve compact rules from `.atl/templates/skill-registry.md` and inject them into subagent prompts as `## Project Standards (auto-resolved)`.

Do not add AI attribution to commits. Keep generated documentation in `docs/architecture/`.
EOF
}

install_claude() {
  mkdir -p "$TARGET_DIR/.claude/agents" "$TARGET_DIR/.claude/skills"
  install_skills_dir "$TARGET_DIR/.claude/skills"
  cp "$SOURCE_DIR/framework/agents/orchestrator.md" "$TARGET_DIR/.claude/agents/architecture-documentation-orchestrator.md"
  for f in "$SOURCE_DIR/framework/agents/subagents"/*.md; do cp "$f" "$TARGET_DIR/.claude/agents/$(basename "$f")"; done
  cat > "$TARGET_DIR/CLAUDE.md" <<'EOF'
# Project Architecture Documentation Agent

Use `.claude/agents/architecture-documentation-orchestrator.md` for documentation orchestration.
Use project-local skills under `.claude/skills/` only. Keep final specs in `docs/architecture/requirements/<change-name>/specification.md`.
EOF
}

install_antigravity() {
  mkdir -p "$TARGET_DIR/.agent/agents" "$TARGET_DIR/.agent/skills"
  install_skills_dir "$TARGET_DIR/.agent/skills"
  cp -R "$SOURCE_DIR/framework/agents/"* "$TARGET_DIR/.agent/agents/"
  cat > "$TARGET_DIR/AGENTS.md" <<'EOF'
# Project Architecture Documentation Agent

For Antigravity, use project-local `.agent/agents/orchestrator.md` and `.agent/skills/`.
Keep final specifications in `docs/architecture/requirements/<change-name>/specification.md`.
EOF
}

if contains "$TOOLS" all || contains "$TOOLS" codex; then install_codex; fi
if contains "$TOOLS" all || contains "$TOOLS" claude; then install_claude; fi
if contains "$TOOLS" all || contains "$TOOLS" antigravity; then install_antigravity; fi

cp "$SOURCE_DIR/framework/templates/service-specification.md" "$TARGET_DIR/docs/architecture/service-specification.template.md"
[ -f "$TARGET_DIR/docs/architecture/runbooks/system-runbook.md" ] || cat > "$TARGET_DIR/docs/architecture/runbooks/system-runbook.md" <<'EOF'
# System Runbook

## Despliegue
TBD

## Troubleshooting
TBD

## Contacto
TBD
EOF

echo "Installed local architecture documentation framework in: $TARGET_DIR"
echo "Tools: $TOOLS"
echo "Stack: $STACK"
