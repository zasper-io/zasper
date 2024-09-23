import React, { useState, useEffect } from 'react'

import { themes, useTheme } from '../../themes/theme'

export default function Toolbar (props) {
  const { theme, toggleTheme } = useTheme()

  return (
    <div className='toolBar'>
      <h3>Toolbar</h3>
      <button onClick={toggleTheme}>{theme === themes.light ? 'Light' : 'Dark'}</button>
    </div>
  )
}
