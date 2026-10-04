import { useEffect, useState } from "react";
import LabShell, { Bars, Callout, Panel } from "./LabShell";
import useLabState from "./useLabState";

const IDEAS = [
  "Default to a relational database: ACID transactions, joins and constraints. Switch only when there's a clear reason.",
  "Let access patterns drive the schema. Every hot query needs an index (GET /shows/{id}/tickets needs ticket.show_id).",
  "Use system-generated primary keys and connect entities with foreign keys (Venue 1─* Show 1─* Ticket).",
  "Start normalized. Denormalize, or cache a denormalized view, only when reads demand it, and accept the work of keeping copies in sync.",
  "Document stores embed related data in one record. Key-value stores do fast lookups. Wide-column stores handle huge write volumes.",
];

const DB_TYPES = [
  ["Relational (Postgres)", "default; joins, transactions, constraints, booking + inventory"],
  ["Document (MongoDB)", "flexible, nested records read as a whole (an event page)"],
  ["Key-value (Redis, DynamoDB)", "lookups by key only (sessions, seat holds, caches)"],
  ["Wide-column (Cassandra)", "massive write throughput, time-series (ticket scan logs)"],
  ["Graph (Neo4j)", "deep relationship traversal; rarely needed"],
];

// ---------- ER diagram from the live SQLAlchemy models ----------

const BOX_W = 200;
const ROW_H = 20;
const GAP = 60;

function ErDiagram({ entities }) {
  // Order parents before children so FK arrows point left (Venue → Show → Ticket).
  const depth = {};
  const byTable = Object.fromEntries(entities.map((e) => [e.table, e]));
  const depthOf = (e, seen = new Set()) => {
    if (depth[e.table] !== undefined) return depth[e.table];
    if (seen.has(e.table)) return 0;
    seen.add(e.table);
    const parents = e.columns.filter((c) => c.foreign_key).map((c) => byTable[c.foreign_key.split(".")[0]]).filter(Boolean);
    depth[e.table] = parents.length ? 1 + Math.max(...parents.map((p) => depthOf(p, seen))) : 0;
    return depth[e.table];
  };
  const ordered = [...entities].sort((a, b) => depthOf(a) - depthOf(b));
  const layout = Object.fromEntries(ordered.map((e, i) => [e.table, { x: 10 + i * (BOX_W + GAP), y: 10, e }]));
  const height = 30 + ROW_H * Math.max(...entities.map((e) => e.columns.length)) + 20;
  const width = 10 + ordered.length * (BOX_W + GAP);

  const colY = (table, colName) => {
    const idx = layout[table].e.columns.findIndex((c) => c.name === colName);
    return layout[table].y + 28 + idx * ROW_H + ROW_H / 2;
  };

  return (
    <svg viewBox={`0 0 ${width} ${height}`} className="er-svg" role="img" aria-label="Entity relationship diagram">
      {ordered.map((e) => {
        const { x, y } = layout[e.table];
        return (
          <g key={e.table}>
            <rect x={x} y={y} width={BOX_W} height={28 + ROW_H * e.columns.length + 6} rx="4" className="er-box" />
            <text x={x + 10} y={y + 19} className="er-title">
              {e.name}
            </text>
            {e.columns.map((c, i) => (
              <g key={c.name}>
                <text x={x + 10} y={y + 28 + i * ROW_H + 14} className={`er-col ${c.primary_key ? "pk" : c.foreign_key ? "fk" : ""}`}>
                  {c.primary_key ? "PK " : c.foreign_key ? "FK " : "   "}
                  {c.name}
                </text>
                <text x={x + BOX_W - 10} y={y + 28 + i * ROW_H + 14} textAnchor="end" className="er-type">
                  {c.type.toLowerCase()}
                  {c.nullable ? "?" : ""}
                </text>
              </g>
            ))}
          </g>
        );
      })}
      {ordered.flatMap((e) =>
        e.columns
          .filter((c) => c.foreign_key && layout[c.foreign_key.split(".")[0]])
          .map((c) => {
            const [targetTable, targetCol] = c.foreign_key.split(".");
            const from = { x: layout[e.table].x, y: colY(e.table, c.name) };
            const to = { x: layout[targetTable].x + BOX_W, y: colY(targetTable, targetCol) };
            const mid = (from.x + to.x) / 2;
            return (
              <g key={`${e.table}.${c.name}`}>
                <path d={`M ${from.x} ${from.y} C ${mid} ${from.y}, ${mid} ${to.y}, ${to.x} ${to.y}`} className="er-link" />
                <text x={to.x + 6} y={to.y - 5} className="er-card">
                  1
                </text>
                <text x={from.x - 12} y={from.y - 5} className="er-card">
                  *
                </text>
              </g>
            );
          }),
      )}
    </svg>
  );
}

export default function DataModelingLab({ runRequest }) {
  const [schema, setSchema] = useState(null);
  const [state, , setState] = useLabState(runRequest, "/api/lab/data/state");
  const [size, setSize] = useState(20000);
  const [runs, setRuns] = useState([]);
  const [busy, setBusy] = useState(false);
  const [readRes, setReadRes] = useState(null);
  const [renameRes, setRenameRes] = useState(null);
  const [backfillRes, setBackfillRes] = useState(null);
  const [docShow, setDocShow] = useState(42);
  const [doc, setDoc] = useState(null);

  useEffect(() => {
    runRequest("GET", "/api/meta/schema", "meta.schema").then((tx) => tx.ok && setSchema(tx.responseBody));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function generate() {
    setBusy(true);
    const tx = await runRequest("POST", "/api/lab/data/generate", "data.generate", { tickets: size });
    setBusy(false);
    if (tx.ok) {
      setState(tx.responseBody);
      setRuns([]);
      setReadRes(null);
      setRenameRes(null);
      setBackfillRes(null);
    }
  }

  async function toggleIndex() {
    const tx = await runRequest("POST", "/api/lab/data/index", "data.index", { on: !state.indexed });
    if (tx.ok) setState(tx.responseBody);
  }

  async function runQuery() {
    const tx = await runRequest("GET", "/api/lab/data/query?show_id=42", "data.query");
    if (tx.ok) setRuns((prev) => [tx.responseBody, ...prev].slice(0, 6));
  }

  async function readTicket() {
    const tx = await runRequest("GET", `/api/lab/data/tickets/${state.sample_ticket_id}`, "data.read");
    if (tx.ok) setReadRes(tx.responseBody);
  }

  async function rename() {
    const tx = await runRequest("PATCH", `/api/lab/data/venues/${state.sample_venue_id}`, "data.rename", {
      name: `Renamed Hall ${new Date().toLocaleTimeString([], { hour12: false })}`,
    });
    if (tx.ok) setRenameRes(tx.responseBody);
    readTicket();
  }

  async function backfill() {
    const tx = await runRequest("POST", "/api/lab/data/backfill", "data.backfill");
    if (tx.ok) setBackfillRes(tx.responseBody);
    readTicket();
  }

  async function loadDoc() {
    const tx = await runRequest("GET", `/api/lab/data/documents/${docShow}`, "data.document");
    if (tx.ok) setDoc(tx.responseBody);
  }

  const mismatch = readRes && readRes.normalized.row?.venue_name !== readRes.denormalized.row?.venue_name;

  return (
    <LabShell title="Data Modeling" article="core-concepts/data-modeling" ideas={IDEAS}>
      <Panel title="1 · The real schema" hint="Drawn live from the SQLAlchemy models in models.py via GET /api/meta/schema.">
        {schema ? <ErDiagram entities={schema} /> : <p className="muted">loading…</p>}
        <table className="tight">
          <tbody>
            {DB_TYPES.map(([t, when]) => (
              <tr key={t}>
                <td>{t}</td>
                <td className="muted">{when}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </Panel>

      {state && (
        <>
          <Panel
            title="2 · Indexes follow access patterns"
            hint={`A scratch in-memory SQLite copy with ${state.tickets.toLocaleString()} tickets across ${state.shows} shows (your real DB is untouched). Run the query, add the index, run it again.`}
          >
            <div className="form-row compact">
              <div className="field">
                <label>Tickets to generate</label>
                <select value={size} onChange={(e) => setSize(Number(e.target.value))}>
                  {[10000, 20000, 100000, 300000].map((n) => (
                    <option key={n} value={n}>
                      {n.toLocaleString()}
                    </option>
                  ))}
                </select>
              </div>
              <button className="btn" onClick={generate} disabled={busy}>
                {busy ? "generating…" : "Regenerate"}
              </button>
              <button className={state.indexed ? "btn btn-primary" : "btn"} onClick={toggleIndex}>
                {state.indexed ? "✓ index on ticket(show_id)" : "CREATE INDEX on ticket(show_id)"}
              </button>
              <button className="btn btn-primary" onClick={runQuery}>
                Run WHERE show_id = 42
              </button>
            </div>
            {runs.length > 0 && (
              <>
                <Bars
                  items={runs.map((r, i) => ({
                    label: `#${runs.length - i} ${r.indexed ? "indexed" : "no index"}`,
                    value: r.avg_ms,
                    tone: r.indexed ? "good" : "bad",
                    note: `· ${r.plan.join("; ")}`,
                  }))}
                  unit="ms"
                />
                <p className="small muted">
                  <code>SCAN</code> reads all {runs[0].table_rows.toLocaleString()} rows to find {runs[0].rows}.{" "}
                  <code>SEARCH … USING INDEX</code> jumps straight to them through a B-tree.
                </p>
              </>
            )}
          </Panel>

          <Panel
            title="3 · Normalized vs denormalized"
            hint="ticket_view stores the venue name on every ticket, so reads skip the join. Rename the venue and see what that costs."
          >
            <div className="form-row compact">
              <button className="btn" onClick={readTicket}>
                Read ticket #{state.sample_ticket_id} both ways
              </button>
              <button className="btn" onClick={rename}>
                Rename its venue (#{state.sample_venue_id})
              </button>
              <button className="btn" onClick={backfill}>
                Backfill denormalized copies
              </button>
            </div>
            {readRes && (
              <div className="two-col">
                <div>
                  <div className="mini-head">normalized (3-table JOIN)</div>
                  <pre className="code-block">{readRes.normalized.sql}</pre>
                  <div className="kv">venue_name: <strong>{readRes.normalized.row?.venue_name}</strong></div>
                </div>
                <div>
                  <div className="mini-head">denormalized (single row)</div>
                  <pre className="code-block">{readRes.denormalized.sql}</pre>
                  <div className={`kv ${mismatch ? "bad-text" : ""}`}>
                    venue_name: <strong>{readRes.denormalized.row?.venue_name}</strong> {mismatch && "← STALE"}
                  </div>
                </div>
              </div>
            )}
            {renameRes && (
              <Callout tone="warn">
                Normalized: updated {renameRes.rows_updated} row. Denormalized: {renameRes.denormalized_rows_now_stale} ticket rows
                still show the old name.
              </Callout>
            )}
            {backfillRes && (
              <Callout tone="info">
                Backfill rewrote {backfillRes.rows_rewritten} rows in {backfillRes.elapsed_ms}ms. That's the price of fast,
                join-free reads.
              </Callout>
            )}
          </Panel>

          <Panel title="4 · Relational rows vs one document" hint="The same show as normalized tables vs a single embedded document, the shape a document store keeps.">
            <div className="form-row compact">
              <div className="field">
                <label>Show id (1–{state.shows})</label>
                <input type="number" min="1" max={state.shows} value={docShow} onChange={(e) => setDocShow(Number(e.target.value))} />
              </div>
              <button className="btn" onClick={loadDoc}>
                Load
              </button>
            </div>
            {doc && (
              <div className="two-col">
                <div>
                  <div className="mini-head">relational: 3 tables, joined by ids</div>
                  <pre className="code-block">{JSON.stringify(doc.relational, null, 2)}</pre>
                </div>
                <div>
                  <div className="mini-head">document: one read, no joins</div>
                  <pre className="code-block">{JSON.stringify(doc.document, null, 2)}</pre>
                </div>
              </div>
            )}
          </Panel>
        </>
      )}
    </LabShell>
  );
}
