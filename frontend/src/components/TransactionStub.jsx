import { useEffect, useState } from "react";
import { BASE_URL } from "../api";
import { SNIPPETS } from "../snippets";

const MAX_BODY_CHARS = 2500;

// Lab routes register their own source on the backend (labs/snippets.py), so the
// stub fetches it live instead of relying on a hand-copied string. Cached per key.
const liveSnippets = new Map();

function useSnippet(key) {
  const [source, setSource] = useState(() => SNIPPETS[key] ?? liveSnippets.get(key) ?? null);

  useEffect(() => {
    if (!key || SNIPPETS[key] || liveSnippets.has(key)) return;
    let cancelled = false;
    fetch(`${BASE_URL}/api/meta/snippet/${encodeURIComponent(key)}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => {
        if (!data) return;
        liveSnippets.set(key, data.source);
        if (!cancelled) setSource(data.source);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [key]);

  return source;
}

function formatTime(date) {
  return date.toLocaleTimeString([], { hour12: false });
}

function formatBody(value) {
  const text = JSON.stringify(value, null, 2) ?? "";
  if (text.length <= MAX_BODY_CHARS) return text;
  return `${text.slice(0, MAX_BODY_CHARS)}\n… (${(text.length / 1024).toFixed(1)} KB total, truncated)`;
}

// Turn the interesting response headers into short chips: HIT/MISS, shard, server, etc.
function headerChips(headers = {}) {
  const chips = [];
  if (headers["x-cache"]) chips.push({ label: `cache ${headers["x-cache"]}`, tone: headers["x-cache"] === "MISS" ? "warn" : "good" });
  if (headers["x-shard"]) chips.push({ label: `shard ${headers["x-shard"]}`, tone: headers["x-shard"].includes(",") ? "warn" : "good" });
  if (headers["x-server"]) chips.push({ label: headers["x-server"], tone: "info" });
  if (headers["x-replica"]) chips.push({ label: headers["x-replica"], tone: "info" });
  if (headers["x-idempotent-replay"]) chips.push({ label: "idempotent replay", tone: "good" });
  if (headers["x-ratelimit-remaining"] !== undefined) chips.push({ label: `rate left ${headers["x-ratelimit-remaining"]}`, tone: "info" });
  if (headers["retry-after"]) chips.push({ label: `retry in ${headers["retry-after"]}s`, tone: "bad" });
  if (headers["x-response-time"]) chips.push({ label: `server ${headers["x-response-time"]}`, tone: "dim" });
  return chips;
}

function Stub({ tx }) {
  const snippet = useSnippet(tx.snippetKey);
  const chips = headerChips(tx.responseHeaders);

  return (
    <div className="stub">
      <div className="stub-head">
        <span className={`stub-method ${tx.method}`}>{tx.method}</span>
        <span className={`stub-status ${tx.ok ? "ok" : "err"}`}>
          {tx.status || "—"} · {tx.elapsedMs}ms · {formatTime(tx.timestamp)}
        </span>
      </div>
      <div className="stub-url">{BASE_URL ? tx.url.replace(BASE_URL, "") : tx.url}</div>

      {chips.length > 0 && (
        <div className="chip-row">
          {chips.map((c) => (
            <span key={c.label} className={`chip ${c.tone}`}>
              {c.label}
            </span>
          ))}
        </div>
      )}

      {tx.requestHeaders && (
        <>
          <div className="code-label">request headers</div>
          <pre>{Object.entries(tx.requestHeaders).map(([k, v]) => `${k}: ${v}`).join("\n")}</pre>
        </>
      )}

      {tx.requestBody !== undefined && (
        <>
          <div className="code-label">request body</div>
          <pre>{formatBody(tx.requestBody)}</pre>
        </>
      )}

      <div className="code-label">response</div>
      <pre>{formatBody(tx.responseBody)}</pre>

      {snippet && (
        <details>
          <summary>backend code that ran</summary>
          <pre>{snippet}</pre>
        </details>
      )}
    </div>
  );
}

export default function TransactionStub({ transactions, onClear }) {
  return (
    <aside className="stub-panel">
      <div className="stub-panel-head">
        <h2>Last transactions</h2>
        {transactions.length > 0 && (
          <button className="btn-quiet" onClick={onClear}>
            clear
          </button>
        )}
      </div>
      <div className="stub-sub">every request this page sent, newest first</div>

      {transactions.length === 0 ? (
        <div className="stub-empty">
          Nothing yet — load a tab or use a form on the left and the request,
          response, and matching Flask route will print here.
        </div>
      ) : (
        transactions.map((tx) => <Stub key={tx.id} tx={tx} />)
      )}
    </aside>
  );
}
