import { describe, expect, it } from 'vitest';

import { ApiError, apiErrorMessage } from './client';

/**
 * What the UI shows when a request fails. The server answers errors as
 * `{"error": "...", "message": "..."}` (internal/http/response.go), and the `message` is the only
 * part that says what went wrong.
 */
describe('apiErrorMessage', () => {
  function failed(body: string): ApiError {
    return new ApiError('POST', '/api/contents', 400, body);
  }

  it('reads the message the server sent', () => {
    const body = JSON.stringify({
      error: 'Bad Request',
      message: 'not a valid notebook: unexpected end of JSON input',
    });

    expect(apiErrorMessage(failed(body))).toBe(
      'not a valid notebook: unexpected end of JSON input'
    );
  });

  it('falls back to the raw body when it is not the usual JSON', () => {
    expect(apiErrorMessage(failed('plain text failure'))).toBe('plain text failure');
    expect(apiErrorMessage(failed('{"message": ""}'))).toBe('{"message": ""}');
    expect(apiErrorMessage(failed('{"message": 42}'))).toBe('{"message": 42}');
  });

  it('falls back to the status line when there is no body at all', () => {
    expect(apiErrorMessage(failed(''))).toBe('POST /api/contents failed with status 400');
  });

  it('handles the failures that are not ApiErrors', () => {
    expect(apiErrorMessage(new TypeError('Failed to fetch'))).toBe('Failed to fetch');
    expect(apiErrorMessage('a thrown string')).toBe('An unknown error occurred');
  });
});
