import React from 'react';
import { useAtom } from 'jotai';
import { themeAtom } from '../../store/Settings';
import './SettingsPanel.scss';

export default function SettingsPanel({ display }) {
  const [theme, setTheme] = useAtom(themeAtom);

  const options = [
    { label: 'Light', value: 'light' },
    { label: 'Dark', value: 'dark' },
  ];

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
            <select value={theme} onChange={(e) => setTheme(e.target.value)}>
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
