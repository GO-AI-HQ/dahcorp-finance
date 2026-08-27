/**
 * Shared HTTP helpers for the Netlify Functions layer.
 *
 * Every response is explicitly no-store: this dashboard renders private
 * financial positions and must never be cached by a proxy or a browser.
 */
export const NO_STORE_HEADERS: Record<string, string> = {
  'Content-Type': 'application/json; charset=utf-8',
  'Cache-Control': 'no-store, no-cache, must-revalidate, private',
  'X-Content-Type-Options': 'nosniff',
  'X-Robots-Tag': 'noindex, nofollow, noarchive',
  Vary: 'Cookie',
};

export function json(body: unknown, status = 200, extraHeaders: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...NO_STORE_HEADERS, ...extraHeaders },
  });
}

export function fail(status: number, code: string, message: string, extra: Record<string, unknown> = {}): Response {
  return json({ error: { code, message }, ...extra }, status);
}

export function methodNotAllowed(allowed: string[]): Response {
  return json({ error: { code: 'METHOD_NOT_ALLOWED', message: `Allowed: ${allowed.join(', ')}` } }, 405, {
    Allow: allowed.join(', '),
  });
}

export async function readJsonBody<T>(req: Request): Promise<T | null> {
  try {
    const text = await req.text();
    if (!text) return null;
    return JSON.parse(text) as T;
  } catch {
    return null;
  }
}

/**
 * Wraps a handler so an unexpected throw becomes a logged, non-leaking 500.
 * Internal messages are logged server-side and never returned to the browser.
 */
export function withErrorHandling(name: string, handler: (req: Request) => Promise<Response>) {
  return async (req: Request): Promise<Response> => {
    try {
      return await handler(req);
    } catch (error) {
      console.error(`[dahcorp] ${name} failed:`, error);
      return fail(500, 'INTERNAL_ERROR', 'The request could not be completed. The error has been logged.');
    }
  };
}
