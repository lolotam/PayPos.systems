export interface ErrorEnvelope {
  code: string;
  message_ar: string;
  message_en: string;
}

export type Failure =
  | { kind: 'network' }
  | { kind: 'http'; status: number; envelope: ErrorEnvelope | null };

export type CallResult<T> = { ok: true; data: T } | { ok: false; failure: Failure };

interface Raw<T> {
  data?: T;
  error?: unknown;
  response: Response;
}

export async function call<T>(run: () => Promise<Raw<T>>): Promise<CallResult<T>> {
  try {
    const result = await run();
    if (result.response.ok && result.data !== undefined) {
      return { ok: true, data: result.data };
    }
    return { ok: false, failure: httpFailure(result.response.status, result.error) };
  } catch {
    return { ok: false, failure: { kind: 'network' } };
  }
}

function httpFailure(status: number, error: unknown): Failure {
  return { kind: 'http', status, envelope: readEnvelope(error) };
}

function readEnvelope(value: unknown): ErrorEnvelope | null {
  if (typeof value !== 'object' || value === null) return null;
  const body = value as { code?: unknown; message_ar?: unknown; message_en?: unknown };
  if (typeof body.code !== 'string') return null;
  if (typeof body.message_ar !== 'string' || typeof body.message_en !== 'string') return null;
  return { code: body.code, message_ar: body.message_ar, message_en: body.message_en };
}
