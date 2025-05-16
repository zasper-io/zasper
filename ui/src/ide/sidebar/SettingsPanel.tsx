import React from 'react';
import { useAtom } from 'jotai';
import { themeAtom } from '../../store/Settings';
import './SettingsPanel.scss';
import { BaseApiUrl } from '../config';

export default function SettingsPanel({ display }) {
  const [theme, setTheme] = useAtom(themeAtom);

  const options = [
    { label: 'Light', value: 'light' },
    { label: 'Dark', value: 'dark' },
  ];

  const changeTheme = (e) => {
    setTheme(e.target.value);
    fetch(BaseApiUrl + '/api/config/modify', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${localStorage.getItem('token')}`,
      },
      body: JSON.stringify({ key: 'theme', value: e.target.value }),
    });
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
