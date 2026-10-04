export const BASE_URL = "http://localhost:5000";

// Response headers the labs set to explain what happened server-side
// (Flask exposes them via CORS in main.py).
const INTERESTING_HEADERS = [
  "x-cache",
  "x-shard",
  "x-server",
  "x-replica",
  "x-response-time",
  "x-ratelimit-remaining",
  "retry-after",
  "x-idempotent-replay",
];

// Performs the fetch and returns everything the transaction log needs:
// the exact method/url/body/headers that went out, and the status/body/headers that came back.
// A timeout (or a dead server) comes back as status 0 instead of throwing, so callers
// can treat it like any other failed attempt.
export async function apiRequest(method, path, body, { headers = {}, timeoutMs } = {}) {
  const url = `${BASE_URL}${path}`;
  const options = { method, headers: { ...headers } };

  if (body !== undefined) {
    options.headers["Content-Type"] = "application/json";
    options.body = JSON.stringify(body);
  }

  const controller = new AbortController();
  options.signal = controller.signal;
  const timer = timeoutMs ? setTimeout(() => controller.abort(), timeoutMs) : null;
  const started = performance.now();

  let status = 0;
  let data = null;
  let responseHeaders = {};
  try {
    const res = await fetch(url, options);
    status = res.status;
    data = await res.json().catch(() => null);
    for (const name of INTERESTING_HEADERS) {
      const value = res.headers.get(name);
      if (value !== null) responseHeaders[name] = value;
    }
  } catch (err) {
    data = { error: err.name === "AbortError" ? `client timeout after ${timeoutMs}ms` : "network error — is Flask running?" };
  } finally {
    if (timer) clearTimeout(timer);
  }

  return {
    method,
    url,
    requestBody: body,
    requestHeaders: Object.keys(headers).length ? headers : undefined,
    status,
    ok: status >= 200 && status < 300,
    responseBody: data,
    responseHeaders,
    elapsedMs: Math.round(performance.now() - started),
    timestamp: new Date(),
  };
}
