import { useCallback, useEffect } from 'react';
import { useAtom } from 'jotai';
import { toast } from 'react-toastify';

import { getTelemetrySettings, setTelemetrySettings } from '@/api/telemetry';
import { telemetryAtom } from '@/store/Settings';

import { installFlushOnUnload, setEnabled } from './client';

/**
 * Boots telemetry from what the server says, and shows the first-run notice once.
 *
 * The server is the authority on whether anything is sent — `--tracking=false` and ZASPER_TELEMETRY
 * both outrank the stored setting, and neither is visible from here — so this asks rather than
 * assumes, and the collector stays off until the answer arrives.
 */
export function useTelemetry(): void {
  const [, setTelemetry] = useAtom(telemetryAtom);

  const showNotice = useCallback(() => {
    toast.info(
      'Zasper sends anonymous usage data — no file names, paths or code. See PRIVACY.md, or turn it off in Settings.',
      { autoClose: 12000, toastId: 'telemetry-notice' }
    );
    // Recording the choice is what stops the notice coming back. It is deliberately not conditional
    // on the user acknowledging it: the notice is notice, not a consent gate.
    setTelemetrySettings({ enabled: true }).catch(() => {});
  }, []);

  useEffect(() => {
    let cancelled = false;

    getTelemetrySettings()
      .then((settings) => {
        if (cancelled) {
          return;
        }
        setEnabled(settings.enabled);
        setTelemetry({ enabled: settings.enabled, chosen: settings.chosen });
        if (settings.enabled && !settings.chosen) {
          showNotice();
        }
      })
      // A server too old to know the endpoint, or one that could not answer. Staying off is the only
      // safe way to be wrong here.
      .catch(() => setEnabled(false));

    const remove = installFlushOnUnload();
    return () => {
      cancelled = true;
      remove();
    };
  }, [setTelemetry, showNotice]);
}
