export class HttpError extends Error {
  readonly status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

export function json(value: unknown, status = 200): Response {
  return Response.json(value, { status, headers: { 'cache-control': 'no-store' } });
}

export function errorResponse(error: unknown): Response {
  if (error instanceof HttpError) return json({ error: error.message }, error.status);
  console.error(error);
  return json({ error: 'Something went wrong. Please retry.' }, 500);
}

/** Parse a bounded JSON object body. */
export async function readJson(
  request: Request,
  maxBytes = 64_000,
): Promise<Record<string, unknown>> {
  if (!request.headers.get('content-type')?.includes('application/json')) {
    throw new HttpError(415, 'Send a JSON body.');
  }
  const text = await request.text();
  if (text.length > maxBytes) throw new HttpError(413, 'Request body is too large.');
  try {
    const value: unknown = JSON.parse(text);
    if (value && typeof value === 'object' && !Array.isArray(value))
      return value as Record<string, unknown>;
  } catch {
    // Fall through to the validation error.
  }
  throw new HttpError(400, 'Send a JSON object.');
}

export function optionalString(value: unknown, field: string, max = 2000): string | undefined {
  if (value === undefined || value === null) return undefined;
  if (typeof value !== 'string' || value.length > max)
    throw new HttpError(400, `Invalid ${field}.`);
  return value.trim() || undefined;
}

export function requiredString(value: unknown, field: string, max = 2000): string {
  const text = optionalString(value, field, max);
  if (!text) throw new HttpError(400, `${field} is required.`);
  return text;
}

export function isoDate(value: unknown, field: string): string {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/u.test(value) || !Date.parse(value)) {
    throw new HttpError(400, `${field} must be a YYYY-MM-DD date.`);
  }
  return value;
}

export function uuid(value: unknown): string {
  if (value === undefined) return crypto.randomUUID();
  if (typeof value !== 'string' || !/^[A-Za-z0-9._:-]{8,160}$/u.test(value)) {
    throw new HttpError(400, 'Invalid id.');
  }
  return value;
}

/** Read a provider response with a size cap so a hostile page cannot exhaust memory. */
export async function readBoundedText(response: Response, maxBytes: number): Promise<string> {
  const reader = response.body?.getReader();
  if (!reader || Number(response.headers.get('content-length') ?? 0) > maxBytes) {
    throw new Error('Provider response too large');
  }
  const chunks: Uint8Array[] = [];
  let size = 0;
  for (let part = await reader.read(); !part.done; part = await reader.read()) {
    size += part.value.byteLength;
    if (size > maxBytes) {
      await reader.cancel();
      throw new Error('Provider response too large');
    }
    chunks.push(part.value);
  }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return new TextDecoder().decode(bytes);
}
