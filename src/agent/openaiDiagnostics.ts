export interface SafeOpenAIError {
  type: string | null;
  code: string | null;
}

/**
 * OpenAI error bodies may contain arbitrary text. Only short identifier-shaped
 * values are allowed through the diagnostic boundary; raw messages, headers,
 * request data and credentials are never surfaced.
 */
function safeOpenAIIdentifier(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const normalized = value.trim();
  if (!/^[A-Za-z0-9_.:-]{1,80}$/.test(normalized)) return null;
  return normalized;
}

export function safeOpenAIErrorFromPayload(payload: unknown): SafeOpenAIError {
  if (!payload || typeof payload !== 'object') return { type: null, code: null };
  const error = (payload as { error?: unknown }).error;
  if (!error || typeof error !== 'object') return { type: null, code: null };
  const record = error as { type?: unknown; code?: unknown };
  return {
    type: safeOpenAIIdentifier(record.type),
    code: safeOpenAIIdentifier(record.code),
  };
}

export function openAIErrorDiagnostic(error: SafeOpenAIError): string | null {
  const parts = [
    error.type ? `type=${error.type}` : null,
    error.code ? `code=${error.code}` : null,
  ].filter((part): part is string => Boolean(part));
  return parts.length ? parts.join(', ') : null;
}
