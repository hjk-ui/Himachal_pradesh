type PatientApiError = { code?: string; message?: string; fields?: Record<string, string> };

export type PatientApiBody<T> = {
  success: boolean;
  data?: T;
  message?: string;
  error?: PatientApiError | string;
};

export function parsePatientApi<T>(body: PatientApiBody<T>): T {
  if (body.success && body.data !== undefined) {
    return body.data;
  }
  const err = body.error;
  const message = typeof err === 'string' ? err : err?.message;
  throw new Error(message || 'Request failed');
}

export async function readPatientApi<T>(res: Response): Promise<T> {
  const body = (await res.json()) as PatientApiBody<T>;
  if (!res.ok || !body.success) {
    const err = body.error;
    const message = typeof err === 'string' ? err : err?.message;
    throw new Error(message || 'Request failed');
  }
  if (body.data === undefined) {
    throw new Error('Invalid response');
  }
  return body.data;
}
