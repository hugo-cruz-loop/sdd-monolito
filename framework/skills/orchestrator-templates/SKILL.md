---
name: orchestrator-templates
description: "Trigger: skill registry, compact rules, subagent prompt, delegation template. Canonical templates the orchestrator uses to resolve skills and brief subagents."
license: Apache-2.0
metadata:
  author: gentleman-programming
  version: "1.0"
---

## Activation Contract

Use this skill when the orchestrator needs to resolve which skills apply to a
request, or to brief a subagent.

These are templates the orchestrator reads, not domain skills. They live here
because a skill directory is what every runtime already links into place; a
`templates/` directory of their own would only exist in the source repository,
which is where the previous version pointed and why the reference was broken.

## Assets

| File | What it is |
|---|---|
| `assets/skill-registry.md` | Trigger table and compact rules, injected into subagent prompts |
| `assets/subagent-prompt.md` | The delegation template |

## Hard Rules

- Read the registry once per session and cache the compact rules.
- Inject only the rules that match the request; a subagent that receives every
  rule receives none of them with any weight.
- Subagents never read the registry themselves. They get pre-resolved rules
  under `## Project Standards (auto-resolved)`.
