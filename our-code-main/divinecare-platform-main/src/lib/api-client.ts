/**
 * Browser fetch helper for internal Next.js route handlers.
 * Envelope: `{ success: true, ...payload }` or `{ success: false, error: string }`.
 */
export async function apiJson<T>(url: string, init?: RequestInit): Promise<T> {
  const isFormData = init?.body instanceof FormData;
  const res = await fetch(url, {
    ...init,
    headers: isFormData
      ? init?.headers
      : {
          'Content-Type': 'application/json',
          ...init?.headers,
        },
  });

  const text = await res.text();
  let data: any = null;
  if (text) {
    try {
      data = JSON.parse(text);
    } catch {
      throw new Error(
        res.ok
          ? 'Invalid server response'
          : `Request failed (${res.status}). Check that the database is running.`
      );
    }
  } else if (!res.ok) {
    throw new Error(
      `Request failed (${res.status}). Check that the database is running.`
    );
  } else {
    throw new Error('Empty server response');
  }

  if (!res.ok || data.success === false) {
    throw new Error(
      typeof data.error === 'string' ? data.error : data.error?.message || 'Request failed'
    );
  }
  return data as T;
}
