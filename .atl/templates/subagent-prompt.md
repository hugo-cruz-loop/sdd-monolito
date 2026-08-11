# Subagent Task: {task_name}

## Project Standards (auto-resolved)
{compact skill rules injected by orchestrator}

## Requirement Brief
{requirement_summary}

## Relevant Engram Context
{context_from_mem_search}

## Task
{specific bounded task}

## Persistence Contract
If you make important discoveries, decisions, or bug fixes, save them to Engram via `mem_save` with project: `{project}` before returning.

## Code Quality Contract
When this task generates or modifies production code, apply the SOLID quality gate: SRP, OCP, LSP, ISP, and DIP. Return a `## SOLID Review` section with evidence and final gate result.

## Output
Return Markdown only using the assigned output contract. Do not modify code unless explicitly asked.
