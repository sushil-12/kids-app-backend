// The one place the portal talks to the backend.
//
// Auth is the same model the old vanilla admin page used: the admin key lives
// in localStorage under `bm_admin_key` and is sent as `x-admin-key` on every
// call. Reusing the key name means someone already signed into /v1/admin is
// already signed in here.

const KEY_STORE = 'bm_admin_key';

export function adminKey(): string {
  return localStorage.getItem(KEY_STORE) ?? '';
}

export function setAdminKey(value: string): void {
  localStorage.setItem(KEY_STORE, value.trim());
}

export class ApiError extends Error {
  constructor(
    public readonly status: number,
    message: string,
    /** Zod's flattened field errors, when the failure was validation. */
    public readonly fieldErrors?: Record<string, string[]>,
    public readonly formErrors?: string[],
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

/** Turns any error shape the API returns into one readable sentence.
 *  The API sends `{ error: string }` for most failures but `{ error: <zod
 *  flatten> }` for validation, so this has to handle both. */
function describe(status: number, body: unknown): ApiError {
  const error = (body as { error?: unknown } | null)?.error;
  if (typeof error === 'string') return new ApiError(status, error);

  if (error && typeof error === 'object') {
    const flat = error as { fieldErrors?: Record<string, string[]>; formErrors?: string[] };
    const parts: string[] = [...(flat.formErrors ?? [])];
    for (const [path, messages] of Object.entries(flat.fieldErrors ?? {})) {
      parts.push(`${path}: ${messages.join(', ')}`);
    }
    return new ApiError(
      status,
      parts.length ? parts.join('\n') : `Request failed (${status})`,
      flat.fieldErrors,
      flat.formErrors,
    );
  }
  return new ApiError(status, `Request failed (${status})`);
}

async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  const response = await fetch(path, {
    ...init,
    headers: {
      'x-admin-key': adminKey(),
      'Content-Type': 'application/json',
      ...(init.headers ?? {}),
    },
  });

  if (response.status === 204) return undefined as T;

  const body: unknown = await response.json().catch(() => null);
  if (!response.ok) {
    if (response.status === 401) {
      throw new ApiError(401, 'That admin key was rejected.');
    }
    throw describe(response.status, body);
  }
  return body as T;
}

export const api = {
  get: <T>(path: string): Promise<T> => request<T>(path),
  post: <T>(path: string, body?: unknown): Promise<T> =>
    request<T>(path, { method: 'POST', body: JSON.stringify(body ?? {}) }),
  put: <T>(path: string, body: unknown): Promise<T> =>
    request<T>(path, { method: 'PUT', body: JSON.stringify(body) }),
  patch: <T>(path: string, body: unknown): Promise<T> =>
    request<T>(path, { method: 'PATCH', body: JSON.stringify(body) }),
  del: <T>(path: string): Promise<T> => request<T>(path, { method: 'DELETE' }),
};
