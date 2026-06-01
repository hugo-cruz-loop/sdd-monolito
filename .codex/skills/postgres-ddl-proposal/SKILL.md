---
name: postgres-ddl-proposal
description: "Trigger: PostgreSQL DDL, tables, indexes, functions, schema proposal. Generate database design fragments."
license: Apache-2.0
metadata:
  author: gentleman-programming
  version: "1.0"
---

## Activation Contract
Use this skill when a requirement needs new or changed PostgreSQL tables, indexes, constraints, functions, or data ownership notes.

## Hard Rules
- Read existing schema context supplied by the orchestrator before proposing DDL.
- Prefer explicit primary keys, foreign keys, unique constraints, check constraints, and timestamp columns.
- Use indexes only for known access patterns; explain each one.
- Avoid triggers/functions unless they protect consistency or simplify atomic behavior.
- Never claim a table exists unless context proves it.

## Decision Gates
| Need | Rule |
|---|---|
| Transactional source of truth | PostgreSQL |
| Ephemeral/cache data | Redis, not PostgreSQL |
| Flexible document payload | MongoDB only with justification |

## Execution Steps
1. Identify entity ownership and lifecycle.
2. Map relationships to existing tables from context.
3. Generate proposed DDL and index rationale.
4. Add migration, rollback, consistency, and retention notes.
5. Return Markdown only.

## Output Contract
Return `## Datos` with storage ownership, proposed DDL SQL block, index rationale, migration notes, risks, and assumptions.

## References
- `assets/postgres-ddl-template.md`
