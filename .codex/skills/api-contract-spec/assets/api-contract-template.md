# API Contract Template

Use this structure for each endpoint.

## APIs

| Method | Path | Purpose | Auth | Idempotency | OpenAPI OperationId |
|---|---|---|---|---|---|
| `{METHOD}` | `{PATH}` | {purpose} | {JWT/OAuth2/None} | {required/not required} | `{operationId}` |

### `{METHOD} {PATH}`

**Purpose:** {what the endpoint does}

**Path parameters**
| Name | Type | Required | Description |
|---|---|---:|---|
| `{id}` | `uuid` | yes | Resource identifier |

**Query parameters**
| Name | Type | Required | Default | Description |
|---|---|---:|---|---|
| `page` | `integer` | no | `1` | Page number for collection endpoints |

**Headers**
| Name | Required | Description |
|---|---:|---|
| `Authorization` | yes | `Bearer <token>` |
| `Idempotency-Key` | when needed | Required for retry-safe commands |

**Request body**

If there is no body, write: `Request body: none`.

```json
{
  "field": "value"
}
```

| Field | Type | Required | Validation | Description |
|---|---|---:|---|---|
| `field` | `string` | yes | `min=1,max=120` | Business meaning |

**Success responses**

`201 Created`
```json
{
  "data": {
    "id": "uuid",
    "status": "created"
  },
  "meta": {
    "requestId": "uuid"
  }
}
```

| Field | Type | Required | Description |
|---|---|---:|---|
| `data.id` | `uuid` | yes | Created resource identifier |
| `data.status` | `string` | yes | Current resource status |
| `meta.requestId` | `uuid` | yes | Traceable request id |

**Error responses**

`400 Bad Request`
```json
{
  "error": {
    "code": "VALIDATION_ERROR",
    "message": "Invalid request payload",
    "details": [
      {
        "field": "field",
        "reason": "must not be empty"
      }
    ]
  },
  "meta": {
    "requestId": "uuid"
  }
}
```

| Code | HTTP | When | Notes |
|---|---:|---|---|
| `VALIDATION_ERROR` | 400 | Payload does not satisfy validation rules | Include field-level details |
| `UNAUTHORIZED` | 401 | Missing or invalid token | Do not reveal sensitive details |
| `FORBIDDEN` | 403 | Authenticated user lacks permission | Must be audited if sensitive |
| `NOT_FOUND` | 404 | Resource does not exist or is not visible | Avoid leaking ownership |
| `CONFLICT` | 409 | Business conflict or duplicate command | Include safe conflict code |
| `INTERNAL_ERROR` | 500 | Unexpected server failure | Log with request id |

**OpenAPI placeholder**

- Spec file: `{repo-path}/openapi/{service}.yaml`
- OperationId: `{operationId}`
