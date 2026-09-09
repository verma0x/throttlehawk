import { useEffect, useRef, useState, useCallback } from 'react';

// Backend host is split from the WS path so the same origin logic works
// whether the dashboard is served by Vite's dev server or a static build
// sitting behind a reverse proxy in production.
const BACKEND_HOST = import.meta.env.VITE_BACKEND_HOST || 'localhost:4000';
const WS_URL = `ws://${BACKEND_HOST}/telemetry`;
const TEST_ENDPOINT = `http://${BACKEND_HOST}/api/v1/resource`;

const MAX_LOG_ENTRIES = 60;
const RECONNECT_DELAY_MS = 2000;

/**
 * A single row in the live event log feed.
 */
function LogRow({ entry }) {
  const isBlocked = !entry.allowed;
  return (
    <div
      className={`grid grid-cols-[80px_1fr_70px_90px] items-center gap-3 border-b border-hawk-border/60 px-3 py-2 font-mono text-xs ${
        isBlocked ? 'bg-hawk-red/5' : ''
      }`}
    >
      <span className="text-hawk-muted">
        {new Date(entry.timestamp).toLocaleTimeString('en-US', {
          hour12: false,
        })}
      </span>
      <span className="truncate text-hawk-text">{entry.clientId}</span>
      <span
        className={
          isBlocked ? 'font-semibold text-hawk-red' : 'text-hawk-teal'
        }
      >
        {entry.statusCode}
      </span>
      <span className="text-hawk-muted">
        {entry.windowCount}/{entry.limit}
      </span>
    </div>
  );
}

/**
 * A single KPI readout panel.
 */
function StatPanel({ label, value, accentClass }) {
  return (
    <div className="rounded-md border border-hawk-border bg-hawk-panel px-5 py-4">
      <p className="text-xs tracking-wide text-hawk-muted">{label}</p>
      <p
        className={`mt-2 font-mono text-3xl font-semibold ${accentClass || 'text-hawk-text'}`}
      >
        {value.toLocaleString()}
      </p>
    </div>
  );
}

export default function Dashboard() {
  const [connectionState, setConnectionState] = useState('connecting'); // connecting | live | offline
  const [stats, setStats] = useState({
    totalRequests: 0,
    allowedRequests: 0,
    blockedRequests: 0,
  });
  const [logEntries, setLogEntries] = useState([]);
  const [isFiring, setIsFiring] = useState(false);

  const socketRef = useRef(null);
  const reconnectTimerRef = useRef(null);

  const connect = useCallback(() => {
    const socket = new WebSocket(WS_URL);
    socketRef.current = socket;

    socket.onopen = () => setConnectionState('live');

    socket.onmessage = (message) => {
      const payload = JSON.parse(message.data);

      if (payload.type === 'snapshot') {
        setStats(payload.stats);
        return;
      }

      if (payload.type === 'event') {
        setStats(payload.stats);
        setLogEntries((prev) => [payload, ...prev].slice(0, MAX_LOG_ENTRIES));
      }
    };

    socket.onclose = () => {
      setConnectionState('offline');
      // Auto-reconnect so a backend restart or brief network blip doesn't
      // require the user to refresh the dashboard manually.
      reconnectTimerRef.current = setTimeout(connect, RECONNECT_DELAY_MS);
    };

    socket.onerror = () => {
      socket.close();
    };
  }, []);

  useEffect(() => {
    connect();
    return () => {
      clearTimeout(reconnectTimerRef.current);
      socketRef.current?.close();
    };
  }, [connect]);

  const blockRate = stats.totalRequests
    ? Math.round((stats.blockedRequests / stats.totalRequests) * 100)
    : 0;

  // Fires a burst of 15 requests against the protected endpoint so the
  // limiter's 429 behavior is visible on the dashboard without needing an
  // external tool like curl or Postman.
  const fireTestBurst = useCallback(async () => {
    setIsFiring(true);
    const requests = Array.from({ length: 15 }, () =>
      fetch(TEST_ENDPOINT).catch(() => null)
    );
    await Promise.all(requests);
    setIsFiring(false);
  }, []);

  const isLive = connectionState === 'live';

  return (
    <div className="min-h-screen bg-hawk-bg px-6 py-8 md:px-10">
      <div className="mx-auto max-w-6xl">
        {/* ---- Header ---- */}
        <header className="mb-8 flex flex-col justify-between gap-4 border-b border-hawk-border pb-6 sm:flex-row sm:items-center">
          <div>
            <h1 className="font-display text-2xl font-semibold text-hawk-text">
              ThrottleHAWK <span className="text-hawk-teal">Console</span>
            </h1>
            <p className="mt-1 text-sm text-hawk-muted">
              Live sliding-window rate limit telemetry
            </p>
          </div>

          <div className="flex items-center gap-4">
            <div className="flex items-center gap-2 rounded-md border border-hawk-border bg-hawk-panel px-3 py-1.5">
              <span
                className={`h-2 w-2 rounded-full ${
                  isLive
                    ? 'bg-hawk-teal hawk-live-dot'
                    : 'bg-hawk-red'
                }`}
              />
              <span className="text-xs font-medium text-hawk-muted">
                {isLive ? 'Live' : 'Reconnecting…'}
              </span>
            </div>

            <button
              onClick={fireTestBurst}
              disabled={isFiring}
              className="rounded-md border border-hawk-teal/40 bg-hawk-teal/10 px-4 py-1.5 text-sm font-medium text-hawk-teal transition-colors hover:bg-hawk-teal/20 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {isFiring ? 'Firing…' : 'Fire test burst (15 req)'}
            </button>
          </div>
        </header>

        {/* ---- KPI Row ---- */}
        <div className="mb-8 grid grid-cols-2 gap-4 lg:grid-cols-4">
          <StatPanel label="Total requests" value={stats.totalRequests} />
          <StatPanel
            label="Allowed"
            value={stats.allowedRequests}
            accentClass="text-hawk-teal"
          />
          <StatPanel
            label="Blocked (429)"
            value={stats.blockedRequests}
            accentClass="text-hawk-red"
          />
          <StatPanel
            label="Block rate"
            value={blockRate}
            accentClass={blockRate > 20 ? 'text-hawk-amber' : 'text-hawk-text'}
          />
        </div>

        {/* ---- Live Event Log ---- */}
        <div className="rounded-md border border-hawk-border bg-hawk-panel">
          <div className="flex items-center justify-between border-b border-hawk-border px-5 py-3">
            <h2 className="text-sm font-medium text-hawk-text">
              Live event feed
            </h2>
            <span className="text-xs text-hawk-muted">
              {logEntries.length} recent events
            </span>
          </div>

          <div className="grid grid-cols-[80px_1fr_70px_90px] gap-3 border-b border-hawk-border px-3 py-2 font-mono text-[11px] uppercase tracking-wide text-hawk-muted">
            <span>Time</span>
            <span>Client</span>
            <span>Status</span>
            <span>Window</span>
          </div>

          <div className="max-h-[420px] overflow-y-auto">
            {logEntries.length === 0 ? (
              <p className="px-5 py-8 text-center text-sm text-hawk-muted">
                No requests yet — fire a test burst or hit{' '}
                <code className="font-mono text-hawk-teal">
                  /api/v1/resource
                </code>{' '}
                to see live events.
              </p>
            ) : (
              logEntries.map((entry, idx) => (
                <LogRow key={`${entry.timestamp}-${idx}`} entry={entry} />
              ))
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
