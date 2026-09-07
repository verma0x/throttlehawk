# ThrottleHAWK 🦅⚡

> A high-performance, low-latency API rate-limiting and real-time telemetry engine powered by Node.js and Redis.

![Node.js](https://img.shields.io/badge/Node.js-339933?style=for-the-badge&logo=nodedotjs&logoColor=white)
![Redis](https://img.shields.io/badge/Redis-DC382D?style=for-the-badge&logo=redis&logoColor=white)
![Express](https://img.shields.io/badge/Express-000000?style=for-the-badge&logo=express&logoColor=white)
![License](https://img.shields.io/badge/License-MIT-blue?style=for-the-badge)

---

<!-- LIVE LAUNCH COUNTER -->
<div align="center">
  <h3>🚀 ThrottleHAWK v1.0 Launch Countdown</h3>

  <a href="https://github.com/verma0x/throttlehawk">
    <img src="https://readme-countdown-svg.vercel.app/api/countdown?end=2026-09-09T03:58:00Z&title=ThrottleHAWK+v1.0+Release&bg=0B0E14&text=00E676" alt="ThrottleHAWK Launch Countdown" />
  </a>
</div>

---

### 📖 About ThrottleHAWK

**ThrottleHAWK** sits between client applications and backend microservices to monitor incoming HTTP requests, enforce per-client quotas, and protect APIs against unexpected traffic spikes, DDoS abuse, and resource degradation.

---

### ✨ Key Features

* **Sliding Window Log Algorithm:** Uses Redis Sorted Sets (`ZSET`) to provide precise, sub-second rate-limiting without boundary reset spikes.
* **Sub-Millisecond Performance:** Leverages pipeline batching in `ioredis` for minimal middleware overhead.
* **Standard-Compliant Headers:** Automatically attaches RFC-compliant HTTP headers (`X-RateLimit-Limit`, `X-RateLimit-Remaining`, `Retry-After`).
* **Fail-Open Fault Tolerance:** Safely bypasses rate limiting if the caching layer drops connection, ensuring high availability.
* **Real-Time Telemetry Stream:** Built-in WebSocket server for streaming live traffic metrics, RPS, and 429 quota rejections directly to monitoring interfaces.

---

### 🏗️ Architecture Overview

```text
[ Incoming Request ] 
         │
         ▼
┌───────────────────────────┐
│    Express Middleware     │ ──▶ Extract IP / API Key
└────────┬──────────────────┘
         │
         ▼
┌───────────────────────────┐
│       Redis Cache         │ ──▶ Atomic ZSET Sliding Window Inspection
└────────┬──────────────────┘
         │
    ┌────┴──────────────────┐
    │                       │
[ Within Quota ]     [ Quota Exceeded ]
    │                       │
    ▼                       ▼
Process Request       Return 429 Error
(200 OK)              (Too Many Requests)
