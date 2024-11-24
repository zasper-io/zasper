import React, { useState, useEffect } from 'react'
import { useAtom } from 'jotai'
import { settingsAtom, themeAtom } from '../../store/Settings'

export default function SettingsPanel ({ sendDataToParent, display }) {
  const [settings, setSettings] = useAtom(settingsAtom)
  const [theme, setTheme] = useAtom(themeAtom)
  const toggleTheme = () => {
    setTheme(theme => (theme === "light" ? "dark" : "light"))
  }

  return (

    <div className={display}>
      <div className='nav-content'>
        <div className='content-head'>
          <h6>Settings</h6>
          <div />
        </div>
        <div className='content-inner'>
          <ul className='file-list list-unstyled'>
            <li>Tab Size: {settings.tabSize}</li>
            <button onClick={toggleTheme}>{theme}</button>
          </ul>
        </div>
      </div>
    </div>
  )
}
