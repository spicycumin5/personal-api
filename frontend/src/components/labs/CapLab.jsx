import { useState } from "react";
import LabShell, { Callout, Panel, Stat } from "./LabShell";
import useLabState from "./useLabState";

const IDEAS = [
  "Network partitions will happen in any distributed system, so the real choice is Consistency or Availability while a partition lasts.",
  "Choose consistency when stale data would be a disaster: ticket booking, inventory, payments. No two fans should get the same seat.",
  "Choose availability when slightly stale data is fine: browsing events, reviews, social feeds.",
  "Between strong and eventual consistency there are other levels, such as read-your-own-writes and causal consistency.",
  "Real systems mix both. Ticketmaster can make booking CP and browsing AP.",
];

const FANS = [
  { name: "Alice", defaultReplica: "us-east", cls: "fan-a" },
  { name: "Bob", defaultReplica: "eu", cls: "fan-b" },
];
const fanClass = (holder) => FANS.find((f) => f.name === holder)?.cls ?? "fan-other";

function ReplicaCard({ replica, seatIds, onToggle, partitioned }) {
  return (
    <div className={`replica ${replica.isolated ? "isolated" : ""}`}>
      <div className="replica-head">
        <strong>{replica.name}</strong>
        <button className={replica.isolated ? "btn btn-primary" : "btn"} onClick={onToggle}>
          {replica.isolated ? "reconnect" : "cut off"}
        </button>
      </div>
      <div className="muted small">
        can reach: {replica.reachable.join(", ")}
        {partitioned && replica.reachable.length < 2 && " (no quorum)"}
      </div>
      <div className="seat-grid">
        {seatIds.map((seat) => {
          const s = replica.seats[seat];
          return (
            <div key={seat} className={`seat ${s ? fanClass(s.holder) : ""}`} title={s ? `${seat}: ${s.holder} (v${s.ts})` : `${seat}: free`}>
              {seat}
              {s && <span className="seat-holder">{s.holder[0]}</span>}
            </div>
          );
        })}
      </div>
    </div>
  );
}

export default function CapLab({ runRequest }) {
  const [state, refresh, setState] = useLabState(runRequest, "/api/lab/cap/state", { pollMs: 800 });
  const [fanReplica, setFanReplica] = useState({ Alice: "us-east", Bob: "eu" });
  const [seat, setSeat] = useState("A3");
  const [results, setResults] = useState({});
  const [read, setRead] = useState({ replica: "eu", level: "eventual", client: "Alice" });
  const [readResult, setReadResult] = useState(null);

  if (!state) return <p className="muted">Loading replicas…</p>;
  const partitioned = state.replicas.some((r) => r.isolated);

  async function configure(patch) {
    const tx = await runRequest("POST", "/api/lab/cap/config", null, patch);
    if (tx.ok) setState(tx.responseBody);
  }

  async function toggleIsolation(name) {
    const isolated = state.replicas.filter((r) => r.isolated).map((r) => r.name);
    const next = isolated.includes(name) ? isolated.filter((n) => n !== name) : [...isolated, name];
    const tx = next.length
      ? await runRequest("POST", "/api/lab/cap/partition", "cap.partition", { isolate: next })
      : await runRequest("POST", "/api/lab/cap/heal", "cap.heal");
    if (tx.ok) setState(tx.responseBody);
  }

  async function heal() {
    const tx = await runRequest("POST", "/api/lab/cap/heal", "cap.heal");
    if (tx.ok) setState(tx.responseBody);
  }

  async function book(fan) {
    const tx = await runRequest("POST", "/api/lab/cap/book", "cap.book", {
      replica: fanReplica[fan],
      client: fan,
      seat,
    });
    setResults((prev) => ({ ...prev, [fan]: tx }));
    refresh();
  }

  async function bothBuy() {
    await Promise.all(FANS.map((f) => book(f.name)));
  }

  async function doRead() {
    const qs = new URLSearchParams(read).toString();
    const tx = await runRequest("GET", `/api/lab/cap/seats?${qs}`, "cap.read");
    setReadResult(tx);
  }

  async function reset() {
    const tx = await runRequest("POST", "/api/lab/cap/reset", null, { mode: state.mode });
    if (tx.ok) setState(tx.responseBody);
    setResults({});
    setReadResult(null);
  }

  // What did this run of the experiment give up?
  const refusals = Object.values(results).filter((tx) => tx.status === 503).length;
  const verdict = state.conflicts.length
    ? { tone: "bad", text: "Availability kept, Consistency lost. Both sides sold, and the seat was double-booked." }
    : refusals
      ? { tone: "warn", text: "Consistency kept, Availability lost. The minority side refused to sell rather than risk a double booking." }
      : partitioned
        ? { tone: "info", text: "Partition active. Have both fans try to buy the same seat from opposite sides." }
        : { tone: "good", text: "No partition: you get Consistency and Availability. CAP only forces a choice while the network is split." };

  return (
    <LabShell title="CAP Theorem" article="core-concepts/cap-theorem" ideas={IDEAS} onReset={reset}>
      <div className="form-row compact">
        <div className="segmented">
          {["CP", "AP"].map((m) => (
            <button key={m} className={state.mode === m ? "active" : ""} onClick={() => configure({ mode: m })}>
              {m === "CP" ? "CP: quorum writes" : "AP: local writes + async replication"}
            </button>
          ))}
        </div>
        <div className="field">
          <label>Replication lag: {(state.lag_ms / 1000).toFixed(1)}s</label>
          <input type="range" min="0" max="8000" step="500" value={state.lag_ms} onChange={(e) => configure({ lag_ms: Number(e.target.value) })} />
        </div>
        <button className="btn" onClick={heal} disabled={!partitioned}>
          Heal network
        </button>
      </div>

      <div className="stat-row">
        <Stat label="partition" value={partitioned ? "YES" : "no"} tone={partitioned ? "bad" : "good"} />
        <Stat label="replication msgs in flight" value={state.pending_replication} />
        <Stat label="seats that differ" value={state.divergent_seats.length} tone={state.divergent_seats.length ? "warn" : ""} />
        <Stat label="double bookings" value={state.conflicts.length} tone={state.conflicts.length ? "bad" : "good"} />
      </div>

      <div className="replica-row">
        {state.replicas.map((r) => (
          <ReplicaCard
            key={r.name}
            replica={r}
            seatIds={state.seat_ids}
            partitioned={partitioned}
            onToggle={() => toggleIsolation(r.name)}
          />
        ))}
      </div>

      <Panel title="Two fans, one seat" hint="Cut off eu, then have Alice (us-east) and Bob (eu) buy the same seat. Run it once in CP and once in AP.">
        <div className="form-row compact">
          <div className="field">
            <label>Seat</label>
            <select value={seat} onChange={(e) => setSeat(e.target.value)}>
              {state.seat_ids.map((s) => (
                <option key={s}>{s}</option>
              ))}
            </select>
          </div>
          {FANS.map((f) => (
            <div className="field" key={f.name}>
              <label>
                <span className={`dot ${f.cls}`} /> {f.name} connects to
              </label>
              <select value={fanReplica[f.name]} onChange={(e) => setFanReplica({ ...fanReplica, [f.name]: e.target.value })}>
                {state.replicas.map((r) => (
                  <option key={r.name}>{r.name}</option>
                ))}
              </select>
            </div>
          ))}
          {FANS.map((f) => (
            <button key={f.name} className="btn" onClick={() => book(f.name)}>
              {f.name} buys
            </button>
          ))}
          <button className="btn btn-primary" onClick={bothBuy}>
            Both buy at once
          </button>
        </div>
        <div className="two-col">
          {FANS.map((f) => {
            const tx = results[f.name];
            if (!tx) return <div key={f.name} className="muted small">{f.name} hasn't tried yet.</div>;
            return (
              <Callout key={f.name} tone={tx.ok ? "good" : tx.status === 503 ? "warn" : "bad"}>
                <strong>
                  {f.name} → {tx.status}
                </strong>{" "}
                {tx.ok ? `got ${tx.requestBody.seat} via ${tx.responseHeaders["x-replica"]}` : tx.responseBody?.error}
              </Callout>
            );
          })}
        </div>
        <Callout tone={verdict.tone}>
          <strong>Verdict:</strong> {verdict.text}
        </Callout>
        {state.conflicts.map((c) => (
          <Callout key={`${c.seat}-${c.loser}`} tone="bad">
            Double booking on <strong>{c.seat}</strong>: {c.winner} keeps it, {c.loser} gets refunded ({c.resolution}).
          </Callout>
        ))}
      </Panel>

      <Panel title="Read consistency levels" hint="Book a seat as Alice on us-east, then read from eu right away. Compare eventual, read-your-writes and strong.">
        <div className="form-row compact">
          <div className="field">
            <label>Read from</label>
            <select value={read.replica} onChange={(e) => setRead({ ...read, replica: e.target.value })}>
              {state.replicas.map((r) => (
                <option key={r.name}>{r.name}</option>
              ))}
            </select>
          </div>
          <div className="field">
            <label>Level</label>
            <select value={read.level} onChange={(e) => setRead({ ...read, level: e.target.value })}>
              <option value="eventual">eventual (local replica)</option>
              <option value="read_your_writes">read-your-writes</option>
              <option value="strong">strong (quorum)</option>
            </select>
          </div>
          <div className="field">
            <label>As client</label>
            <select value={read.client} onChange={(e) => setRead({ ...read, client: e.target.value })}>
              {FANS.map((f) => (
                <option key={f.name}>{f.name}</option>
              ))}
            </select>
          </div>
          <button className="btn" onClick={doRead}>
            GET seats
          </button>
        </div>
        {readResult &&
          (readResult.ok ? (
            <Callout tone="info">
              Served by <strong>{readResult.responseBody.served_by}</strong>. Sold seats seen:{" "}
              {Object.entries(readResult.responseBody.seats)
                .filter(([, v]) => v)
                .map(([k, v]) => `${k}→${v.holder}`)
                .join(", ") || "none"}
            </Callout>
          ) : (
            <Callout tone="warn">
              {readResult.status}: {readResult.responseBody?.error}
            </Callout>
          ))}
      </Panel>

      <Panel title="Event log">
        <ul className="event-log">
          {state.events.length === 0 && <li className="muted">nothing yet</li>}
          {state.events.map((e, i) => (
            <li key={`${e.t}-${i}`} className={e.msg.includes("DOUBLE") ? "bad-text" : e.msg.includes("REJECTED") ? "warn-text" : ""}>
              {e.msg}
            </li>
          ))}
        </ul>
      </Panel>
    </LabShell>
  );
}
