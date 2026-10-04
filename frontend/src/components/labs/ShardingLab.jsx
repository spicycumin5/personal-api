import { useState } from "react";
import LabShell, { Bars, Callout, Panel, Stat } from "./LabShell";
import useLabState from "./useLabState";

const IDEAS = [
  "A good shard key has high cardinality and matches your main access pattern. A boolean or a status field is a bad key.",
  "Range sharding keeps neighbouring keys together but creates hot spots. Hash sharding spreads load evenly. A directory (lookup table) is the most flexible but adds a lookup on every request.",
  "A query that doesn't include the shard key has to scatter to every shard and gather the results.",
  "One celebrity show can overload a single shard. A compound key, or splitting out the hot key, spreads that load.",
  "Changing the number of shards with hash % N moves most of the rows. Consistent hashing fixes this.",
];

const KEY_LABELS = {
  show_id: "show_id",
  ticket_id: "ticket_id",
  venue_city: "venue_city",
  status: "status (low cardinality!)",
  "show_id+seat_section": "show_id + seat_section (compound)",
};

export default function ShardingLab({ runRequest, goTo }) {
  const [state, refresh, setState] = useLabState(runRequest, "/api/lab/shard/state");
  const [movedPct, setMovedPct] = useState(null);
  const [queryShow, setQueryShow] = useState("");
  const [queryTicket, setQueryTicket] = useState("10");
  const [query, setQuery] = useState(null);
  const [traffic, setTraffic] = useState(null);

  if (!state) return <p className="muted">Loading shard cluster…</p>;
  const { config, distribution } = state;

  async function configure(patch) {
    const tx = await runRequest("POST", "/api/lab/shard/configure", "shard.configure", { ...config, ...patch });
    if (tx.ok) {
      setState(tx.responseBody);
      setMovedPct({ pct: tx.responseBody.rows_moved_pct, change: patch });
      setQuery(null);
      setTraffic(null);
    }
  }

  async function runQuery(kind) {
    const qs = kind === "show" ? `show_id=${queryShow || state.mega_show}` : `ticket_id=${queryTicket}`;
    const tx = await runRequest("GET", `/api/lab/shard/query?${qs}`, "shard.query");
    if (tx.ok) setQuery(tx.responseBody);
  }

  async function runTraffic() {
    const tx = await runRequest("POST", "/api/lab/shard/traffic", "shard.traffic", { requests: 5000 });
    if (tx.ok) setTraffic(tx.responseBody);
  }

  async function reset() {
    await runRequest("POST", "/api/lab/shard/reset", null);
    setMovedPct(null);
    setQuery(null);
    setTraffic(null);
    refresh();
  }

  const shards = Array.from({ length: config.num_shards }, (_, i) => i);
  const avg = state.total_rows / config.num_shards;

  return (
    <LabShell title="Sharding" article="core-concepts/sharding" ideas={IDEAS} onReset={reset}>
      <Panel
        title="1 · Partition the tickets table"
        hint={`${state.total_rows} tickets (your real ones plus synthetic). Show ${state.mega_show} is a Taylor Swift–sized mega show holding ~35% of all tickets.`}
      >
        <div className="form-row compact">
          <div className="field">
            <label>Shards: {config.num_shards}</label>
            <input type="range" min="1" max="12" value={config.num_shards} onChange={(e) => configure({ num_shards: Number(e.target.value) })} />
          </div>
          <div className="field">
            <label>Strategy</label>
            <select value={config.strategy} onChange={(e) => configure({ strategy: e.target.value })}>
              <option value="hash">hash (crc32 % N)</option>
              <option value="range">range</option>
              <option value="directory">directory (lookup table)</option>
            </select>
          </div>
          <div className="field">
            <label>Shard key</label>
            <select value={config.shard_key} onChange={(e) => configure({ shard_key: e.target.value })}>
              {Object.entries(KEY_LABELS).map(([k, label]) => (
                <option key={k} value={k}>
                  {label}
                </option>
              ))}
            </select>
          </div>
        </div>

        <div className="stat-row">
          <Stat label="distinct key values" value={distribution.distinct_key_values} tone={distribution.distinct_key_values < config.num_shards ? "bad" : ""} />
          <Stat label="biggest ÷ average" value={`${distribution.imbalance}×`} tone={distribution.imbalance > 1.5 ? "bad" : "good"} />
          {movedPct && <Stat label="rows moved by last change" value={`${movedPct.pct}%`} tone={movedPct.pct > 50 ? "bad" : ""} />}
        </div>

        <Bars
          items={distribution.sizes.map((n, i) => ({
            label: `shard ${i}`,
            value: n,
            tone: n > avg * 1.5 ? "bad" : n === 0 ? "dim" : "",
          }))}
          max={Math.max(...distribution.sizes, 1)}
          unit=" rows"
        />

        {distribution.distinct_key_values < config.num_shards && (
          <Callout tone="bad">
            Only {distribution.distinct_key_values} distinct values for {config.num_shards} shards, so some shards can never
            receive any data. That's what low cardinality means.
          </Callout>
        )}
        {movedPct?.change?.num_shards !== undefined && config.strategy === "hash" && (
          <Callout tone="warn">
            Resharding with hash % N moved {movedPct.pct}% of rows across the network.{" "}
            <button className="btn-quiet" onClick={() => goTo("ring")}>
              See how consistent hashing avoids this →
            </button>
          </Callout>
        )}
        {state.range_bounds && (
          <p className="small muted">
            Range lower bounds per shard: {state.range_bounds.map((b, i) => `shard ${i} ≥ ${b}`).join(" · ")}
          </p>
        )}
        {state.directory_sample && (
          <p className="small muted">
            Directory (first entries): {state.directory_sample.map((d) => `${d.value}→${d.shard}`).join(" · ")}. Every
            request needs this lookup first.
          </p>
        )}
      </Panel>

      <Panel title="2 · Route a query" hint="Does the query include the shard key? If not, every shard has to answer.">
        <div className="form-row compact">
          <div className="field">
            <label>Tickets for show</label>
            <select value={queryShow || state.mega_show} onChange={(e) => setQueryShow(e.target.value)}>
              {state.show_ids.map((id) => (
                <option key={id} value={id}>
                  show {id}
                  {id === state.mega_show ? " (mega)" : ""}
                </option>
              ))}
            </select>
          </div>
          <button className="btn" onClick={() => runQuery("show")}>
            WHERE show_id = ?
          </button>
          <div className="field">
            <label>Ticket id</label>
            <input value={queryTicket} onChange={(e) => setQueryTicket(e.target.value)} style={{ width: "8ch" }} />
          </div>
          <button className="btn" onClick={() => runQuery("ticket")}>
            WHERE ticket_id = ?
          </button>
        </div>
        {query && (
          <>
            <div className="shard-boxes">
              {shards.map((s) => (
                <div key={s} className={`shard-box ${query.shards_touched.includes(s) ? "hit" : ""}`}>
                  shard {s}
                </div>
              ))}
            </div>
            <Callout tone={query.scatter_gather ? "warn" : "good"}>
              <code>{query.where}</code> with shard key <code>{query.shard_key}</code>:{" "}
              {query.scatter_gather
                ? `scatter-gather across all ${query.shards_touched.length} shards`
                : `routed straight to shard ${query.shards_touched[0]}`}
              . {query.rows} rows, ~{query.simulated_latency_ms}ms simulated.
            </Callout>
          </>
        )}
      </Panel>

      <Panel
        title="3 · Hot spots"
        hint="5,000 reads, 60% of them for the mega show. Then try shard key = show_id + seat_section to spread that show across shards."
        actions={
          <button className="btn btn-primary" onClick={runTraffic}>
            Send traffic
          </button>
        }
      >
        {traffic && (
          <>
            <Bars
              items={traffic.per_shard.map((n, i) => ({
                label: `shard ${i}`,
                value: n,
                tone: i === traffic.hottest_shard && traffic.hottest_share_pct > 100 / config.num_shards + 15 ? "bad" : "",
              }))}
              max={traffic.requests}
              unit=" req"
            />
            <Callout tone={traffic.hottest_share_pct > 100 / config.num_shards + 15 ? "bad" : "good"}>
              The busiest shard handles {traffic.hottest_share_pct}% of all reads (fair share would be{" "}
              {(100 / config.num_shards).toFixed(0)}%).
            </Callout>
          </>
        )}
      </Panel>
    </LabShell>
  );
}
