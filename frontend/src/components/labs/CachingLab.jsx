import { useState } from "react";
import LabShell, { Bars, Callout, Panel, Stat } from "./LabShell";
import useLabState from "./useLabState";

const IDEAS = [
  "Cache-aside is the default: check the cache, on a miss read the DB and populate the cache.",
  "Write strategy is a consistency trade-off: invalidate, write-through (slow writes, fresh cache) or write-behind (fast writes, can lose data).",
  "Eviction decides who leaves when the cache is full: LRU (recency), LFU (frequency), FIFO (insertion order). TTL bounds staleness.",
  "A cache stampede is many requests rebuilding one expired key at once — coalesce them into a single DB read.",
  "Hot keys overload one cache node; replicate the key across nodes to spread the reads.",
];

const STRATEGY_INFO = {
  cache_aside_invalidate: "Write DB, then delete the cache entry. Next read misses and gets fresh data.",
  cache_aside_no_invalidate: "Write DB only. The cached copy is now wrong until its TTL expires — the classic bug.",
  write_through: "Write DB and cache together, synchronously. Always fresh, but every write pays DB latency.",
  write_behind: "Write the cache now, flush to the DB later. Fastest write — and lost if the cache dies first.",
};

export default function CachingLab({ runRequest }) {
  const [state, refresh, setState] = useLabState(runRequest, "/api/lab/cache/state", { pollMs: 1500 });
  const [lastRead, setLastRead] = useState(null);
  const [writeForm, setWriteForm] = useState({ id: "", title: "", strategy: "cache_aside_invalidate" });
  const [lastWrite, setLastWrite] = useState(null);
  const [stampede, setStampede] = useState({ concurrency: 20, coalesce: false });
  const [stampedeRuns, setStampedeRuns] = useState([]);
  const [hot, setHot] = useState(null);
  const [replicateHot, setReplicateHot] = useState(false);
  const [lostWrites, setLostWrites] = useState(null);

  if (!state) return <p className="muted">Loading cache lab… (is Flask running on :5000?)</p>;

  const { config, entries, stats, origin, write_behind_queue: queue } = state;
  const hitRate = stats.hits + stats.misses ? Math.round((100 * stats.hits) / (stats.hits + stats.misses)) : 0;

  async function applyConfig(patch) {
    const tx = await runRequest("POST", "/api/lab/cache/config", "cache.config", { ...config, ...patch });
    if (tx.ok) setState(tx.responseBody);
  }

  async function read(id) {
    const tx = await runRequest("GET", `/api/lab/cache/shows/${id}`, "cache.read");
    setLastRead({ ...tx.responseBody, clientMs: tx.elapsedMs });
    refresh();
  }

  async function write(e) {
    e.preventDefault();
    const id = writeForm.id || origin[0].id;
    const tx = await runRequest("PUT", `/api/lab/cache/shows/${id}`, "cache.write", {
      title: writeForm.title || `Renamed at ${new Date().toLocaleTimeString([], { hour12: false })}`,
      strategy: writeForm.strategy,
    });
    setLastWrite({ ...tx.responseBody, id });
    refresh();
  }

  async function crash() {
    const tx = await runRequest("POST", "/api/lab/cache/crash", "cache.crash");
    setLostWrites(tx.responseBody?.lost_writes ?? {});
    refresh();
  }

  async function flush() {
    await runRequest("POST", "/api/lab/cache/flush", "cache.flush");
    refresh();
  }

  async function runStampede() {
    const tx = await runRequest("POST", "/api/lab/cache/stampede", "cache.stampede", {
      key: origin[0].id,
      ...stampede,
    });
    if (tx.ok) setStampedeRuns((prev) => [tx.responseBody, ...prev].slice(0, 6));
    refresh();
  }

  async function runHot() {
    const tx = await runRequest("POST", "/api/lab/cache/hotkey", "cache.hotkey", {
      requests: 2000,
      replicate: replicateHot,
    });
    if (tx.ok) setHot(tx.responseBody);
  }

  async function reset() {
    await runRequest("POST", "/api/lab/cache/reset", null);
    setLastRead(null);
    setLastWrite(null);
    setStampedeRuns([]);
    setHot(null);
    setLostWrites(null);
    refresh();
  }

  const orderLabel = { LRU: "least recent → most recent", LFU: "evicts lowest count", FIFO: "oldest insert → newest" }[config.policy];

  return (
    <LabShell title="Caching" article="core-concepts/caching" ideas={IDEAS} onReset={reset}>
      <div className="stat-row">
        <Stat label="hit rate" value={`${hitRate}%`} tone={hitRate > 50 ? "good" : ""} />
        <Stat label="hits" value={stats.hits} />
        <Stat label="misses" value={stats.misses} />
        <Stat label="evictions" value={stats.evictions} />
        <Stat label="DB reads" value={stats.db_reads} />
        <Stat label="DB writes" value={stats.db_writes} />
      </div>

      <Panel
        title="1 · Read path (cache-aside)"
        hint={`Every miss costs a ${config.db_latency_ms}ms trip to the "database". Click a show twice and compare the timing.`}
      >
        <div className="form-row compact">
          <div className="field">
            <label>Eviction policy</label>
            <select value={config.policy} onChange={(e) => applyConfig({ policy: e.target.value })}>
              <option>LRU</option>
              <option>LFU</option>
              <option>FIFO</option>
            </select>
          </div>
          <div className="field">
            <label>Capacity: {config.capacity}</label>
            <input type="range" min="1" max="8" value={config.capacity} onChange={(e) => applyConfig({ capacity: Number(e.target.value) })} />
          </div>
          <div className="field">
            <label>TTL: {config.ttl ? `${config.ttl}s` : "none"}</label>
            <input type="range" min="0" max="60" step="5" value={config.ttl} onChange={(e) => applyConfig({ ttl: Number(e.target.value) })} />
          </div>
          <div className="field">
            <label>DB latency: {config.db_latency_ms}ms</label>
            <input type="range" min="50" max="1000" step="50" value={config.db_latency_ms} onChange={(e) => applyConfig({ db_latency_ms: Number(e.target.value) })} />
          </div>
        </div>

        <div className="button-grid">
          {origin.map((show) => (
            <button key={show.id} className="btn" onClick={() => read(show.id)}>
              GET show {show.id}
            </button>
          ))}
        </div>

        {lastRead?.show && (
          <Callout tone={lastRead.cache === "HIT" ? (lastRead.stale ? "bad" : "good") : "warn"}>
            <strong>{lastRead.cache}</strong> — show {lastRead.show.id} “{lastRead.show.title}” in {lastRead.elapsed_ms}ms
            server-side ({lastRead.clientMs}ms round trip).
            {lastRead.stale && " ⚠ This is STALE — the database has a different title."}
          </Callout>
        )}

        <div className="cache-slots-head">
          <span>
            Cache slots ({entries.length}/{config.capacity}) · {config.policy}: {orderLabel}
          </span>
          {stats.last_evicted !== null && <span className="muted">last evicted: show {stats.last_evicted}</span>}
        </div>
        <div className="cache-slots">
          {Array.from({ length: config.capacity }).map((_, i) => {
            const e = entries[i];
            if (!e) return <div key={`empty-${i}`} className="slot empty">empty</div>;
            return (
              <div key={e.key} className={`slot ${e.stale ? "stale" : ""}`}>
                <div className="slot-key">show {e.key}</div>
                <div className="slot-title">{e.title}</div>
                <div className="slot-meta">
                  <span>×{e.freq}</span>
                  {e.ttl_left !== null && <span>{Math.max(0, e.ttl_left).toFixed(0)}s</span>}
                  {e.stale && <span className="bad-text">stale</span>}
                </div>
              </div>
            );
          })}
        </div>
      </Panel>

      <Panel title="2 · Write path" hint={STRATEGY_INFO[writeForm.strategy]}>
        <form className="form-row compact" onSubmit={write}>
          <div className="field">
            <label>Show</label>
            <select value={writeForm.id} onChange={(e) => setWriteForm({ ...writeForm, id: e.target.value })}>
              {origin.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.id} · {s.title}
                </option>
              ))}
            </select>
          </div>
          <div className="field">
            <label>New title</label>
            <input
              placeholder="(auto)"
              value={writeForm.title}
              onChange={(e) => setWriteForm({ ...writeForm, title: e.target.value })}
            />
          </div>
          <div className="field">
            <label>Strategy</label>
            <select value={writeForm.strategy} onChange={(e) => setWriteForm({ ...writeForm, strategy: e.target.value })}>
              <option value="cache_aside_invalidate">cache-aside + invalidate</option>
              <option value="cache_aside_no_invalidate">cache-aside, forget to invalidate</option>
              <option value="write_through">write-through</option>
              <option value="write_behind">write-behind</option>
            </select>
          </div>
          <button className="btn btn-primary" type="submit">
            PUT
          </button>
        </form>

        {lastWrite?.strategy && (
          <Callout tone="info">
            {lastWrite.strategy} took <strong>{lastWrite.elapsed_ms}ms</strong>.{" "}
            {lastWrite.pending_write_behind
              ? `The DB hasn't seen it yet — it flushes in ~${config.flush_delay}s. Try “Crash cache” first.`
              : "Now GET that show again and check whether it's fresh."}
          </Callout>
        )}

        <div className="two-col">
          <div>
            <div className="mini-head">
              Write-behind queue ({queue.length})
              <span>
                <button className="btn-quiet" onClick={flush} disabled={!queue.length}>
                  flush now
                </button>
                <button className="btn-danger" onClick={crash}>
                  crash cache
                </button>
              </span>
            </div>
            {queue.length === 0 ? (
              <p className="muted small">empty — nothing waiting to reach the DB</p>
            ) : (
              <ul className="plain small">
                {queue.map((q) => (
                  <li key={q.key}>
                    show {q.key} → “{q.fields.title}”
                  </li>
                ))}
              </ul>
            )}
            {lostWrites && (
              <Callout tone={Object.keys(lostWrites).length ? "bad" : "good"}>
                Cache crashed.{" "}
                {Object.keys(lostWrites).length
                  ? `${Object.keys(lostWrites).length} write(s) never reached the DB and are gone forever: ${Object.entries(lostWrites)
                      .map(([k, v]) => `show ${k} “${v.title}”`)
                      .join(", ")}`
                  : "No pending writes were lost (the cache was simply emptied)."}
              </Callout>
            )}
          </div>
          <div>
            <div className="mini-head">Database (source of truth)</div>
            <table className="tight">
              <tbody>
                {origin.map((row) => (
                  <tr key={row.id}>
                    <td className="muted">{row.id}</td>
                    <td>{row.title}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </Panel>

      <Panel
        title="3 · Cache stampede"
        hint={`Expire show ${origin[0].id}, then send N requests at the same instant. Without coalescing each one goes to the DB.`}
      >
        <div className="form-row compact">
          <div className="field">
            <label>Concurrent requests: {stampede.concurrency}</label>
            <input
              type="range"
              min="2"
              max="64"
              value={stampede.concurrency}
              onChange={(e) => setStampede({ ...stampede, concurrency: Number(e.target.value) })}
            />
          </div>
          <label className="check">
            <input
              type="checkbox"
              checked={stampede.coalesce}
              onChange={(e) => setStampede({ ...stampede, coalesce: e.target.checked })}
            />
            request coalescing (single-flight)
          </label>
          <button className="btn btn-primary" onClick={runStampede}>
            Unleash
          </button>
        </div>
        {stampedeRuns.length > 0 && (
          <Bars
            items={stampedeRuns.map((r, i) => ({
              label: `#${stampedeRuns.length - i} ${r.coalesce ? "coalesced" : "naive"}`,
              value: r.db_reads,
              tone: r.db_reads > 1 ? "bad" : "good",
              note: `/ ${r.concurrency} req`,
            }))}
            max={64}
            unit=" DB reads"
          />
        )}
      </Panel>

      <Panel title="4 · Hot keys" hint="2,000 reads with a Zipf skew (one show is wildly popular). Keys are hashed onto 4 cache nodes.">
        <div className="form-row compact">
          <label className="check">
            <input type="checkbox" checked={replicateHot} onChange={(e) => setReplicateHot(e.target.checked)} />
            replicate the hottest key on 3 nodes
          </label>
          <button className="btn btn-primary" onClick={runHot}>
            Send traffic
          </button>
        </div>
        {hot && (
          <div className="two-col">
            <div>
              <div className="mini-head">Load per cache node</div>
              <Bars
                items={hot.per_node.map((n) => ({
                  label: n.node,
                  value: n.count,
                  tone: n.count > hot.requests * 0.45 ? "bad" : "",
                }))}
                max={hot.requests}
              />
            </div>
            <div>
              <div className="mini-head">Reads per key (hot key: show {hot.hot_key})</div>
              <Bars
                items={hot.per_key.slice(0, 6).map((k) => ({
                  label: `show ${k.key}`,
                  value: k.count,
                  tone: k.key === hot.hot_key ? "warn" : "",
                }))}
              />
            </div>
          </div>
        )}
      </Panel>
    </LabShell>
  );
}
