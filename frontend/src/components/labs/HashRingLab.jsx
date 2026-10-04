import { useState } from "react";
import LabShell, { Bars, Callout, Panel, Stat } from "./LabShell";
import useLabState from "./useLabState";

const IDEAS = [
  "Modulo hashing (hash % N) remaps almost every key when N changes, which means a huge migration.",
  "Consistent hashing puts nodes and keys on one ring; a key belongs to the first node clockwise from it.",
  "Adding or removing a node only moves the keys in the arc next to it, roughly 1/N of the data.",
  "With one position per node, the arcs are uneven. Virtual nodes give each server many positions, which evens out the load.",
  "Cassandra, DynamoDB and CDNs use this to scale without re-shuffling everything.",
];

// Categorical palette (dark steps), validated against the app surface #121218.
// Colour follows the node's name (db-N -> slot N), never its position in a list.
const NODE_COLORS = ["#3987e5", "#d95926", "#199e70", "#c98500", "#d55181", "#008300", "#9085e9", "#e66767"];
const nodeColor = (name) => NODE_COLORS[(Number(name.split("-")[1]) - 1) % NODE_COLORS.length] ?? "#a7a2b3";

const SIZE = 420;
const C = SIZE / 2;
const R_RING = 165;
const R_KEYS = 138;

const angleOf = (pos, ringSize) => (pos / ringSize) * 360;
function point(angleDeg, r) {
  const t = (angleDeg * Math.PI) / 180;
  return [C + r * Math.sin(t), C - r * Math.cos(t)];
}
function arcPath(a1, a2, r) {
  const span = (a2 - a1 + 360) % 360 || 360;
  const [x1, y1] = point(a1, r);
  const [x2, y2] = point(a1 + Math.min(span, 359.99), r);
  return `M ${x1} ${y1} A ${r} ${r} 0 ${span > 180 ? 1 : 0} 1 ${x2} ${y2}`;
}

function Ring({ state, moved, highlight, onHover }) {
  const { positions, keys, ring_size: ringSize } = state;
  return (
    <svg viewBox={`0 0 ${SIZE} ${SIZE}`} className="ring-svg" role="img" aria-label="Consistent hash ring">
      <circle cx={C} cy={C} r={R_RING} fill="none" stroke="var(--hairline)" strokeWidth="14" />
      {/* Ownership arcs: (previous vnode, this vnode] belongs to this vnode's node. */}
      {positions.map((p, i) => {
        const prev = positions[(i - 1 + positions.length) % positions.length];
        return (
          <path
            key={`arc-${p.position}`}
            d={arcPath(angleOf(prev.position, ringSize), angleOf(p.position, ringSize), R_RING)}
            stroke={nodeColor(p.node)}
            strokeWidth="14"
            fill="none"
            opacity={highlight && highlight.node !== p.node ? 0.25 : 0.9}
          />
        );
      })}
      {/* 2px surface gap at each vnode boundary */}
      {positions.map((p) => {
        const a = angleOf(p.position, ringSize);
        const [x1, y1] = point(a, R_RING - 9);
        const [x2, y2] = point(a, R_RING + 9);
        return <line key={`tick-${p.position}`} x1={x1} y1={y1} x2={x2} y2={y2} stroke="var(--ink)" strokeWidth="2" />;
      })}
      {positions.length <= 16 &&
        positions.map((p) => {
          const [x, y] = point(angleOf(p.position, ringSize), R_RING + 24);
          return (
            <text key={`lbl-${p.position}`} x={x} y={y} className="ring-label" textAnchor="middle" dominantBaseline="middle">
              {p.node}
            </text>
          );
        })}
      {keys.map((k) => {
        const [x, y] = point(angleOf(k.position, ringSize), R_KEYS);
        const isMoved = moved.has(k.key);
        return (
          <circle
            key={k.key}
            cx={x}
            cy={y}
            r={isMoved ? 5 : 3}
            fill={nodeColor(k.node)}
            stroke={isMoved ? "#ffffff" : "var(--ink)"}
            strokeWidth={isMoved ? 1.5 : 1}
            className={isMoved ? "moved-key" : ""}
            onMouseEnter={() => onHover(k)}
            onMouseLeave={() => onHover(null)}
          />
        );
      })}
      {highlight && (
        <g>
          <path
            d={arcPath(angleOf(highlight.hash, ringSize), angleOf(highlight.vnode_position, ringSize), R_KEYS - 14)}
            stroke="#ffffff"
            strokeWidth="2"
            fill="none"
            strokeDasharray="4 3"
          />
          <circle cx={point(angleOf(highlight.hash, ringSize), R_KEYS - 14)[0]} cy={point(angleOf(highlight.hash, ringSize), R_KEYS - 14)[1]} r="6" fill="#ffffff" />
        </g>
      )}
      <text x={C} y={C - 8} textAnchor="middle" className="ring-center">
        {keys.length} keys
      </text>
      <text x={C} y={C + 12} textAnchor="middle" className="ring-center-sub">
        0 … 2³² (clockwise)
      </text>
    </svg>
  );
}

export default function HashRingLab({ runRequest }) {
  const [state, refresh, setState] = useLabState(runRequest, "/api/lab/ring/state");
  const [lastChange, setLastChange] = useState(null);
  const [moved, setMoved] = useState(new Set());
  const [lookupKey, setLookupKey] = useState("ticket:42");
  const [highlight, setHighlight] = useState(null);
  const [hover, setHover] = useState(null);
  const [error, setError] = useState(null);

  if (!state) return <p className="muted">Loading hash ring…</p>;

  function applyChange(tx) {
    if (!tx.ok) {
      setError(tx.responseBody?.error ?? "Request failed");
      return;
    }
    setError(null);
    setState(tx.responseBody.state);
    setLastChange(tx.responseBody);
    setMoved(new Set(tx.responseBody.moved_keys));
    setHighlight(null);
  }

  const addNode = async () => applyChange(await runRequest("POST", "/api/lab/ring/nodes", "ring.add", {}));
  const removeNode = async (name) =>
    applyChange(await runRequest("DELETE", `/api/lab/ring/nodes/${name}`, "ring.remove"));

  async function setVnodes(v) {
    const tx = await runRequest("POST", "/api/lab/ring/vnodes", null, { vnodes: v });
    if (tx.ok) {
      setState(tx.responseBody);
      setMoved(new Set());
      setLastChange(null);
    }
  }

  async function lookup(e) {
    e.preventDefault();
    const tx = await runRequest("GET", `/api/lab/ring/lookup?key=${encodeURIComponent(lookupKey)}`, "ring.lookup");
    if (tx.ok) setHighlight(tx.responseBody);
  }

  async function reset() {
    await runRequest("POST", "/api/lab/ring/reset", null);
    setMoved(new Set());
    setLastChange(null);
    setHighlight(null);
    refresh();
  }

  return (
    <LabShell title="Consistent Hashing" article="core-concepts/consistent-hashing" ideas={IDEAS} onReset={reset}>
      {error && <div className="error-banner">{error}</div>}

      <div className="ring-layout">
        <div className="ring-wrap">
          <Ring state={state} moved={moved} highlight={highlight} onHover={setHover} />
          <div className="ring-hover">
            {hover ? (
              <>
                <strong>{hover.key}</strong> → hash {hover.position.toLocaleString()} → <span style={{ color: nodeColor(hover.node) }}>●</span>{" "}
                {hover.node}
              </>
            ) : (
              <span className="muted">hover a key dot</span>
            )}
          </div>
        </div>

        <div className="ring-side">
          <Panel title="Nodes" hint="Each colour is one database. Remove one to simulate a failure.">
            <ul className="node-list">
              {state.nodes.map((n) => (
                <li key={n}>
                  <span className="swatch" style={{ background: nodeColor(n) }} />
                  {n}
                  <span className="muted small">{state.load.find((l) => l.node === n)?.keys} keys</span>
                  <button className="btn-danger" onClick={() => removeNode(n)} disabled={state.nodes.length === 1}>
                    remove
                  </button>
                </li>
              ))}
            </ul>
            <button className="btn btn-primary" onClick={addNode} disabled={state.nodes.length >= 8}>
              + Add node
            </button>
          </Panel>

          <Panel title={`Virtual nodes per server: ${state.vnodes}`}>
            <input
              type="range"
              min="1"
              max="100"
              value={state.vnodes}
              onChange={(e) => setVnodes(Number(e.target.value))}
              className="full"
            />
            <div className="stat-row">
              <Stat label="ideal keys / node" value={state.balance.ideal} />
              <Stat label="std dev" value={state.balance.stddev} tone={state.balance.stddev > state.balance.ideal * 0.3 ? "bad" : "good"} />
              <Stat label="busiest ÷ ideal" value={`${state.balance.max_over_ideal}×`} />
            </div>
          </Panel>

          <Panel title="Look up a key">
            <form className="form-row compact" onSubmit={lookup}>
              <div className="field">
                <label>Key</label>
                <input value={lookupKey} onChange={(e) => setLookupKey(e.target.value)} />
              </div>
              <button className="btn" type="submit">
                Walk clockwise
              </button>
            </form>
            {highlight && (
              <p className="small">
                <code>{highlight.key}</code> hashes to {highlight.hash.toLocaleString()} → first vnode clockwise is at{" "}
                {highlight.vnode_position.toLocaleString()} → <strong style={{ color: nodeColor(highlight.node) }}>{highlight.node}</strong>.
                With modulo it would be on <strong>{highlight.modulo_node}</strong>.
              </p>
            )}
          </Panel>
        </div>
      </div>

      {lastChange && (
        <Panel title={`${lastChange.action === "add" ? "Added" : "Removed"} ${lastChange.node}: how much data moved?`}>
          <Bars
            items={[
              { label: "consistent hashing", value: lastChange.moved_pct, tone: "good" },
              { label: "hash % N", value: lastChange.modulo_moved_pct, tone: "bad" },
            ]}
            max={100}
            unit="%"
          />
          <Callout tone="info">
            {lastChange.moved_keys.length} of {state.keys.length} keys changed owner (highlighted with white rings on the
            ring). Modulo hashing would have moved {lastChange.modulo_moved_pct}% for the same change.
          </Callout>
        </Panel>
      )}

      <Panel title="Keys per node">
        <Bars
          items={state.load.map((l) => ({ label: l.node, value: l.keys }))}
          max={Math.max(...state.load.map((l) => l.keys), state.balance.ideal * 2)}
        />
      </Panel>
    </LabShell>
  );
}
