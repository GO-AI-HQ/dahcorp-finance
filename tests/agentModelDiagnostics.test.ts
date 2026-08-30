import { describe, expect, it } from 'vitest';
import { safeOpenAIErrorFromPayload } from '../src/agent/openaiDiagnostics.js';

describe('safeOpenAIErrorFromPayload', () => {
  it('returns only OpenAI error type and code', () => {
    expect(safeOpenAIErrorFromPayload({
      error: {
        message: 'Sensitive provider detail that must not be surfaced',
        type: 'invalid_request_error',
        code: 'invalid_api_key',
        param: 'authorization',
      },
    })).toEqual({
      type: 'invalid_request_error',
      code: 'invalid_api_key',
    });
  });

  it('rejects arbitrary or unsafe diagnostic values', () => {
    expect(safeOpenAIErrorFromPayload({
      error: {
        type: 'invalid request error with spaces',
        code: 'secret-looking value sk-example',
      },
    })).toEqual({
      type: null,
      code: null,
    });
  });

  it('handles non-OpenAI payloads without exposing anything', () => {
    expect(safeOpenAIErrorFromPayload({ message: 'Unauthorized' })).toEqual({
      type: null,
      code: null,
    });
  });
});
