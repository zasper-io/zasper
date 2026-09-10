import React from 'react';
import { useAtom } from 'jotai';
import { toast } from 'react-toastify';
import { telemetryAtom, themeAtom } from '@/store/Settings';
import { logApiError, modifyConfig } from '@/api';
import { setTelemetrySettings } from '@/api/telemetry';
import { PanelProps } from '../types';
import { themes } from '@/themes';
import { setEnabled, track } from '@/telemetry';

export default function SettingsPanel({ hidden }: PanelProps) {
  const [theme, setTheme] = useAtom(themeAtom);
  const [telemetry, setTelemetry] = useAtom(telemetryAtom);

  const changeTheme = (e: React.ChangeEvent<HTMLSelectElement>) => {
    setTheme(e.target.value);
    modifyConfig('theme', e.target.value).catch(logApiError('Error saving theme:'));
    track('theme_changed', { theme_id: e.target.value });
  };

  const changeTelemetry = (e: React.ChangeEvent<HTMLInputElement>) => {
    const enabled = e.target.checked;
    // Applied locally first so the collector stops the moment the box is cleared, rather than at the
    // end of a round trip that may fail.
    setEnabled(enabled);
    setTelemetry({ ...telemetry, enabled });
    setTelemetrySettings({ enabled })
      .then((settings) => {
        setEnabled(settings.enabled);
        setTelemetry(settings);
      })
      .catch(logApiError('Error saving the usage data setting:'));
  };

  const resetTrackingId = () => {
    setTelemetrySettings({ reset_id: true })
      .then(() => toast.success('A new anonymous ID was generated.'))
      .catch(logApiError('Error resetting the anonymous ID:'));
  };

  return (
    <div className={hidden ? 'nav-content is-hidden' : 'nav-content'}>
      <div className="content-head">
        <div className="z-label">Settings</div>
      </div>
      <div className="content-inner">
        {/* A section heading, not a .projectBanner — that purple bar means "this is the
            open project" everywhere else. */}
        <h2 className="z-label panel-section-head">Appearance</h2>
        <div className="panel-section-body z-form-field">
          <label className="z-form-label" htmlFor="settings-theme">
            Theme
          </label>
          <div className="z-select">
            {/* Driven by the theme registry, so a new theme shows up here
                without touching this component. */}
            <select id="settings-theme" value={theme} onChange={(e) => changeTheme(e)}>
              {themes.map((option) => (
                <option key={option.id} value={option.id}>
                  {option.label}
                </option>
              ))}
            </select>
          </div>
        </div>

        <h2 className="z-label panel-section-head">Privacy</h2>
        <div className="panel-section-body z-form-field">
          <label className="z-checkbox">
            <input type="checkbox" checked={telemetry.enabled} onChange={changeTelemetry} />
            Send anonymous usage data
          </label>
          <p className="z-form-help">
            Counts of what gets used — never file names, paths, or code.{' '}
            <a
              href="https://github.com/zasper-io/zasper/blob/main/PRIVACY.md"
              target="_blank"
              rel="noreferrer"
            >
              PRIVACY.md
            </a>{' '}
            lists every event.
          </p>
        </div>
        <div className="panel-section-body z-form-field">
          <button type="button" className="z-button z-button-secondary" onClick={resetTrackingId}>
            Reset anonymous ID
          </button>
          <p className="z-form-help">
            Breaks the link between what has already been sent and what is sent next.
          </p>
        </div>
      </div>
    </div>
  );
}
