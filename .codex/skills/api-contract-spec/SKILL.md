---
name: api-contract-spec
description: "Trigger: REST API, endpoint, OpenAPI, JSON request response contract. Generate API contract fragments."
license: Apache-2.0
metadata:
  author: gentleman-programming
  version: "1.0"
---

## Activation Contract
Use this skill when documenting REST endpoints or API contracts.

## Hard Rules
- API-first: every endpoint must be contractable in OpenAPI.
- Include method, path, purpose, auth, path params, query params, headers, JSON request body, JSON response body, errors, examples, idempotency, and pagination when relevant.
- Every endpoint MUST include schema-style tables for input and output JSON fields.
- Every endpoint MUST include at least one request JSON example when it accepts a body.
- Every endpoint MUST include at least one success response JSON example.
- Every endpoint MUST include error response JSON examples for relevant 4xx/5xx cases.
- Use `/api/v1` unless project context says otherwise.
- Do not define persistence details here.

## Decision Gates
| Situation | Action |
|---|---|
| State-changing retryable operation | Include idempotency key |
| Collection endpoint | Define pagination/filter/sort query params and response envelope |
| Sensitive operation | Require auth and audit notes |
| No request body | State `Request body: none` explicitly |
| No response body | State status code and `Response body: none` explicitly |

## Execution Steps
1. Identify resources and commands.
2. Create endpoint table.
3. Define path/query/header parameters.
4. Define request JSON schema and example.
5. Define response JSON schemas and examples by status code.
6. Define common error model and OpenAPI link placeholder.

## Output Contract
Return Markdown section `## APIs` using `assets/api-contract-template.md`.

## References
- `assets/api-contract-template.md`
