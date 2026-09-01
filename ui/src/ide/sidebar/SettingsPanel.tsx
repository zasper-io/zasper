import React from 'react';
import { useAtom } from 'jotai';
import { themeAtom } from '../../store/Settings';
import './SettingsPanel.scss';
import { logApiError, modifyConfig } from '../../api';
import { PanelProps } from './types';

export default function SettingsPanel({ display }: PanelProps) {
  const [theme, setTheme] = useAtom(themeAtom);

  const options = [
    { label: 'Light', value: 'light' },
    { label: 'Dark', value: 'dark' },
  ];

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
            <select value={theme} onChange={(e) => changeTheme(e)}>
              {options.map((option, index) => (
                <option key={index} value={option.value}>
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
