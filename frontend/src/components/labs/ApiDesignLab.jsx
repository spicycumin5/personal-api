import { useEffect, useState } from "react";
import LabShell, { Callout, Panel, Stat } from "./LabShell";

const IDEAS = [
  "REST is the default. Model resources as plural nouns, use path params for identity and query params for filters.",
  "Use HTTP verbs as intended: GET reads, POST creates, PUT replaces, PATCH partially updates, DELETE removes. The Ticket Desk tabs already demo these.",
  "Paginate lists. Offset paging is simple; cursor paging stays correct while new data is inserted.",
  "Idempotency keys make retries safe, so a double-click doesn't charge the card twice.",
  "Authentication checks who you are and authorization checks what you can do. Rate limiting protects the system from abuse.",
  "Version the API (e.g. /v1, /v2) and keep error shapes consistent so clients can rely on them.",
];

const TOKENS = [
  { value: "", label: "no token" },
  { value: "fan-token", label: "fan-token (alice, fan)" },
  { value: "fan2-token", label: "fan2-token (bob, fan)" },
  { value: "admin-token", label: "admin-token (ops, admin)" },
];

const bytes = (obj) => new Blob([JSON.stringify(obj ?? null)]).size;
const authHeaders = (token) => (token ? { Authorization: `Bearer ${token}` } : {});

function Pager({ title, mode, runRequest }) {
  const [rows, setRows] = useState([]);
  const [next, setNext] = useState(null);

  async function loadMore() {
    const qs = mode === "cursor" ? (next ? `&cursor=${next}` : "") : `&offset=${next ?? 0}`;
    const tx = await runRequest("GET", `/api/lab/api/feed?mode=${mode}&limit=5${qs}`, "api.feed");
    if (!tx.ok) return;
    setRows((prev) => [...prev, ...tx.responseBody.data]);
    setNext(mode === "cursor" ? tx.responseBody.next_cursor : tx.responseBody.next_offset);
  }

  const seen = new Map();
  rows.forEach((r) => seen.set(r.id, (seen.get(r.id) ?? 0) + 1));
  const dupes = [...seen.values()].filter((n) => n > 1).length;

  return (
    <div className="pager">
      <div className="mini-head">
        {title}
        <button className="btn" onClick={loadMore}>
          Next page
        </button>
      </div>
      <ol className="pager-list">
        {rows.map((r, i) => (
          <li key={`${r.id}-${i}`} className={seen.get(r.id) > 1 ? "dupe" : r.listing.startsWith("NEW") ? "fresh" : ""}>
            #{r.id} {r.listing}
          </li>
        ))}
      </ol>
      {dupes > 0 && <Callout tone="bad">{dupes} listing(s) shown twice. New rows pushed old ones onto the next page.</Callout>}
    </div>
  );
}

export default function ApiDesignLab({ runRequest, shows }) {
  const [showId, setShowId] = useState("");
  const [compare, setCompare] = useState(null);
  const [errors, setErrors] = useState(null);
  const [pagerVersion, setPagerVersion] = useState(0);
  const [token, setToken] = useState("fan-token");
  const [authResult, setAuthResult] = useState(null);
  const [useKey, setUseKey] = useState(true);
  const [purchase, setPurchase] = useState(null);
  const [spam, setSpam] = useState([]);
  const [bucket, setBucket] = useState(null);

  const sid = showId || shows[0]?.id;

  useEffect(() => {
    let alive = true;
    async function poll() {
      const tx = await runRequest("GET", "/api/lab/api/bucket", null, undefined, { quiet: true, headers: authHeaders(token) });
      if (alive && tx.ok) setBucket(tx.responseBody);
    }
    poll();
    const id = setInterval(poll, 1000);
    return () => {
      alive = false;
      clearInterval(id);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token]);

  async function compareVersions() {
    const v1Show = await runRequest("GET", `/api/shows/${sid}`, null);
    const v1Venue = v1Show.ok ? await runRequest("GET", `/api/venues/${v1Show.responseBody.venue_id}`, null) : null;
    const v2 = await runRequest("GET", `/api/v2/shows/${sid}`, "v2.show");
    const v2f = await runRequest("GET", `/api/v2/shows/${sid}?fields=title,date,venue.name`, "v2.show");
    setCompare({
      v1: { trips: 2, bytes: bytes(v1Show.responseBody) + bytes(v1Venue?.responseBody), ms: v1Show.elapsedMs + (v1Venue?.elapsedMs ?? 0) },
      v2: { trips: 1, bytes: bytes(v2.responseBody), ms: v2.elapsedMs, body: v2.responseBody },
      v2f: { trips: 1, bytes: bytes(v2f.responseBody), ms: v2f.elapsedMs, body: v2f.responseBody },
    });
  }

  async function compareErrors() {
    const v1 = await runRequest("GET", "/api/shows/99999", null);
    const v2 = await runRequest("GET", "/api/v2/shows/99999", "v2.show");
    setErrors({ v1: v1.responseBody, v2: v2.responseBody });
  }

  async function listOrders() {
    setAuthResult(await runRequest("GET", "/api/v2/orders", "v2.orders.list", undefined, { headers: authHeaders(token) }));
  }

  async function refundFirst() {
    const admin = await runRequest("GET", "/api/v2/orders", null, undefined, { quiet: true, headers: authHeaders("admin-token") });
    const first = admin.responseBody?.data?.[0];
    if (!first) {
      setAuthResult({ status: 404, ok: false, responseBody: { error: { message: "No orders yet. Buy something below first." } } });
      return;
    }
    setAuthResult(await runRequest("DELETE", `/api/v2/orders/${first.id}`, "v2.orders.refund", undefined, { headers: authHeaders(token) }));
  }

  // A retry storm in miniature: the same purchase request sent twice at the same moment.
  async function doubleClickBuy() {
    const key = crypto.randomUUID();
    const headers = { ...authHeaders(token), ...(useKey ? { "Idempotency-Key": key } : {}) };
    const body = { show_id: sid, quantity: 2, unit_price: 150 };
    const results = await Promise.all([
      runRequest("POST", "/api/v2/orders", "v2.orders.create", body, { headers }),
      runRequest("POST", "/api/v2/orders", "v2.orders.create", body, { headers }),
    ]);
    const orderIds = new Set(results.filter((r) => r.ok).map((r) => r.responseBody.id));
    setPurchase({
      useKey,
      results,
      orders: orderIds.size,
      charged: [...orderIds].length * 300,
    });
  }

  async function spamPurchases() {
    setSpam([]);
    for (let i = 0; i < 10; i++) {
      const tx = await runRequest("POST", "/api/v2/orders", "v2.orders.create", { show_id: sid, quantity: 1 }, { headers: authHeaders(token) });
      setSpam((prev) => [...prev, tx]);
    }
  }

  async function reset() {
    await runRequest("POST", "/api/lab/api/reset", null);
    setPagerVersion((v) => v + 1);
    setPurchase(null);
    setSpam([]);
    setAuthResult(null);
  }

  return (
    <LabShell title="API Design" article="core-concepts/api-design" ideas={IDEAS} onReset={reset}>
      <div className="form-row compact">
        <div className="field">
          <label>Show used by the demos below</label>
          <select value={sid ?? ""} onChange={(e) => setShowId(e.target.value)}>
            {shows.map((s) => (
              <option key={s.id} value={s.id}>
                {s.id} · {s.title}
              </option>
            ))}
          </select>
        </div>
        <div className="field">
          <label>Authorization</label>
          <select value={token} onChange={(e) => setToken(e.target.value)}>
            {TOKENS.map((t) => (
              <option key={t.value} value={t.value}>
                {t.label}
              </option>
            ))}
          </select>
        </div>
      </div>
      {shows.length === 0 && <Callout tone="warn">Add a show in the Ticket Desk first, since several demos read real shows.</Callout>}

      <Panel
        title="1 · Versioning, embedding and over-fetching"
        hint="v1 is the API the Ticket Desk tabs use. v2 adds an embedded venue and ticket summary, plus ?fields= so the client asks only for what it shows."
        actions={<button className="btn btn-primary" onClick={compareVersions} disabled={!sid}>Compare</button>}
      >
        {compare && (
          <>
            <table className="tight">
              <thead>
                <tr>
                  <th>request</th>
                  <th>round trips</th>
                  <th>bytes</th>
                  <th>time</th>
                </tr>
              </thead>
              <tbody>
                <tr>
                  <td><code>GET /api/shows/{sid}</code> + <code>/api/venues/…</code></td>
                  <td>{compare.v1.trips}</td>
                  <td>{compare.v1.bytes}</td>
                  <td>{compare.v1.ms}ms</td>
                </tr>
                <tr>
                  <td><code>GET /api/v2/shows/{sid}</code></td>
                  <td>{compare.v2.trips}</td>
                  <td>{compare.v2.bytes}</td>
                  <td>{compare.v2.ms}ms</td>
                </tr>
                <tr>
                  <td><code>…?fields=title,date,venue.name</code></td>
                  <td>{compare.v2f.trips}</td>
                  <td>{compare.v2f.bytes}</td>
                  <td>{compare.v2f.ms}ms</td>
                </tr>
              </tbody>
            </table>
            <pre className="code-block">{JSON.stringify(compare.v2f.body, null, 2)}</pre>
          </>
        )}
      </Panel>

      <Panel
        title="2 · Consistent error envelope"
        hint="The same 404 from each version. v2 always returns { error: { code, message } }, so clients can branch on a stable code."
        actions={<button className="btn" onClick={compareErrors}>Trigger 404s</button>}
      >
        {errors && (
          <div className="two-col">
            <div>
              <div className="mini-head">v1</div>
              <pre className="code-block">{JSON.stringify(errors.v1, null, 2)}</pre>
            </div>
            <div>
              <div className="mini-head">v2</div>
              <pre className="code-block">{JSON.stringify(errors.v2, null, 2)}</pre>
            </div>
          </div>
        )}
      </Panel>

      <Panel
        title="3 · Pagination: offset vs cursor"
        hint="A newest-first resale feed. Load page 1 in both, insert new listings, then load page 2. Offset shows rows again; the cursor (“older than #id”) doesn't."
        actions={
          <button className="btn btn-primary" onClick={() => runRequest("POST", "/api/lab/api/feed", null, { count: 2 })}>
            Insert 2 new listings
          </button>
        }
      >
        <div className="two-col">
          <Pager key={`o${pagerVersion}`} title="?offset=" mode="offset" runRequest={runRequest} />
          <Pager key={`c${pagerVersion}`} title="?cursor=" mode="cursor" runRequest={runRequest} />
        </div>
        <p className="small muted">
          The real tickets table supports it too: <code>GET /api/v2/tickets?limit=2</code> returns an opaque{" "}
          <code>next_cursor</code>.{" "}
          <button className="btn-quiet" onClick={() => runRequest("GET", "/api/v2/tickets?limit=2", "v2.tickets")}>
            try it
          </button>
        </p>
      </Panel>

      <Panel title="4 · Authentication and authorization" hint="Fans see only their own orders. Only admins may refund. Switch the token above and try each.">
        <div className="form-row compact">
          <button className="btn" onClick={listOrders}>GET /api/v2/orders</button>
          <button className="btn" onClick={refundFirst}>DELETE first order (refund)</button>
        </div>
        {authResult && (
          <Callout tone={authResult.ok ? "good" : "bad"}>
            <strong>{authResult.status}</strong>{" "}
            {authResult.ok
              ? authResult.responseBody.data
                ? `as ${authResult.responseBody.as.user} (${authResult.responseBody.as.role}): ${authResult.responseBody.data.length} order(s) visible`
                : `refunded order #${authResult.responseBody.refunded.id}`
              : `${authResult.responseBody?.error?.code ?? ""} ${authResult.responseBody?.error?.message ?? ""}`}
            {authResult.status === 401 && " (authentication failed: who are you?)"}
            {authResult.status === 403 && " (authorization failed: you're not allowed to do that)"}
          </Callout>
        )}
      </Panel>

      <Panel
        title="5 · Idempotency keys"
        hint="The client sends the same purchase twice at once, like a double-click or an automatic retry after a timeout."
      >
        <div className="form-row compact">
          <label className="check">
            <input type="checkbox" checked={useKey} onChange={(e) => setUseKey(e.target.checked)} />
            send an Idempotency-Key header
          </label>
          <button className="btn btn-primary" onClick={doubleClickBuy} disabled={!sid || !token}>
            Double-click “Buy 2 × $150”
          </button>
        </div>
        {purchase && (
          <Callout tone={purchase.orders > 1 ? "bad" : "good"}>
            {purchase.results.map((r) => `${r.status}${r.responseHeaders["x-idempotent-replay"] ? " (replay)" : ""}`).join(" + ")} →{" "}
            <strong>
              {purchase.orders} order(s), ${purchase.charged} charged
            </strong>
            . {purchase.orders > 1 ? "The fan was charged twice." : "The second request got the stored response replayed, so there was one charge."}
          </Callout>
        )}
      </Panel>

      <Panel title="6 · Rate limiting (token bucket)" hint="Each user gets 5 purchase tokens, refilling at 1 every 2s. Spam 10 purchases and watch what happens.">
        <div className="form-row compact">
          <button className="btn btn-primary" onClick={spamPurchases} disabled={!sid || !token}>
            Spam 10 purchases
          </button>
          {bucket?.tokens !== null && bucket && (
            <div className="bucket">
              <div className="bucket-fill" style={{ width: `${(100 * bucket.tokens) / bucket.capacity}%` }} />
              <span>
                {bucket.caller}: {bucket.tokens.toFixed(1)} / {bucket.capacity} tokens
              </span>
            </div>
          )}
        </div>
        {spam.length > 0 && (
          <>
            <div className="chip-row">
              {spam.map((tx) => (
                <span key={tx.id} className={`chip ${tx.ok ? "good" : "bad"}`}>
                  {tx.status}
                  {tx.responseHeaders["retry-after"] ? ` retry ${tx.responseHeaders["retry-after"]}s` : ""}
                </span>
              ))}
            </div>
            <div className="stat-row">
              <Stat label="accepted" value={spam.filter((t) => t.ok).length} tone="good" />
              <Stat label="429 Too Many Requests" value={spam.filter((t) => t.status === 429).length} tone="bad" />
            </div>
          </>
        )}
      </Panel>
    </LabShell>
  );
}
