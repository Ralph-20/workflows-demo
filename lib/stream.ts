/**
 * Newline-delimited JSON is used for every progressive capability (durable
 * runs, retries, fan-out, agent steps) so the client can render each step as it
 * lands and still receive a final metrics payload on the same connection.
 *
 * NDJSON rather than SSE: a workflow run's stream is already a sequence of
 * discrete JSON events, and relaying it needs no event-name framing.
 */

export const NDJSON_HEADERS: HeadersInit = {
  "content-type": "application/x-ndjson; charset=utf-8",
  // Keep proxies from buffering the response into a single flush.
  "cache-control": "no-store, no-transform",
  connection: "keep-alive",
};

/**
 * Wraps an async producer in a ReadableStream that emits one JSON object per
 * line. Errors become an `error` event instead of tearing down the connection,
 * so the UI always has something to render.
 */
export function ndjsonResponse<E extends { type: string }>(
  produce: (emit: (event: E) => void) => Promise<void>,
  onError: (error: unknown) => string,
): Response {
  const encoder = new TextEncoder();

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      let closed = false;
      const emit = (event: E) => {
        if (closed) return;
        controller.enqueue(encoder.encode(`${JSON.stringify(event)}\n`));
      };
      try {
        await produce(emit);
      } catch (error) {
        emit({ type: "error", message: onError(error) } as unknown as E);
      } finally {
        closed = true;
        controller.close();
      }
    },
  });

  return new Response(stream, { headers: NDJSON_HEADERS });
}

/**
 * Client side: POST to `url` and invoke `onEvent` per line as it arrives.
 *
 * Aborting `signal` rejects with an AbortError, which callers use deliberately
 * on tab 01 to model a client disconnect — the run keeps going server-side.
 */
export async function readNdjson<E>(
  url: string,
  body: unknown,
  onEvent: (event: E) => void,
  signal?: AbortSignal,
): Promise<void> {
  const res = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
    signal,
  });

  if (!res.ok || !res.body) {
    const payload = (await res.json().catch(() => null)) as {
      error?: string;
    } | null;
    throw new Error(payload?.error ?? `Request failed (${res.status})`);
  }

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });

      let newline = buffer.indexOf("\n");
      while (newline !== -1) {
        const line = buffer.slice(0, newline).trim();
        buffer = buffer.slice(newline + 1);
        if (line) onEvent(JSON.parse(line) as E);
        newline = buffer.indexOf("\n");
      }
    }

    const tail = buffer.trim();
    if (tail) onEvent(JSON.parse(tail) as E);
  } finally {
    // Releasing the lock lets an aborted fetch tear its body down promptly.
    reader.releaseLock();
  }
}

export function isAbortError(error: unknown): boolean {
  return error instanceof DOMException && error.name === "AbortError";
}
