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

### API Contracts

#### `{METHOD} {PATH}`

**Purpose:** {what this endpoint does}

**Path parameters**
| Name | Type | Required | Description |
|---|---|---:|---|

**Query parameters**
| Name | Type | Required | Default | Description |
|---|---|---:|---|---|

**Headers**
| Name | Required | Description |
|---|---:|---|
| Authorization | yes | Bearer token |

**Request body**
```json
{
  "example": "value"
}
```

| Field | Type | Required | Validation | Description |
|---|---|---:|---|---|

**Success responses**

`200 OK`
```json
{
  "data": {}
}
```

| Field | Type | Required | Description |
|---|---|---:|---|

**Error responses**

`400 Bad Request`
```json
{
  "error": {
    "code": "VALIDATION_ERROR",
    "message": "Invalid request payload",
    "details": []
  }
}
```

| Code | HTTP | When | Body |
|---|---:|---|---|

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
- [ ] Every API has path/query/header params documented.
- [ ] Every API has request/response JSON schema and examples.
- [ ] Data ownership and DDL are explicit.
- [ ] Authn/authz are explicit.
- [ ] Observability is actionable.
- [ ] AWS usage is justified or explicitly not needed.
