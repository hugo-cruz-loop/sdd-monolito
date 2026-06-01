---
name: runtime-observability-spec
description: "Trigger: runtime profile, VPS, AWS decision, observability, SRE, runbook. Generate ops fragments."
license: Apache-2.0
metadata:
  author: gentleman-programming
  version: "1.0"
---

## Activation Contract
Use this skill for runtime nature, deployment, configuration, observability, AWS/VPS decisions, and runbook fragments.

## Hard Rules
- Default to VPS/open-source operations unless AWS has a clear reason.
- Classify workload as I/O-bound, CPU-bound, memory-bound, or mixed.
- Include logs, metrics, traces, health checks, alerts, and dashboard placeholders.
- Do not overprovision CPU for I/O-bound services.

## Decision Gates
| Need | Candidate |
|---|---|
| Object storage | S3 or MinIO |
| Managed PostgreSQL | RDS if ops burden justifies cost |
| Queues | SQS/SNS/EventBridge or Redis/RabbitMQ/NATS |
| Secrets | AWS Secrets Manager or VPS secret manager |

## Execution Steps
1. Classify workload and resource profile.
2. Define env vars and config management.
3. Decide VPS vs AWS services with tradeoffs.
4. Produce observability and runbook fragment.

## Output Contract
Return `## Configuración`, `### Perfil de Recursos`, `## Observabilidad`, and `## Runbook` fragment.

## References
- `assets/runtime-template.md`
