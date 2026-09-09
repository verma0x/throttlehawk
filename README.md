# ThrottleHAWK

A high-performance, low-latency API rate-limiting and real-time telemetry engine. ThrottleHAWK enforces a **Sliding Window Log** rate limit backed by Redis, and streams every allow/block decision to a live dashboard over WebSockets.

```
throttlehawk/
├── backend/
│   ├── src/
│   │   ├── middleware/
│   │   │   └── hawkLimiter.js   # Sliding window log limiter (Redis ZSET)
│   │   ├── services/
│   │   │   ├── redis.js         # Shared ioredis client + health flag
│   │   │   └── telemetry.js     # WebSocket broadcaster
│   │   └── server.js            # Express app + HTTP/WS server
│   ├── package.json
│   └── .env.example
├── frontend/
│   ├── src/
│   │   ├── components/
│   │   │   └── Dashboard.jsx    # Live KPI + event feed UI
│   │   ├── App.jsx
│   │   ├── main.jsx
│   │   └── index.css
│   ├── index.html
│   ├── package.json
│   ├── tailwind.config.js
│   ├── postcss.config.js
│   └── vite.config.js
└── README.md
```

## 1. Architecture

### Rate limiting algorithm: Sliding Window Log

Each client is tracked in a Redis **Sorted Set** (`ZSET`) at key `hawk:{clientId}`, where the score of each member is the request's arrival timestamp (epoch ms) and the member itself is a unique token so concurrent requests never collide.

On every request, `hawkLimiter.js` runs a single **atomic pipeline**:

1. `ZREMRANGEBYSCORE` — evicts entries older than `now - windowMs` (requests that have slid out of the window).
2. `ZCARD` — counts remaining entries, i.e. requests still inside the window.
3. If under the limit: `ZADD` the new timestamp and `EXPIRE` the key so idle clients are garbage-collected automatically.

Because the count is exact timestamps rather than a bucketed counter, the window slides continuously — there's no "boundary reset spike" where a client can burst 2x the limit by timing requests around a fixed-window reset. Because the check-and-record sequence runs as one pipelined round trip, there's no race window between two concurrent requests both reading a stale count and both being admitted.

### Fail-open fault tolerance

`services/redis.js` exposes a synchronous `isRedisHealthy` flag maintained by the client's `connect` / `ready` / `error` / `close` events. If Redis is unreachable, `hawkLimiter` skips the Redis round-trip entirely and calls `next()` — the API stays up and unthrottled rather than failing every request because its dependency is down. Any unexpected error thrown mid-pipeline is caught and also fails open.

### Telemetry

`services/telemetry.js` attaches a `ws` `WebSocketServer` directly to the same Node `http.Server` instance Express listens on (no second port), at path `/telemetry`. Every request the limiter processes — allowed or blocked — is broadcast as a JSON event to all connected dashboard clients, along with a rolling snapshot of total/allowed/blocked counts. New dashboard connections are immediately hydrated with a `snapshot` message so KPIs are correct without waiting for the next live event.

## 2. Getting started

### Prerequisites

- Node.js 18+
- A running Redis instance (local, Docker, or managed)

### Backend

```bash
cd backend
cp .env.example .env    # adjust REDIS_URL / PORT / limits as needed
npm install
npm run dev              # nodemon, auto-restarts on change
# or: npm start
```

The server listens on `http://localhost:4000` by default, exposing:

| Endpoint             | Method | Description                                  |
| --------------------- | ------ | --------------------------------------------- |
| `/healthz`             | GET    | Liveness check (not rate limited)             |
| `/api/v1/resource`     | GET    | Demo protected resource (rate limited)        |
| `/telemetry` (WS)      | WS     | Live telemetry event stream for the dashboard |

Default limiter config: **10 requests / 30 seconds** per client (keyed by `X-API-Key` header if present, otherwise by IP). Override via `RATE_LIMIT_WINDOW_MS` / `RATE_LIMIT_MAX_REQUESTS` in `.env`.

### Frontend

```bash
cd frontend
npm install
npm run dev
```

Open `http://localhost:5173`. The dashboard connects to `ws://localhost:4000/telemetry` by default (override with a `VITE_BACKEND_HOST` env var, e.g. `VITE_BACKEND_HOST=api.example.com`). Use the **"Fire test burst"** button to send 15 rapid requests to `/api/v1/resource` and watch the KPIs and event feed update live, including 429s once the window's limit is exceeded.

## 3. Response headers

| Header                   | Sent on              | Meaning                                   |
| ------------------------- | --------------------- | ------------------------------------------ |
| `X-RateLimit-Limit`        | Every request         | Configured max requests per window        |
| `X-RateLimit-Remaining`    | Every request         | Requests remaining in the current window  |
| `Retry-After`              | 429 responses only    | Seconds until the oldest entry expires    |

## 4. Production notes

- **Redis**: point `REDIS_URL` at a managed/clustered Redis in production; the ZSET keys are per-client and self-expire, so no manual cleanup job is needed.
- **Horizontal scaling**: because rate-limit state lives in Redis rather than in-process memory, you can run multiple backend instances behind a load balancer and they will share a consistent view of each client's window.
- **Client identification**: `resolveClientId` currently uses `X-API-Key` or IP; swap in your own auth-derived identifier (e.g. a JWT subject claim) for authenticated APIs.
- **Logging**: `console.log`/`console.error` calls throughout are placeholders — route them through a structured logger (pino, winston) and your metrics/alerting stack in production.
