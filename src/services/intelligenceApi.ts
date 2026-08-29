import type { IntelligencePayload } from '../intelligence/types.js';
import { ApiError } from './api.js';

async function request(path: string): Promise<IntelligencePayload> {
  let response: Response;
  try {
    response = await fetch(`/.netlify/functions${path}`, {
      credentials: 'same-origin',
      headers: { Accept: 'application/json' },
    });
  } catch {
    throw new ApiError('Market Intelligence is temporarily unreachable.', 0, 'NETWORK');
  }

  const text = await response.text();
  const body = text ? (JSON.parse(text) as Record<string, unknown>) : {};
  if (!response.ok) {
    const error = (body.error ?? {}) as { code?: string; message?: string };
    throw new ApiError(
      error.message ?? `Market Intelligence request failed (${response.status}).`,
      response.status,
      error.code ?? 'INTELLIGENCE_REQUEST_FAILED',
      body,
    );
  }
  return body as unknown as IntelligencePayload;
}

export const intelligenceApi = {
  current: () => request('/intelligence'),
  refresh: () => request('/intelligence?refresh=1'),
};
