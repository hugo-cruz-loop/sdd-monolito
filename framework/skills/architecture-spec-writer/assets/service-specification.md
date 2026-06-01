# {Service or Requirement Name}

## Propósito
{1-2 lines describing the exact problem solved.}

## Responsabilidades
- **Funcionalidad principal:** {business processes/tasks.}
- **Dominio:** {data owned as Source of Truth.}

## Fuera de alcance
- {Explicit boundary to prevent coupling.}

## Stack tecnológico
| Layer | Selection | Why | Tradeoff |
|---|---|---|---|
| Backend | {Go/Python/Rust/TBD} | {reason} | {tradeoff} |
| Frontend | {React/Vite/TypeScript/Tailwind/TBD} | {reason} | {tradeoff} |
| Data | {PostgreSQL/Redis/MongoDB/TBD} | {reason} | {tradeoff} |
| Infra | {VPS/AWS/Open-source tool} | {reason} | {tradeoff} |

## APIs
| Method | Path | Purpose | Auth | Request | Response | Errors |
|---|---|---|---|---|---|---|
| TBD | TBD | TBD | TBD | TBD | TBD | TBD |

**Contratos:** `{link-to-openapi}`

## Eventos
### Publica
| Event | When | Payload summary | Consumers | Delivery |
|---|---|---|---|---|

### Consume
| Event | Source | Purpose | Failure handling |
|---|---|---|---|

## Flujos Principales (Gherkin)
```gherkin
Feature: {business capability}

  Scenario: {happy path}
    Given {precondition}
    When {action}
    Then {expected result}
```

## Datos
### Almacenamiento
{database and logical schema.}

### Estrategia
{retention, backups, consistency.}

### DDL propuesto
```sql
-- proposed migration SQL
```

## Dependencias
### Servicios externos
- {service/API and reason}

### Infraestructura
- {queue/bucket/cache/etc.}

## Seguridad
- **Autenticación:** {JWT/OAuth2/etc.}
- **Autorización:** {roles/permissions.}
- **Protección de datos:** {encryption/masking/retention if needed.}
- **Auditoría:** {events/logs required for traceability.}

## Configuración
| Variable | Default | Required | Description |
|---|---:|---|---|
| PORT | 8080 | yes | HTTP port |

### Perfil de Recursos
- **Naturaleza:** {I/O-bound | CPU-bound | Memory-bound | Mixed}
- **Concurrencia:** {event loop/goroutines/workers/threads}
- **Módulo:** {service/module name}
- **Notas:** {CPU/memory/autoscaling guidance}

## Observabilidad
- **Métricas:** {dashboard/link placeholder}
- **Trazas:** {Jaeger/Tempo/Datadog/etc.}
- **Logs:** {location and structured fields}
- **Health checks:** {readiness/liveness}

## Errores conocidos
- {Known issue / limitation / accepted failure mode}

## Runbook
> Mantener un runbook global en `docs/architecture/runbooks/system-runbook.md`; aquí solo enlazar o agregar fragmentos específicos.

- **Despliegue:** {pipeline/commands}
- **Troubleshooting:** {health check/restart/diagnostics}
- **Contacto:** {team channel/on-call}

## Assumptions
- {Assumption}

## Verification Checklist
- [ ] APIs have OpenAPI contract placeholder.
- [ ] Data ownership and DDL are explicit.
- [ ] Authn/authz are explicit.
- [ ] Observability is actionable.
- [ ] AWS usage is justified or explicitly not needed.
