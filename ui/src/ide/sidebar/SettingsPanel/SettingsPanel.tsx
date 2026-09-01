import React from 'react';
import { useAtom } from 'jotai';
import { themeAtom } from '@/store/Settings';
import './SettingsPanel.scss';
import { logApiError, modifyConfig } from '@/api';
import { PanelProps } from '../types';
import { themes } from '@/themes';

export default function SettingsPanel({ hidden }: PanelProps) {
  const [theme, setTheme] = useAtom(themeAtom);

  const changeTheme = (e: React.ChangeEvent<HTMLSelectElement>) => {
    setTheme(e.target.value);
    modifyConfig('theme', e.target.value).catch(logApiError('Error saving theme:'));
  };

  return (
    <div className={hidden ? 'nav-content is-hidden' : 'nav-content'}>
      <div className="content-head">
        <div className="z-label">Settings</div>
      </div>
      <div className="content-inner">
        {/* A section heading, not a .projectBanner — that purple bar means "this is the
            open project" everywhere else. */}
        <h2 className="z-subheading panel-section-head">Appearance</h2>
        <div className="panel-section-body settings-field">
          <label className="settings-field-label" htmlFor="settings-theme">
            Theme
          </label>
          <div className="select">
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
      </div>
    </div>
  );
}
