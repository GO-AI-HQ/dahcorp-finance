import type { IntelligencePayload } from '../intelligence/types.js';

class IntelligenceApiError extends Error {
  constructor(message: string, readonly status: number) {
    super(message);
    this.name = 'IntelligenceApiError';
  }
}

async function request(path: string): Promise<IntelligencePayload> {
  let response: Response;
  try {
    response = await fetch(`/.netlify/functions${path}`, {
      credentials: 'same-origin',
      headers: { Accept: 'application/json' },
    });
  } catch {
    throw new IntelligenceApiError('Market Intelligence is temporarily unreachable.', 0);
  }
  if (!response.ok) throw new IntelligenceApiError(`Market Intelligence request failed (${response.status}).`, response.status);
  return (await response.json()) as IntelligencePayload;
}

export const intelligenceApi = {
  current: () => request('/intelligence'),
  refresh: () => request('/intelligence?refresh=1'),
};
