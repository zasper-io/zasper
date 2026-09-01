import React from 'react';
import { useAtom } from 'jotai';
import { themeAtom } from '../../store/Settings';
import './SettingsPanel.scss';
import { logApiError, modifyConfig } from '../../api';
import { PanelProps } from './types';
import { themes } from '../../themes';

export default function SettingsPanel({ display }: PanelProps) {
  const [theme, setTheme] = useAtom(themeAtom);

  const changeTheme = (e: React.ChangeEvent<HTMLSelectElement>) => {
    setTheme(e.target.value);
    modifyConfig('theme', e.target.value).catch(logApiError('Error saving theme:'));
  };

  return (
    <div className={display}>
      <div className="nav-content">
        <div className="content-head">
          <div>SETTINGS</div>
          <div />
        </div>
        <div className="projectBanner">
          <div className="projectName">
            <div>Theme</div>
          </div>
        </div>
        <div className="content-inner">
          <div className="select">
            {/* Driven by the theme registry, so a new theme shows up here
                without touching this component. */}
            <select value={theme} onChange={(e) => changeTheme(e)}>
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
