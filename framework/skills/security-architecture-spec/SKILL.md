---
name: security-architecture-spec
description: "Trigger: secure architecture, Zero Trust, auth, authorization, fintech security. Generate security fragments."
license: Apache-2.0
metadata:
  author: gentleman-programming
  version: "1.0"
---

## Activation Contract
Use this skill for authentication, authorization, data protection, secrets, auditability, and abuse-case documentation.

## Hard Rules
- Apply least privilege and deny-by-default.
- Distinguish authentication from authorization.
- Document data classification and protection only when relevant.
- Never include real secrets.
- For fintech-like flows, include auditability and traceability.

## Decision Gates
| Area | Required check |
|---|---|
| Authenticated API | token type, validation, expiry |
| Role-sensitive action | permission matrix |
| Personal/financial data | encryption, masking, retention |
| External calls | timeout, retry, trust boundary |

## Execution Steps
1. Identify actors and trust boundaries.
2. Define authn/authz controls.
3. Define data and secret controls.
4. Add audit logs and known abuse cases.

## Output Contract
Return Markdown section `## Seguridad` and security known issues if any.

## References
- `assets/security-template.md`
