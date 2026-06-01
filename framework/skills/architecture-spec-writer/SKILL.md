---
name: architecture-spec-writer
description: "Trigger: architecture specification, service design document, software specification. Compose final Markdown architecture specs."
license: Apache-2.0
metadata:
  author: gentleman-programming
  version: "1.0"
---

## Activation Contract
Use this skill when composing the final architecture/software specification from subagent fragments.

## Hard Rules
- Use the canonical template in `assets/service-specification.md`.
- Preserve fragment intent; do not invent missing evidence.
- Mark unknowns as `TBD` with an owner or follow-up.
- Keep each section concise and reviewable.
- Include AWS only when justified against VPS/open-source alternatives.

## Decision Gates
| Situation | Action |
|---|---|
| Missing fragment | Add section with `TBD` and reason |
| Conflicting fragments | Prefer evidence-backed claim and list conflict |
| Security-sensitive data | Document controls, not secrets |

## Execution Steps
1. Normalize change name and output path.
2. Merge fragments into the template order.
3. Ensure APIs, Events, Data, Security, Config, Observability, and Runbook are present.
4. Add assumptions, risks, and verification checklist.
5. Save final Markdown under `docs/architecture/requirements/<change-name>/specification.md`.

## Output Contract
Return final file path, sections completed, unresolved TBDs, and verification checklist.

## References
- `assets/service-specification.md`
