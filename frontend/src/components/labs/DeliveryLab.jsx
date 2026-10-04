import { useEffect, useState } from "react";
import LabShell, { Callout, Panel } from "./LabShell";

const STEPS = [
  { id: "req", label: "Requirements", minutes: 5 },
  { id: "entities", label: "Core Entities", minutes: 2 },
  { id: "api", label: "API", minutes: 5 },
  { id: "flow", label: "Data Flow", minutes: 5, optional: true },
  { id: "hld", label: "High-Level Design", minutes: 15 },
  { id: "deep", label: "Deep Dives", minutes: 10 },
];

const IDEAS = [
  "Move through the steps in order and keep to the time budget. Lots of interviews go wrong by never reaching the deep dives.",
  "Functional requirements are the 3 or so things users must be able to do. Non-functional requirements are system qualities with numbers attached.",
  "Only do capacity math if the answer will change the design.",
  "Start the high-level design simple: go endpoint by endpoint and make it work before making it scale.",
  "In the deep dives, revisit each non-functional requirement and fix the bottlenecks. This lab walks through designing this very Ticket Desk.",
];

const NFRS = [
  { text: "Strong consistency for booking: no seat sold twice", lab: "cap", tag: "CAP → CP" },
  { text: "High availability for browsing & search", lab: "cap", tag: "CAP → AP" },
  { text: "Survive surges of 10M fans for one show", lab: "sharding", tag: "hot spots" },
  { text: "Event pages load in < 500 ms", lab: "caching", tag: "caching" },
  { text: "Safe retries: a double-click never double-charges", lab: "api", tag: "idempotency" },
];

const BOXES = [
  { id: "client", label: "Client", x: 10, y: 95, lab: "networking" },
  { id: "lb", label: "API Gateway / LB", x: 140, y: 95, lab: "networking" },
  { id: "event", label: "Event Service", x: 300, y: 30, lab: "api" },
  { id: "booking", label: "Booking Service", x: 300, y: 160, lab: "cap" },
  { id: "cache", label: "Cache (Redis)", x: 470, y: 30, lab: "caching" },
  { id: "db", label: "Sharded DB", x: 470, y: 160, lab: "sharding" },
];
const LINKS = [
  ["client", "lb"],
  ["lb", "event"],
  ["lb", "booking"],
  ["event", "cache"],
  ["cache", "db"],
  ["event", "db"],
  ["booking", "db"],
];
const BOX_W = 130;
const BOX_H = 44;

function Requirements({ goTo }) {
  const [dau, setDau] = useState(5_000_000);
  const [reads, setReads] = useState(20);
  const [peak, setPeak] = useState(50);
  const avgQps = Math.round((dau * reads) / 86400);
  return (
    <>
      <div className="two-col">
        <div>
          <div className="mini-head">Functional: “users should be able to…”</div>
          <ol className="plain">
            <li>view an event (show, venue, available seats)</li>
            <li>search for events</li>
            <li>book tickets</li>
          </ol>
          <p className="small muted">Out of scope: reselling, admin tools, dynamic pricing.</p>
        </div>
        <div>
          <div className="mini-head">Non-functional (each one gets a deep dive later)</div>
          <ul className="plain">
            {NFRS.map((n) => (
              <li key={n.text}>
                {n.text}{" "}
                <button className="chip info as-button" onClick={() => goTo(n.lab)}>
                  {n.tag} →
                </button>
              </li>
            ))}
          </ul>
        </div>
      </div>
      <div className="mini-head">Back-of-envelope (only if it changes the design)</div>
      <div className="form-row compact">
        <div className="field">
          <label>Daily active users</label>
          <input type="number" value={dau} onChange={(e) => setDau(Number(e.target.value))} />
        </div>
        <div className="field">
          <label>Reads / user / day</label>
          <input type="number" value={reads} onChange={(e) => setReads(Number(e.target.value))} />
        </div>
        <div className="field">
          <label>Peak multiplier (on-sale moment)</label>
          <input type="number" value={peak} onChange={(e) => setPeak(Number(e.target.value))} />
        </div>
      </div>
      <Callout tone={avgQps * peak > 10000 ? "warn" : "info"}>
        ≈ {avgQps.toLocaleString()} read QPS on average, ≈ {(avgQps * peak).toLocaleString()} QPS at peak.{" "}
        {avgQps * peak > 10000
          ? "That's more than one database can serve, so this justifies a cache and read replicas. Here the math changes the design."
          : "One well-indexed database handles this. Don't over-engineer."}
      </Callout>
    </>
  );
}

function Entities({ runRequest }) {
  const [schema, setSchema] = useState(null);
  useEffect(() => {
    runRequest("GET", "/api/meta/schema", "meta.schema").then((tx) => tx.ok && setSchema(tx.responseBody));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  if (!schema) return <p className="muted">loading entities…</p>;
  return (
    <>
      <p className="small muted">
        Pulled live from <code>models.py</code>. In the interview, list just the nouns; the fields come later as the design
        needs them.
      </p>
      <div className="entity-row">
        {schema.map((e) => (
          <div key={e.name} className="entity">
            <strong>{e.name}</strong>
            <ul className="plain small">
              {e.columns.map((c) => (
                <li key={c.name}>
                  {c.primary_key ? "🔑 " : c.foreign_key ? "↗ " : ""}
                  {c.name}
                  {c.foreign_key && <span className="muted"> → {c.foreign_key}</span>}
                </li>
              ))}
            </ul>
          </div>
        ))}
      </div>
      <p className="small muted">Missing for a real Ticketmaster: User, Booking (to group tickets into one purchase), Performer.</p>
    </>
  );
}

function ApiStep({ runRequest }) {
  const [routes, setRoutes] = useState(null);
  const [filter, setFilter] = useState("core");
  useEffect(() => {
    runRequest("GET", "/api/meta/routes", "meta.routes").then((tx) => tx.ok && setRoutes(tx.responseBody));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  if (!routes) return <p className="muted">loading routes…</p>;
  const shown = routes.filter((r) =>
    filter === "core" ? /^\/api\/(venues|shows|tickets|v2)/.test(r.rule) : filter === "labs" ? r.rule.startsWith("/api/lab") || r.rule.startsWith("/api/meta") : true,
  );
  return (
    <>
      <div className="segmented">
        {["core", "labs", "all"].map((f) => (
          <button key={f} className={filter === f ? "active" : ""} onClick={() => setFilter(f)}>
            {f}
          </button>
        ))}
      </div>
      <p className="small muted">
        Flask's live URL map: {routes.length} routes. Resources are plural nouns, the verb is the HTTP method, and ids go in
        the path.
      </p>
      <table className="tight">
        <tbody>
          {shown.map((r) => (
            <tr key={r.rule + r.methods.join()}>
              <td className="nowrap">
                {r.methods.map((m) => (
                  <span key={m} className={`stub-method ${m}`}>
                    {m}
                  </span>
                ))}
              </td>
              <td>
                <code>{r.rule}</code>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </>
  );
}

function Flow() {
  return (
    <>
      <p className="small muted">Optional, for systems that are mostly data processing. A booking as a numbered flow:</p>
      <ol className="plain">
        <li>Fan opens the event page. GET /events/:id is served from the cache.</li>
        <li>Fan picks a seat. The booking service places a short hold (TTL ~10 min) so nobody else can take it.</li>
        <li>Fan pays with an idempotency key, so retries are safe.</li>
        <li>On success, the seat flips to sold in one transaction against the shard that owns this event.</li>
        <li>If the hold expires, the seat is released and the cached availability is invalidated.</li>
      </ol>
    </>
  );
}

function HighLevel({ goTo }) {
  const center = (b) => [b.x + BOX_W / 2, b.y + BOX_H / 2];
  const byId = Object.fromEntries(BOXES.map((b) => [b.id, b]));
  return (
    <>
      <p className="small muted">Click a component to open the lab that explores it.</p>
      <svg viewBox="0 0 610 220" className="hld-svg" role="img" aria-label="High-level architecture">
        {LINKS.map(([a, b]) => {
          const [x1, y1] = center(byId[a]);
          const [x2, y2] = center(byId[b]);
          return <line key={a + b} x1={x1} y1={y1} x2={x2} y2={y2} className="hld-link" />;
        })}
        {BOXES.map((b) => (
          <g key={b.id} className="hld-box" onClick={() => goTo(b.lab)} role="button" tabIndex={0}>
            <rect x={b.x} y={b.y} width={BOX_W} height={BOX_H} rx="4" />
            <text x={b.x + BOX_W / 2} y={b.y + BOX_H / 2 + 4} textAnchor="middle">
              {b.label}
            </text>
          </g>
        ))}
      </svg>
      <p className="small muted">
        Built one endpoint at a time: view event → Event Service → DB; book → Booking Service → DB. The cache and sharding
        are added during the deep dives, when a non-functional requirement calls for them.
      </p>
    </>
  );
}

function DeepDives({ goTo }) {
  const dives = [
    ["How do we prevent double booking?", "Booking is CP: quorum writes, or a single-leader row lock, plus seat holds with a TTL.", "cap"],
    ["Event pages under a 10M-fan surge?", "Cache-aside in front of the DB, request coalescing against stampedes, replicated hot keys.", "caching"],
    ["One DB can't hold every ticket.", "Shard by event_id so a booking touches one shard. Watch the mega-show hot spot.", "sharding"],
    ["Adding shards without a migration storm?", "Consistent hashing with virtual nodes moves only about 1/N of the keys.", "ring"],
    ["Flaky payment provider?", "Timeouts, retries with backoff and jitter, a circuit breaker, and idempotency keys.", "networking"],
  ];
  return (
    <div className="dive-grid">
      {dives.map(([q, a, lab]) => (
        <button key={q} className="dive" onClick={() => goTo(lab)}>
          <strong>{q}</strong>
          <span className="small muted">{a}</span>
          <span className="lab-link">open lab →</span>
        </button>
      ))}
    </div>
  );
}

export default function DeliveryLab({ runRequest, goTo }) {
  const [step, setStep] = useState(0);
  const [elapsed, setElapsed] = useState(0);
  const [running, setRunning] = useState(false);

  useEffect(() => {
    if (!running) return undefined;
    const id = setInterval(() => setElapsed((s) => s + 1), 1000);
    return () => clearInterval(id);
  }, [running]);

  const total = STEPS.reduce((a, s) => a + s.minutes, 0);
  const budgetEnd = STEPS.slice(0, step + 1).reduce((a, s) => a + s.minutes, 0) * 60;
  const over = running && elapsed > budgetEnd;
  const current = STEPS[step];

  return (
    <LabShell title="Delivery Framework" article="in-a-hurry/delivery" ideas={IDEAS}>
      <div className="timebar">
        {STEPS.map((s, i) => (
          <button
            key={s.id}
            className={`timebar-seg ${i === step ? "active" : ""} ${i < step ? "done" : ""}`}
            style={{ flexGrow: s.minutes }}
            onClick={() => setStep(i)}
          >
            <span>
              {i + 1}. {s.label}
              {s.optional ? "*" : ""}
            </span>
            <span className="muted">{s.minutes}m</span>
          </button>
        ))}
      </div>
      <div className="form-row compact">
        <button className="btn" onClick={() => setRunning((r) => !r)}>
          {running ? "Pause" : elapsed ? "Resume" : "Start practice timer"}
        </button>
        <span className={over ? "bad-text" : "muted"}>
          {Math.floor(elapsed / 60)}:{String(elapsed % 60).padStart(2, "0")} / {total}:00
          {over && ` (over budget for "${current.label}", move on!)`}
        </span>
        {elapsed > 0 && (
          <button
            className="btn-quiet"
            onClick={() => {
              setElapsed(0);
              setRunning(false);
            }}
          >
            reset timer
          </button>
        )}
      </div>

      <Panel
        title={`${step + 1} · ${current.label} (~${current.minutes} min)`}
        actions={
          <>
            <button className="btn" disabled={step === 0} onClick={() => setStep(step - 1)}>
              ← Back
            </button>
            <button className="btn btn-primary" disabled={step === STEPS.length - 1} onClick={() => setStep(step + 1)}>
              Next →
            </button>
          </>
        }
      >
        {current.id === "req" && <Requirements goTo={goTo} />}
        {current.id === "entities" && <Entities runRequest={runRequest} />}
        {current.id === "api" && <ApiStep runRequest={runRequest} />}
        {current.id === "flow" && <Flow />}
        {current.id === "hld" && <HighLevel goTo={goTo} />}
        {current.id === "deep" && <DeepDives goTo={goTo} />}
      </Panel>
    </LabShell>
  );
}
