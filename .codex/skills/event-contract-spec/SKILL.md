---
name: event-contract-spec
description: "Trigger: domain events, publishes, consumes, event-driven architecture. Generate event contract fragments."
license: Apache-2.0
metadata:
  author: gentleman-programming
  version: "1.0"
---

## Activation Contract
Use this skill when a requirement publishes or consumes domain events.

## Hard Rules
- Name events as past-tense facts: `EntityActioned`.
- Document producer, consumers, payload summary, delivery semantics, retry, and dead-letter behavior.
- Avoid events when direct REST is simpler and sufficient; state the tradeoff.

## Decision Gates
| Need | Rule |
|---|---|
| Cross-service eventual consistency | Event may fit |
| Immediate user response dependency | Prefer synchronous REST |
| Audit trail | Event or audit log must be explicit |

## Execution Steps
1. Identify state changes worth publishing.
2. Identify external facts consumed.
3. Define payload and operational semantics.
4. Return concise Markdown.

## Output Contract
Return Markdown section `## Eventos`.

## References
- `assets/event-contract-template.md`
