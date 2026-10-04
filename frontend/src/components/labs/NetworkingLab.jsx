import { useEffect, useRef, useState } from "react";
import { BASE_URL } from "../../api";
import LabShell, { Bars, Callout, Panel, Stat } from "./LabShell";

const IDEAS = [
  "Layers: IP (L3) routes packets, TCP/UDP/QUIC (L4) move bytes between processes, and HTTP/WebSockets/gRPC (L7) carry meaning.",
  "TCP is reliable and ordered, so it's the default. UDP trades reliability for speed (video, games).",
  "An L4 load balancer routes connections, which suits WebSockets. An L7 balancer routes HTTP requests by path or header. Health checks remove dead servers from rotation.",
  "Use timeouts, then retry with exponential backoff and jitter. Retries are only safe if the request is idempotent.",
  "A circuit breaker stops calling a failing dependency so one outage doesn't cascade through the system.",
];

const PROTOCOLS = [
  ["REST over HTTP", "default for client ↔ server APIs (this whole app)"],
  ["GraphQL", "clients with very different data needs; avoids over/under-fetching"],
  ["gRPC", "internal service ↔ service; binary protobuf, fast, streaming"],
  ["SSE", "server pushes a stream of updates over one HTTP response (live seat counts)"],
  ["WebSockets", "true bidirectional real-time (chat, live auctions); stateful and harder to scale"],
  ["WebRTC", "peer-to-peer audio/video; needs STUN/TURN for NAT traversal"],
];

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ---------- 1. request anatomy ----------

function RequestAnatomy({ runRequest }) {
  const [kb, setKb] = useState(64);
  const [phases, setPhases] = useState(null);

  async function measure() {
    performance.clearResourceTimings();
    const path = `/api/lab/net/ping?kb=${kb}&n=${Date.now()}`;
    const tx = await runRequest("GET", path, "net.ping");
    await sleep(50); // the timing entry lands just after the response body is read
    const entry = performance.getEntriesByName(new URL(`${BASE_URL}${path}`, location.origin).href).pop();
    if (!entry) return;
    const tls = entry.secureConnectionStart > 0 ? entry.connectEnd - entry.secureConnectionStart : 0;
    setPhases({
      total: Math.round(entry.duration),
      serverTime: tx.responseHeaders["x-response-time"],
      size: entry.encodedBodySize || entry.transferSize,
      reused: entry.connectEnd - entry.connectStart === 0,
      rows: [
        { label: "DNS lookup", layer: "L7 (DNS)", ms: entry.domainLookupEnd - entry.domainLookupStart },
        { label: "TCP handshake", layer: "L4", ms: entry.connectEnd - entry.connectStart - tls },
        { label: "TLS handshake", layer: "L4/L7", ms: tls },
        { label: "request → first byte", layer: "L7 HTTP", ms: entry.responseStart - entry.requestStart },
        { label: "download body", layer: "L4 (TCP stream)", ms: entry.responseEnd - entry.responseStart },
      ].map((r) => ({ ...r, ms: Math.max(0, Math.round(r.ms * 10) / 10) })),
    });
  }

  return (
    <Panel
      title="1 · Anatomy of one request"
      hint="A real fetch to Flask, broken down with the browser's Resource Timing API. Fetch twice: the second time the TCP connection is reused (keep-alive)."
    >
      <div className="form-row compact">
        <div className="field">
          <label>Response size: {kb} KB</label>
          <input type="range" min="1" max="2048" value={kb} onChange={(e) => setKb(Number(e.target.value))} />
        </div>
        <button className="btn btn-primary" onClick={measure}>
          Fetch & measure
        </button>
      </div>
      {phases && (
        <>
          <Bars items={phases.rows.map((r) => ({ label: r.label, value: r.ms, note: `· ${r.layer}` }))} max={Math.max(phases.total, 1)} unit="ms" />
          <p className="small muted">
            Total {phases.total}ms for {(phases.size / 1024).toFixed(0)} KB. Flask itself spent {phases.serverTime}.{" "}
            {phases.reused ? "No handshake this time: the TCP connection was reused." : "A new TCP connection was opened."} DNS is ~0
            because <code>localhost</code> never leaves your machine.
          </p>
        </>
      )}
      <table className="tight">
        <thead>
          <tr>
            <th>protocol</th>
            <th>reach for it when…</th>
          </tr>
        </thead>
        <tbody>
          {PROTOCOLS.map(([p, when]) => (
            <tr key={p}>
              <td>{p}</td>
              <td className="muted">{when}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </Panel>
  );
}

// ---------- 2. load balancer ----------

function LoadBalancerDemo({ runRequest }) {
  const [algo, setAlgo] = useState("round_robin");
  const [servers, setServers] = useState(null);
  const [burst, setBurst] = useState(null);

  async function loadServers() {
    const tx = await runRequest("GET", "/api/lab/net/lb/servers", null, undefined, { quiet: true });
    if (tx.ok) setServers(tx.responseBody);
  }

  useEffect(() => {
    loadServers();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function fire() {
    const clients = ["fan-1", "fan-2", "fan-3", "fan-4", "fan-5"];
    const results = await Promise.all(
      Array.from({ length: 20 }, (_, i) =>
        runRequest("GET", `/api/lab/net/lb?algo=${algo}&client=${clients[i % clients.length]}`, "net.lb"),
      ),
    );
    const counts = {};
    results.forEach((r) => {
      const s = r.responseHeaders["x-server"] ?? `error ${r.status}`;
      counts[s] = (counts[s] ?? 0) + 1;
    });
    setBurst({ algo, counts, avgMs: Math.round(results.reduce((a, r) => a + r.elapsedMs, 0) / results.length) });
    loadServers();
  }

  async function toggleHealth(name) {
    const tx = await runRequest("PATCH", `/api/lab/net/lb/servers/${name}`, "net.health", { healthy: !servers[name].healthy });
    if (tx.ok) setServers(tx.responseBody);
  }

  return (
    <Panel
      title="2 · Load balancer"
      hint="Three app servers with different speeds. Fire 20 concurrent requests from 5 clients. Round-robin ignores speed; least-connections routes around the slow server; ip_hash keeps each client on the same server."
    >
      <div className="form-row compact">
        <div className="field">
          <label>Algorithm</label>
          <select value={algo} onChange={(e) => setAlgo(e.target.value)}>
            <option value="round_robin">round robin</option>
            <option value="least_conn">least connections</option>
            <option value="ip_hash">ip/client hash (sticky)</option>
          </select>
        </div>
        <button className="btn btn-primary" onClick={fire}>
          Fire 20 requests
        </button>
      </div>
      {servers && (
        <div className="server-row">
          {Object.entries(servers).map(([name, s]) => (
            <div key={name} className={`server ${s.healthy ? "" : "down"}`}>
              <strong>{name}</strong>
              <span className="muted small">{s.latency_ms}ms per request</span>
              <span className="small">served {s.served}</span>
              <button className={s.healthy ? "btn-danger" : "btn-quiet"} onClick={() => toggleHealth(name)}>
                {s.healthy ? "fail health check" : "bring back"}
              </button>
            </div>
          ))}
        </div>
      )}
      {burst && (
        <>
          <Bars items={Object.entries(burst.counts).map(([label, value]) => ({ label, value }))} max={20} unit=" req" />
          <p className="small muted">
            {burst.algo}: average client latency {burst.avgMs}ms.
          </p>
        </>
      )}
    </Panel>
  );
}

// ---------- 3. timeouts, retries, circuit breaker ----------

const BREAKER_THRESHOLD = 3;
const BREAKER_COOLDOWN_MS = 5000;

function RetryDemo({ runRequest }) {
  const [cfg, setCfg] = useState({ failRate: 0.6, timeoutMs: 1000, retries: 4, baseMs: 200, jitter: true });
  const [attempts, setAttempts] = useState([]);
  const [outcome, setOutcome] = useState(null);
  const [outage, setOutage] = useState(false);
  const [breaker, setBreaker] = useState({ state: "CLOSED", failures: 0, openedAt: 0 });
  const breakerRef = useRef(breaker);
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 250);
    return () => clearInterval(id);
  }, []);

  function updateBreaker(next) {
    breakerRef.current = next;
    setBreaker(next);
  }

  // closed -> (N failures) -> open -> (cooldown) -> half-open -> success closes / failure re-opens
  function breakerAllows() {
    const b = breakerRef.current;
    if (b.state === "OPEN" && Date.now() - b.openedAt >= BREAKER_COOLDOWN_MS) {
      updateBreaker({ ...b, state: "HALF_OPEN" });
      return true;
    }
    return b.state !== "OPEN";
  }

  function recordResult(ok) {
    const b = breakerRef.current;
    if (ok) {
      updateBreaker({ state: "CLOSED", failures: 0, openedAt: 0 });
    } else if (b.state === "HALF_OPEN" || b.failures + 1 >= BREAKER_THRESHOLD) {
      updateBreaker({ state: "OPEN", failures: b.failures + 1, openedAt: Date.now() });
    } else {
      updateBreaker({ ...b, failures: b.failures + 1 });
    }
  }

  async function callWithRetries() {
    const t0 = performance.now();
    const log = [];
    setAttempts([]);
    for (let attempt = 0; attempt <= cfg.retries; attempt++) {
      if (!breakerAllows()) {
        log.push({ attempt, start: performance.now() - t0, ms: 0, status: "short-circuited", ok: false, wait: 0 });
        setAttempts([...log]);
        setOutcome({ ok: false, text: "Circuit OPEN: failed fast without calling the service." });
        return;
      }
      const start = performance.now() - t0;
      const tx = await runRequest("GET", `/api/lab/net/flaky?fail_rate=${cfg.failRate}&slow_rate=0.15`, "net.flaky", undefined, {
        timeoutMs: cfg.timeoutMs,
      });
      recordResult(tx.ok);
      const entry = { attempt, start, ms: tx.elapsedMs, status: tx.status || "timeout", ok: tx.ok, wait: 0 };
      log.push(entry);
      setAttempts([...log]);
      if (tx.ok) {
        setOutcome({ ok: true, text: `Succeeded on attempt ${attempt + 1} after ${Math.round(performance.now() - t0)}ms.` });
        return;
      }
      if (attempt < cfg.retries) {
        const backoff = cfg.baseMs * 2 ** attempt;
        entry.wait = Math.round(cfg.jitter ? Math.random() * backoff : backoff); // "full jitter"
        setAttempts([...log]);
        await sleep(entry.wait);
      }
    }
    setOutcome({ ok: false, text: `Gave up after ${cfg.retries + 1} attempts.` });
  }

  async function setServiceOutage(down) {
    await runRequest("POST", "/api/lab/net/outage", null, { down });
    setOutage(down);
  }

  const totalSpan = Math.max(1, ...attempts.map((a) => a.start + a.ms + a.wait));
  const cooldownLeft = breaker.state === "OPEN" ? Math.max(0, BREAKER_COOLDOWN_MS - (now - breaker.openedAt)) : 0;

  return (
    <Panel
      title="3 · Timeouts, retries with backoff, circuit breaker"
      hint="A flaky inventory service: some calls return 503 and 15% hang for 3s, longer than the client timeout. The retry logic below runs in your browser."
    >
      <div className="form-row compact">
        <div className="field">
          <label>Failure rate: {Math.round(cfg.failRate * 100)}%</label>
          <input type="range" min="0" max="1" step="0.05" value={cfg.failRate} onChange={(e) => setCfg({ ...cfg, failRate: Number(e.target.value) })} />
        </div>
        <div className="field">
          <label>Timeout: {cfg.timeoutMs}ms</label>
          <input type="range" min="200" max="4000" step="100" value={cfg.timeoutMs} onChange={(e) => setCfg({ ...cfg, timeoutMs: Number(e.target.value) })} />
        </div>
        <div className="field">
          <label>Max retries: {cfg.retries}</label>
          <input type="range" min="0" max="6" value={cfg.retries} onChange={(e) => setCfg({ ...cfg, retries: Number(e.target.value) })} />
        </div>
        <label className="check">
          <input type="checkbox" checked={cfg.jitter} onChange={(e) => setCfg({ ...cfg, jitter: e.target.checked })} />
          jitter
        </label>
        <button className="btn btn-primary" onClick={callWithRetries}>
          Call service
        </button>
      </div>

      <div className="stat-row">
        <Stat
          label={`circuit breaker${cooldownLeft ? ` · half-open in ${(cooldownLeft / 1000).toFixed(1)}s` : ""}`}
          value={breaker.state.replace("_", "-")}
          tone={breaker.state === "CLOSED" ? "good" : breaker.state === "OPEN" ? "bad" : "warn"}
        />
        <Stat label={`consecutive failures (trips at ${BREAKER_THRESHOLD})`} value={breaker.failures} />
        <div className="stat">
          <button className={outage ? "btn btn-primary" : "btn"} onClick={() => setServiceOutage(!outage)}>
            {outage ? "End outage" : "Start full outage"}
          </button>
          <div className="stat-label">server-side: every call fails</div>
        </div>
      </div>

      {attempts.length > 0 && (
        <div className="timeline">
          {attempts.map((a) => (
            <div key={a.attempt} className="timeline-row">
              <span className="bar-label">try {a.attempt + 1}</span>
              <div className="timeline-track">
                <div
                  className={`timeline-call ${a.ok ? "good" : "bad"}`}
                  style={{ left: `${(100 * a.start) / totalSpan}%`, width: `${Math.max(1, (100 * a.ms) / totalSpan)}%` }}
                />
                {a.wait > 0 && (
                  <div
                    className="timeline-wait"
                    style={{ left: `${(100 * (a.start + a.ms)) / totalSpan}%`, width: `${(100 * a.wait) / totalSpan}%` }}
                  />
                )}
              </div>
              <span className="bar-value">
                {a.status} · {a.ms}ms{a.wait ? ` · wait ${a.wait}ms` : ""}
              </span>
            </div>
          ))}
        </div>
      )}
      {outcome && <Callout tone={outcome.ok ? "good" : "bad"}>{outcome.text}</Callout>}
      <p className="small muted">
        Backoff doubles each time (base {cfg.baseMs}ms × 2ⁿ). Jitter randomizes the wait so thousands of clients don't
        all retry at the same moment. Start a full outage and call a few times to watch the breaker trip, then wait for
        half-open.
      </p>
    </Panel>
  );
}

export default function NetworkingLab({ runRequest }) {
  const [version, setVersion] = useState(0);

  async function reset() {
    await runRequest("POST", "/api/lab/net/reset", null);
    setVersion((v) => v + 1);
  }

  return (
    <LabShell title="Networking Essentials" article="core-concepts/networking-essentials" ideas={IDEAS} onReset={reset}>
      <div key={version}>
        <RequestAnatomy runRequest={runRequest} />
        <LoadBalancerDemo runRequest={runRequest} />
        <RetryDemo runRequest={runRequest} />
      </div>
    </LabShell>
  );
}
