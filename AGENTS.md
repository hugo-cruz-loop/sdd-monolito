# Project Architecture Documentation Agent

Use `.atl/agents/orchestrator.md` as the architecture documentation orchestrator.
Use `.atl/templates/service-specification.md` as the canonical final specification template.
Resolve compact rules from `.atl/templates/skill-registry.md` and inject them into subagent prompts as `## Project Standards (auto-resolved)`.
When code is generated or modified, apply the `solid-code-design-guard` skill as a quality gate for SRP, OCP, LSP, ISP, and DIP.

Do not add AI attribution to commits. Keep generated documentation in `docs/architecture/`.
