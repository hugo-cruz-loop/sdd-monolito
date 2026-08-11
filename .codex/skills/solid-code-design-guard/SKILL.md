---
name: solid-code-design-guard
description: "Trigger: SOLID, code generation, code review, clean architecture. Validate generated code against SOLID principles."
license: Apache-2.0
metadata:
  author: gentleman-programming
  version: "1.0"
---

## Activation Contract
Use this skill when an agent generates, modifies, or reviews production code. It is a quality gate, not optional style advice.

## Hard Rules
- Validate SRP, OCP, LSP, ISP, and DIP before returning code work.
- Prefer small use cases/services with one business reason to change.
- Depend on abstractions at boundaries: repositories, external APIs, message buses, clocks, IDs, and config.
- Do not create generic interfaces without a real consumer; abstractions must protect boundaries.
- Do not hide business rules inside controllers, UI components, SQL migrations, or infrastructure adapters.
- If a principle is intentionally violated, document the tradeoff and risk.

## Decision Gates
| Principle | Pass condition | Common failure |
|---|---|---|
| SRP | Module/function has one reason to change | God service/controller doing validation, persistence, orchestration, and formatting |
| OCP | New behavior can be added by extension or composition | Switch/if chains that must change for every new type |
| LSP | Implementations honor the same contract and error semantics | Subtype panics, ignores inputs, or weakens guarantees |
| ISP | Consumers depend only on methods they use | Fat interfaces shared by unrelated use cases |
| DIP | Core/domain depends on ports, not infrastructure | Domain imports DB, HTTP, framework, or vendor SDK |

## Execution Steps
1. Identify the code boundaries: domain, application/use case, interface/port, adapter, transport/UI.
2. Check each SOLID principle using the decision gates.
3. Fix violations when the task includes implementation authority.
4. If reviewing only, return required fixes without modifying code.
5. Produce the SOLID review table from `assets/solid-review-template.md`.

## Output Contract
Return a `## SOLID Review` section with status, evidence, required fixes, and final gate result: `pass`, `pass-with-warnings`, or `fail`.

## References
- `assets/solid-review-template.md`
