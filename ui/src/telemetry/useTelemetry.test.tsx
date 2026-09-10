/*
That the first-run notice appears exactly once, and that nothing is sent until the server has said
it should be.

PRIVACY.md tells people Zasper says so on first run. Nothing tested that, so the sentence in the
document depended on a toast call surviving every future refactor of this hook. These are the tests
that make the claim true rather than hopeful.
*/
import { render, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('react-toastify', () => ({ toast: { info: vi.fn() } }));
vi.mock('@/api/telemetry', () => ({
  getTelemetrySettings: vi.fn(),
  setTelemetrySettings: vi.fn(() => Promise.resolve({ enabled: true, chosen: true })),
}));
vi.mock('@/telemetry/client', () => ({
  installFlushOnUnload: () => () => {},
  setEnabled: vi.fn(),
}));

import { toast } from 'react-toastify';

import { getTelemetrySettings, setTelemetrySettings } from '@/api/telemetry';
import { setEnabled } from '@/telemetry/client';

import { useTelemetry } from './useTelemetry';

function Probe() {
  useTelemetry();
  return null;
}

describe('the first-run telemetry notice', () => {
  beforeEach(() => vi.clearAllMocks());

  it('appears on an install that has never been asked', async () => {
    vi.mocked(getTelemetrySettings).mockResolvedValue({ enabled: true, chosen: false });

    render(<Probe />);

    await waitFor(() => expect(toast.info).toHaveBeenCalledTimes(1));
    const [message] = vi.mocked(toast.info).mock.calls[0];
    expect(message).toContain('PRIVACY.md');
    expect(message).toMatch(/anonymous/i);
  });

  it('records the choice, so it does not come back next launch', async () => {
    vi.mocked(getTelemetrySettings).mockResolvedValue({ enabled: true, chosen: false });

    render(<Probe />);

    // The notice is notice, not a consent gate: showing it is what marks the install as asked.
    await waitFor(() => expect(setTelemetrySettings).toHaveBeenCalledWith({ enabled: true }));
  });

  it('stays quiet once a choice has been recorded', async () => {
    vi.mocked(getTelemetrySettings).mockResolvedValue({ enabled: true, chosen: true });

    render(<Probe />);

    await waitFor(() => expect(getTelemetrySettings).toHaveBeenCalled());
    expect(toast.info).not.toHaveBeenCalled();
  });

  // --tracking=false and ZASPER_TELEMETRY=0 are per-run and outrank the stored setting, so an
  // install that has never been asked still gets no notice when this run is not sending anything.
  it('says nothing when the run is not sending anything anyway', async () => {
    vi.mocked(getTelemetrySettings).mockResolvedValue({ enabled: false, chosen: false });

    render(<Probe />);

    await waitFor(() => expect(setEnabled).toHaveBeenCalledWith(false));
    expect(toast.info).not.toHaveBeenCalled();
  });

  it('leaves the collector off when the server cannot be asked', async () => {
    vi.mocked(getTelemetrySettings).mockRejectedValue(new Error('no answer'));

    render(<Probe />);

    await waitFor(() => expect(setEnabled).toHaveBeenCalledWith(false));
    expect(toast.info).not.toHaveBeenCalled();
  });
});
