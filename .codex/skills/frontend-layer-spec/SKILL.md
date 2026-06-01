---
name: frontend-layer-spec
description: "Trigger: React, Vite, TypeScript, Tailwind, frontend architecture. Generate frontend documentation fragments."
license: Apache-2.0
metadata:
  author: gentleman-programming
  version: "1.0"
---

## Activation Contract
Use this skill when a requirement changes frontend routes, screens, components, API clients, or UI states.

## Hard Rules
- Use React + Vite + TypeScript + Tailwind only when selected by the user/project.
- Separate container/state logic from presentational components.
- Document loading, empty, error, success, and permission-denied states.
- Include accessibility expectations.

## Decision Gates
| Need | Rule |
|---|---|
| Server data | Dedicated API client/hook boundary |
| Reusable visual unit | Presentational component |
| Business flow | Container/page component |

## Execution Steps
1. Identify routes/screens affected.
2. Define component boundaries.
3. Map API client calls to backend contracts.
4. Document validations and UI states.

## Output Contract
Return Markdown section `## Frontend` or `## Frontend: No impact`.

## References
- `assets/frontend-template.md`
