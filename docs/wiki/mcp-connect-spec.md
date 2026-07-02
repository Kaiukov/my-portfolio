# MCP Connection Spec — Canonical Method

**Единый канонический метод подключения:** Streamable HTTP MCP endpoint.

Никаких дочерних процессов, spawn, pipe, stdin/stdout. Один HTTP-endpoint для любого сервиса.

---

## Endpoint

```
http://<host>:8787/mcp
```

Порт по умолчанию: `8787` (меняется через `PORT` или `PORTFOLIO_API_PORT`).

## Протокол

Model Context Protocol (MCP) — Streamable HTTP transport:
- `POST /mcp` — JSON-RPC запросы
- `GET /mcp` — SSE upgrade (опционально, для стриминга)
- `DELETE /mcp` — завершение сессии

Библиотека на стороне клиента: `@modelcontextprotocol/sdk` (любая реализация MCP-клиента с поддержкой Streamable HTTP).

## Запуск сервера (на стороне владельца портфеля)

Сервер поднимается одним из двух способов:

### Docker (рекомендуемый)
```bash
cd /path/to/my-portfolio-cli
PORT=8787 docker compose -f portfolio-ts/docker-compose.yml up -d
```

### Bun напрямую
```bash
cd portfolio-ts
bun run src/service.ts
# или
bun run service
```

Сервер сразу отдаёт и REST API, и MCP на одном порту.

## Переменные окружения (только на стороне сервера)

| Переменная | Назначение | Пример |
|---|---|---|
| `PORTFOLIO_DB_URL` | PostgreSQL connection string | `postgresql://user:pass@host:5432/db` |
| `PORT` (или `PORTFOLIO_API_PORT`) | Порт сервера | `8787` |
| `PORTFOLIO_API_CORS_ORIGIN` | CORS origin (если клиент в браузере) | `https://my-app.example.com` |

## Подключение со стороны клиента (Hermes / любой MCP-клиент)

### Конфигурация для MCP-клиента

```json
{
  "mcpServers": {
    "portfolio": {
      "type": "http",
      "url": "http://<host>:8787/mcp"
    }
  }
}
```

Никаких `command`, `args`, `cwd` — только URL.

### Пример: Claude Desktop config

```json
{
  "mcpServers": {
    "portfolio": {
      "type": "streamableHttp",
      "url": "http://192.168.1.100:8787/mcp"
    }
  }
}
```

### Пример: программное подключение (TypeScript)

```ts
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";

const transport = new StreamableHTTPClientTransport(
  new URL("http://localhost:8787/mcp")
);
const client = new Client(
  { name: "my-service", version: "1.0.0" },
  { capabilities: {} }
);
await client.connect(transport);

// Вызов инструмента
const result = await client.callTool({
  name: "status",
  arguments: { as_of: "2026-06-13" }
});
```

### Пример: curl (прямой JSON-RPC)

```bash
curl -X POST http://localhost:8787/mcp \
  -H "Content-Type: application/json" \
  -H "Accept: application/json" \
  -d '{
    "jsonrpc": "2.0",
    "id": 1,
    "method": "tools/call",
    "params": {
      "name": "status",
      "arguments": {}
    }
  }'
```

Ответ:
```json
{
  "jsonrpc": "2.0",
  "id": 1,
  "result": {
    "content": [{
      "type": "text",
      "text": "{\"ok\":true,\"command\":\"status\",\"data\":{...},\"meta\":{...}}"
    }]
  }
}
```

## Полный список инструментов (28 tools)

### Read tools (23) — GET-семантика, без побочных эффектов

| # | Tool | Обязательные | Опциональные |
|---|------|-------------|-------------|
| 1 | `status` | — | `as_of` |
| 2 | `summary` | — | `as_of` |
| 3 | `cash` | — | `as_of` |
| 4 | `cash_drag` | — | `as_of`, `from_date`, `benchmark_return_rate`, `cash_return_rate` |
| 5 | `currency_exposure` | — | `as_of` |
| 6 | `income` | — | `as_of`, `from_date`, `asset` |
| 7 | `realized_gains` | — | `from_date`, `to_date`, `asset`, `by_year` |
| 8 | `allocation` | — | `as_of` |
| 9 | `rebalance` | `target` | `as_of` |
| 10 | `concentration` | — | `as_of`, `top_n` |
| 11 | `diversification` | — | `as_of`, `lookback_days`, `min_correlation` |
| 12 | `decomposition` | — | `as_of` |
| 13 | `performance` | — | `as_of`, `benchmark`, `from_date`, `period`, `inflation_rate` |
| 14 | `mwr` | — | `as_of` |
| 15 | `transactions` | — | `limit`, `offset`, `start_date`, `end_date` |
| 16 | `report` | — | `limit`, `offset`, `start_date`, `end_date` |
| 17 | `health` | — | `max_age_days` |
| 18 | `verify_prices` | — | `max_age_days` |
| 19 | `widget` | — | `days`, `as_of` |
| 20 | `asset_metadata` | — | `asset`, `refresh` |
| 21 | `projection` | — | `as_of`, `monthly_contribution`, `annual_return_rate`, `target_value`, `projection_years`, `inflation_rate` |
| 22 | `withdrawal` | — | `as_of`, `annual_withdrawal`, `withdrawal_rate`, `time_horizon_years`, `expected_return`, `inflation_rate` |
| 23 | `asset_analysis` | `ticker` или `asset` | `period`, `lookback_days`, `benchmark`, `as_of`, `risk_free_rate` |

### Write tools (5) — мутируют данные

| # | Tool | Обязательные | Опциональные |
|---|------|-------------|-------------|
| 24 | `add_transaction` | `date`, `asset`, `action`, `quantity`, `exchange` | `price`, `currency`, `fees`, `feeCurrency`, `account` |
| 25 | `edit_transaction` | `id` | `date`, `asset`, `action`, `quantity`, `price`, `currency`, `fees`, `feeCurrency`, `exchange`, `dataSource`, `account`, `dry_run` |
| 26 | `delete_transaction` | `id` | `dry_run`, `confirm` |
| 27 | `exchange_currency` | `date`, `fromAsset`, `toAsset`, `quantity`, `rate` | — |
| 28 | `split` | `date`, `asset`, `ratio`, `confirm` | — |

## Алиасы параметров

Все параметры принимают snake_case и camelCase варианты. Клиент может использовать любой:

| Значение | Альтернативы |
|----------|-------------|
| `id` транзакции | `id`, `transactionId`, `transaction_id`, `transId` |
| Дата среза | `as_of`, `asOf` |
| Даты периода | `from_date`/`fromDate`, `to_date`/`toDate` |
| Dry run | `dry_run`, `dryRun`, `dry-run` |
| Fee currency | `feeCurrency`, `fee_currency` |
| Data source | `dataSource`, `data_source` |
| From asset | `fromAsset`, `from_asset`, `from` |
| To asset | `toAsset`, `to_asset`, `to` |
| Top N | `top_n`, `topN` |
| Lookback days | `lookback_days`, `lookbackDays` |
| Min correlation | `min_correlation`, `minCorrelation` |
| Max age days | `max_age_days`, `maxAgeDays` |
| Monthly contribution | `monthly_contribution`, `monthlyContribution` |
| Annual return rate | `annual_return_rate`, `annualReturnRate` |
| Target value | `target_value`, `targetValue` |
| Projection years | `projection_years`, `projectionYears` |
| Inflation rate | `inflation_rate`, `inflationRate` |
| Annual withdrawal | `annual_withdrawal`, `annualWithdrawal` |
| Withdrawal rate | `withdrawal_rate`, `withdrawalRate` |
| Time horizon years | `time_horizon_years`, `timeHorizonYears` |
| Expected return | `expected_return`, `expectedReturn` |
| Risk free rate | `risk_free_rate`, `riskFreeRate` |
| By year | `by_year`, `byYear` |
| Benchmark return rate | `benchmark_return_rate`, `benchmarkReturnRate` |
| Cash return rate | `cash_return_rate`, `cashReturnRate` |

## JSON конверт ответа

Каждый вызов инструмента возвращает данные в поле `content[0].text` как JSON-строку:

```json
{
  "ok": true,
  "command": "status",
  "data": { ... },
  "meta": {
    "generated_at": "2026-06-13T12:00:00.000Z",
    "count": 5,
    "needs_recalc": false,
    "prices_as_of": "2026-06-12",
    "price_age_days": 1
  }
}
```

Ошибки:
```json
{
  "ok": false,
  "command": "add_transaction",
  "error": {
    "code": "VALIDATION_ERROR",
    "message": "Required: date, asset, action, quantity, exchange"
  },
  "meta": {}
}
```

Коды ошибок:
- `VALIDATION_ERROR` — недостающие/невалидные параметры
- `NOT_FOUND` — неизвестный инструмент
- `INTERNAL_ERROR` — серверная ошибка

## Dry-run и Confirm

- `edit_transaction` + `dry_run: true` → предпросмотр без изменений
- `delete_transaction` + `dry_run: true` → предпросмотр без удаления
- `delete_transaction` + `confirm: true` → реальное удаление
- `split` + `confirm: true` → реальный сплит

## CORS

Если клиент в браузере, сервер должен быть запущен с `PORTFOLIO_API_CORS_ORIGIN`:
```bash
export PORTFOLIO_API_CORS_ORIGIN="https://my-app.example.com"
```

Сервер автоматически добавляет заголовки:
- `Access-Control-Allow-Origin`
- `Access-Control-Allow-Methods: GET, POST, PATCH, PUT, DELETE, OPTIONS`
- `Access-Control-Allow-Headers: Content-Type, Authorization, Accept, Last-Event-ID, Mcp-Session-Id, Mcp-Protocol-Version`
- `Access-Control-Expose-Headers: Mcp-Session-Id, Mcp-Protocol-Version, Last-Event-ID`

## Проверка доступности

```bash
# Health check (REST API)
curl http://localhost:8787/ready
# → {"ready": true, "started_at": "...", "port": 8787, ...}

# MCP tools/list (JSON-RPC)
curl -X POST http://localhost:8787/mcp \
  -H "Content-Type: application/json" \
  -d '{"jsonrpc":"2.0","id":1,"method":"tools/list","params":{}}'
# → список всех 28 инструментов

# MCP tools/call — вызов конкретного инструмента
curl -X POST http://localhost:8787/mcp \
  -H "Content-Type: application/json" \
  -d '{"jsonrpc":"2.0","id":1,"method":"tools/call","params":{"name":"status","arguments":{}}}'
# → текущий снапшот портфеля
```

## Итого

| Что | Значение |
|---|---|
| **Метод** | Streamable HTTP |
| **URL** | `http://<host>:8787/mcp` |
| **Протокол** | JSON-RPC 2.0 поверх HTTP |
| **Транспорт** | POST для вызовов, GET для SSE, DELETE для закрытия сессии |
| **Инструментов** | 28 (23 read + 5 write) |
| **Аутентификация** | Не требуется (доверенная сеть) |
| **Формат ответа** | JSON-конверт `{ok, command, data, meta}` |
| **Зависимости клиента** | Любой MCP-клиент с поддержкой Streamable HTTP |
