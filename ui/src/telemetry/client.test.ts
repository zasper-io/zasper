import { beforeEach, describe, expect, it, vi } from 'vitest';

import { flush, setEnabled, trackTabOpened } from './client';

const sendTelemetry = vi.fn();
vi.mock('@/api/telemetry', () => ({ sendTelemetry: (events: unknown) => sendTelemetry(events) }));

describe('trackTabOpened', () => {
  beforeEach(() => {
    sendTelemetry.mockReset();
    setEnabled(true);
  });

  it('counts a file by its extension, and a diff not as a file at all', () => {
    trackTabOpened('diff', 'analysis.py (turn 1)');
    trackTabOpened('disk-diff', 'analysis.py (on disk)');
    trackTabOpened('file', 'analysis.py');
    flush();

    expect(sendTelemetry).toHaveBeenCalledExactlyOnceWith([
      { event: 'file_opened', properties: { extension: 'py' } },
    ]);
  });
});
