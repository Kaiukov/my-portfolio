# FastAPI API Method Analysis (GET / POST / PUT / PATCH / DELETE)

This document provides the API equivalent of the CLI analysis, with suggested RESTful endpoints for a FastAPI implementation of this portfolio tracker.

## Scope and assumptions

- Existing project logic is currently exposed as a CLI (`portfolio_db/cli.py`).
- There is no FastAPI app yet in this repository.
- Recommendations below map current command capabilities to HTTP resources and methods.
- Response shape should remain JSON-first and machine-friendly (similar to current CLI success/error envelopes).

---

## Resource model (proposed)

Primary resources:

- `transactions`
- `returns` (daily returns report)
- `portfolio` (status/summary/allocation/performance views)
- `prices` (price verification and diagnostics)
- `fx` (optional exchange-rate visibility)

---

## Method-by-method recommendations

## GET (read operations)

Use `GET` for all read-only endpoints.

### Suggested GET endpoints

1. `GET /health`
   - Purpose: service availability and basic metadata.
   - Returns: status, timestamp, version.

2. `GET /portfolio/status`
   - Maps from CLI `status`.
   - Returns: transaction count, date range, invested value, gain/loss metrics.

3. `GET /portfolio/returns`
   - Maps from CLI `report`.
   - Query params: `limit`, `offset`, `start_date`, `end_date`.
   - Returns: paginated daily returns.

4. `GET /transactions`
   - Maps from CLI `transactions`.
   - Query params: `limit`, `offset`, `start_date`, `end_date`.
   - Returns: paginated transaction list.

5. `GET /transactions/{transaction_id}`
   - Returns single transaction details.

6. `GET /portfolio/allocation`
   - Maps from CLI `allocation`.
   - Query param: `type=assets|cash|all`.

7. `GET /portfolio/cash`
   - Maps from CLI `cash`.
   - Returns balances + USD conversion + FX warning metadata when fallback is used.

8. `GET /portfolio/performance`
   - Maps from CLI `performance`.
   - Returns return/risk/drawdown/concentration metrics.

9. `GET /portfolio/summary`
   - Maps from CLI `summary`.
   - Query param: `filter=open|all`.

10. `GET /prices/verify`
    - Maps from CLI `verify_prices`.
    - Returns diagnostics about stored price data.

---

## POST (create and action operations)

Use `POST` when creating new resources or triggering non-idempotent actions.

### Suggested POST endpoints

1. `POST /transactions`
   - Maps from CLI `add`.
   - Body fields:
     - `date`, `asset`, `action`, `quantity`, `price`, `currency`, `fees`, `exchange`
   - Behavior:
     - inserts transaction
     - auto-triggers recalculation
   - Returns created transaction and recalculation summary.

2. `POST /transactions/exchange`
   - Maps from CLI `exchange`.
   - Body fields:
     - `date`, `from_asset`, `to_asset`, `quantity`, `rate`
   - Returns paired transaction IDs and conversion details.

3. `POST /portfolio/recalculate`
   - Maps from CLI `recalculate`.
   - Body fields:
     - `force` (bool), `from_date` (optional)
   - Recommended because this is an action, not a resource replacement.

4. `POST /migrations/transactions`
   - Maps from CLI `migrate`.
   - Body fields:
     - `csv_path` (or upload file)
   - Returns rows imported and source metadata.

---

## PUT (full replace operations)

Use `PUT` only when replacing an entire resource representation.

### Suggested PUT endpoints

1. `PUT /transactions/{transaction_id}`
   - Replaces all mutable transaction fields in one request.
   - Requires full object in body.
   - Recalculation should run after update.

> If full replace semantics are not needed, skip `PUT` and prefer `PATCH` only.

---

## PATCH (partial updates)

Use `PATCH` for targeted updates.

### Suggested PATCH endpoints

1. `PATCH /transactions/{transaction_id}`
   - Allows partial field updates (e.g., `fees`, `price`, `exchange`).
   - Recalculates returns after successful update.

2. `PATCH /portfolio/settings` (optional future)
   - For runtime preferences (base currency, precision, reporting defaults).

---

## DELETE (remove operations)

Use `DELETE` for resource deletion.

### Suggested DELETE endpoints

1. `DELETE /transactions/{transaction_id}`
   - Maps from CLI `delete`.
   - Behavior:
     - delete transaction
     - auto-recalculate returns
   - Safety recommendation:
     - require explicit query flag (`confirm=true`) or idempotency key if needed for production controls.

---

## Request/response contract recommendations

## 1) Consistent envelope (best-practice version)

Use one envelope for successful responses and an RFC7807-compatible structure for failures.

### Success envelope

```json
{
  "success": true,
  "data": [],
  "meta": {
    "request_id": "8b34c2f0-3e68-4c95-95b7-2bb49f6fef9b",
    "timestamp": "2026-03-07T10:40:00Z",
    "operation": "transactions.list",
    "pagination": {
      "limit": 50,
      "offset": 0,
      "total": 0,
      "has_next": false
    },
    "warnings": []
  }
}
```

### Error envelope (RFC7807 style)

```json
{
  "success": false,
  "error": {
    "type": "https://api.example.com/errors/validation-error",
    "title": "Validation error",
    "status": 400,
    "code": "VALIDATION_ERROR",
    "detail": "date must be YYYY-MM-DD",
    "instance": "/transactions",
    "fields": [
      {
        "name": "date",
        "reason": "invalid_format",
        "message": "Expected YYYY-MM-DD"
      }
    ]
  },
  "meta": {
    "request_id": "8b34c2f0-3e68-4c95-95b7-2bb49f6fef9b",
    "timestamp": "2026-03-07T10:40:00Z",
    "operation": "transactions.create"
  }
}
```

### Envelope rules

- Keep `data` absent on errors (or `null` only if your API standard requires it).
- Always include `request_id` for tracing across logs and clients.
- Keep `operation` stable and machine-readable (`transactions.list`, `portfolio.recalculate`).
- Put non-fatal issues in `meta.warnings` instead of failing the request.
- Use the same envelope for all methods (GET/POST/PUT/PATCH/DELETE) to reduce client branching.

## 2) Date format standardization

Prefer ISO `YYYY-MM-DD` for all API inputs/outputs.

This avoids the mixed-date behavior currently present in CLI commands.

## 3) Pagination

For list endpoints:

- inputs: `limit`, `offset`
- output: include `total`, `has_next`, and normalized pagination object

## 4) Status codes

Recommended mapping:

- `200` OK for successful reads/updates/actions
- `201` Created for new transactions
- `204` No Content for successful deletes (or `200` with JSON payload if envelope is always required)
- `400` validation errors
- `404` missing resources
- `409` conflict state (if relevant)
- `500` internal service/database errors

---

## FastAPI implementation sketch

Minimal router grouping recommendation:

- `routers/transactions.py`
- `routers/portfolio.py`
- `routers/prices.py`
- `routers/admin.py` (for migration/rebuild operations)

Pydantic models:

- `TransactionCreate`, `TransactionUpdate`, `TransactionOut`
- `PortfolioStatusOut`, `ReturnsRow`, `PerformanceOut`
- `ApiSuccess[T]`, `ApiError`

Dependency pattern:

- one `get_service()` dependency that opens `PortfolioService` and guarantees close in `finally`.

---

## Endpoint mapping from current CLI commands

- `migrate` -> `POST /migrations/transactions`
- `report` -> `GET /portfolio/returns`
- `transactions` -> `GET /transactions`
- `status` -> `GET /portfolio/status`
- `add` -> `POST /transactions`
- `verify_prices` -> `GET /prices/verify`
- `recalculate` -> `POST /portfolio/recalculate`
- `allocation` -> `GET /portfolio/allocation`
- `cash` -> `GET /portfolio/cash`
- `delete` -> `DELETE /transactions/{transaction_id}`
- `performance` -> `GET /portfolio/performance`
- `summary` -> `GET /portfolio/summary`
- `exchange` -> `POST /transactions/exchange`

---

## Practical next steps

1. Create FastAPI app scaffold and routers.
2. Reuse existing `PortfolioService` methods behind API handlers.
3. Standardize date parsing to ISO in one shared validator.
4. Add tests for each HTTP method family (GET/POST/PUT/PATCH/DELETE).
5. Add OpenAPI examples for key endpoints.
