import { useCallback, useEffect, useRef, useState } from "react";

// Loads a lab's GET .../state, quietly (it doesn't clutter the transaction log),
// optionally re-polling so timers on the server (TTL, replication lag) are visible.
export default function useLabState(runRequest, path, { pollMs } = {}) {
  const [state, setState] = useState(null);
  const runRef = useRef(runRequest);
  useEffect(() => {
    runRef.current = runRequest;
  });

  const refresh = useCallback(async () => {
    const tx = await runRef.current("GET", path, null, undefined, { quiet: true });
    if (tx.ok) setState(tx.responseBody);
    return tx;
  }, [path]);

  useEffect(() => {
    refresh();
    if (!pollMs) return undefined;
    const id = setInterval(refresh, pollMs);
    return () => clearInterval(id);
  }, [refresh, pollMs]);

  return [state, refresh, setState];
}
