import { describe, expect, it } from 'vitest';
import { safeOpenAIErrorFromPayload } from '../src/agent/openaiDiagnostics.js';

describe('safeOpenAIErrorFromPayload', () => {
  it('returns only safe OpenAI error type, code, and param', () => {
    expect(safeOpenAIErrorFromPayload({
      error: {
        message: 'Sensitive provider detail that must not be surfaced',
        type: 'invalid_request_error',
        code: 'prompt_variable_unknown',
        param: 'prompt.variables.shadow_evidence',
      },
    })).toEqual({
      type: 'invalid_request_error',
      code: 'prompt_variable_unknown',
      param: 'prompt.variables.shadow_evidence',
    });
  });

  it('rejects arbitrary or unsafe diagnostic values', () => {
    expect(safeOpenAIErrorFromPayload({
      error: {
        type: 'invalid request error with spaces',
        code: 'secret-looking value sk-example',
        param: 'prompt variables with spaces',
      },
    })).toEqual({
      type: null,
      code: null,
      param: null,
    });
  });

  it('handles non-OpenAI payloads without exposing anything', () => {
    expect(safeOpenAIErrorFromPayload({ message: 'Unauthorized' })).toEqual({
      type: null,
      code: null,
      param: null,
    });
  });
});
