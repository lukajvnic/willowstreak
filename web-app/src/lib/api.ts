const API_URL = import.meta.env.VITE_API_URL ?? "http://localhost:8001";

export type ApiCall = {
  ok: boolean;
  status: number;
  data: unknown;
};

/**
 * Never throws on a non-2xx — callers branch on `status`, because the backend
 * uses 404 from GET /api/me as "no profile yet", not as a failure.
 */
export async function api(
  path: string,
  opts: { method?: string; token?: string; body?: unknown } = {},
): Promise<ApiCall> {
  const { method = "GET", token, body } = opts;

  const res = await fetch(`${API_URL}${path}`, {
    method,
    headers: {
      ...(body !== undefined ? { "Content-Type": "application/json" } : {}),
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });

  const text = await res.text();
  let data: unknown = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = text;
  }

  return { ok: res.ok, status: res.status, data };
}

export { API_URL };
