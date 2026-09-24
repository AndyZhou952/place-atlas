export interface BoundedJsonFetchOptions {
  readonly fetch: typeof fetch;
  readonly timeoutMs: number;
  readonly maximumBytes: number;
}

export async function fetchBoundedJson(
  url: string,
  init: RequestInit,
  options: BoundedJsonFetchOptions,
): Promise<
  { readonly ok: true; readonly value: unknown } | { readonly ok: false }
> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), options.timeoutMs);
  try {
    const response = await options.fetch(url, {
      ...init,
      redirect: 'manual',
      signal: controller.signal,
    });
    if (!response.ok || response.status >= 300) return { ok: false };
    const declaredLength = response.headers.get('content-length');
    if (
      declaredLength !== null &&
      (!/^\d+$/u.test(declaredLength) ||
        Number(declaredLength) > options.maximumBytes)
    ) {
      return { ok: false };
    }
    const body = response.body;
    if (!body) return { ok: false };
    const reader = body.getReader();
    const chunks: Uint8Array[] = [];
    let total = 0;
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > options.maximumBytes) {
        await reader.cancel();
        return { ok: false };
      }
      chunks.push(value);
    }
    const bytes = new Uint8Array(total);
    let offset = 0;
    for (const chunk of chunks) {
      bytes.set(chunk, offset);
      offset += chunk.byteLength;
    }
    return { ok: true, value: JSON.parse(new TextDecoder().decode(bytes)) };
  } catch {
    return { ok: false };
  } finally {
    clearTimeout(timeout);
  }
}
