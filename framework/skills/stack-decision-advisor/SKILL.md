---
name: stack-decision-advisor
description: "Trigger: stack selection, language choice, framework choice, VPS versus AWS. Recommend technology with tradeoffs."
license: Apache-2.0
metadata:
  author: gentleman-programming
  version: "1.0"
---

## Activation Contract
Use this skill when selecting language, framework, database, cache, messaging, frontend, or AWS/VPS tools for a requirement.

## Hard Rules
- Use only project-supported stack unless user approves expansion: Go, Python, Rust, React, Vite, TypeScript, ESLint, Tailwind, PostgreSQL, Redis, MongoDB.
- Explain fit based on workload, team maintainability, deployment, and risk.
- Prefer boring technology when it satisfies the requirement.

## Decision Gates
| Workload | Default recommendation |
|---|---|
| REST CRUD/high concurrency I/O | Go |
| Data/automation/ML-heavy backend | Python |
| Low-level performance/safety-critical | Rust |
| Browser UI | React + Vite + TypeScript + Tailwind |
| Transactional data | PostgreSQL |
| Cache/ephemeral coordination | Redis |

## Execution Steps
1. Classify requirement and runtime nature.
2. Compare viable stack choices briefly.
3. Recommend one and document tradeoffs.
4. Include AWS only if it improves reliability/security/ops enough to justify cost.

## Output Contract
Return Markdown subsection `### Stack tecnológico` with decision table and rationale.

## References
- `assets/stack-decision-template.md`
