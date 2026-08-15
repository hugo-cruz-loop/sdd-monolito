# Architecture Documentation Skill Registry

## Compact Rules

### architecture-spec-writer
Compose final specs with the canonical service template. Mark unknowns as TBD. Do not invent evidence.

### postgres-ddl-proposal
Generate PostgreSQL DDL from known schema context. Explain ownership, constraints, indexes, migration, rollback, and assumptions.

### api-contract-spec
Document REST endpoints with method, path, auth, path/query/header params, JSON request body schema, JSON response schemas, examples, errors, and OpenAPI placeholder.

### event-contract-spec
Document event names, producer, consumers, payload, delivery, retries, and dead-letter handling. Avoid events when REST is enough.

### security-architecture-spec
Apply Zero Trust, least privilege, authn/authz separation, data protection, secrets, auditability, and abuse cases.

### runtime-observability-spec
Default VPS/open-source. Include AWS only with tradeoff. Document workload nature, config, logs, metrics, traces, health checks.

### frontend-layer-spec
Document React/Vite/TypeScript/Tailwind routes, components, API clients, UI states, validations, and accessibility.

### stack-decision-advisor
Select stack by workload, maintainability, deployment, and risk. Prefer boring tech that satisfies the requirement.

## User Skills Trigger Table
| Skill | Trigger |
|---|---|
| architecture-spec-writer | final specification, SDD document |
| postgres-ddl-proposal | tables, indexes, DDL, PostgreSQL |
| api-contract-spec | REST, OpenAPI, endpoint |
| event-contract-spec | events, event-driven |
| security-architecture-spec | security, auth, Zero Trust, fintech |
| runtime-observability-spec | runtime, VPS, AWS, observability, runbook |
| frontend-layer-spec | React, Vite, TypeScript, Tailwind, frontend |
| stack-decision-advisor | stack, language, framework, AWS decision |
