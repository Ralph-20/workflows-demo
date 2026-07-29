export type ApiErrorResponse = { error: string };

export function isApiError(value: unknown): value is ApiErrorResponse {
  return (
    typeof value === "object" &&
    value !== null &&
    typeof (value as ApiErrorResponse).error === "string"
  );
}

/** Shared client helper: POST JSON to `url` and surface a readable error. */
export async function postJson<T>(
  url: string,
  body: unknown,
  signal?: AbortSignal,
): Promise<T> {
  const res = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
    signal,
  });

  const payload: unknown = await res.json().catch(() => null);

  if (!res.ok) {
    throw new Error(
      isApiError(payload) ? payload.error : `Request failed (${res.status})`,
    );
  }
  if (payload === null) {
    throw new Error("The server returned a response that could not be parsed.");
  }
  return payload as T;
}

/** Turns anything thrown into a string safe to render in an error box. */
export function errorMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  return String(error);
}
