import React, { useState, useEffect } from 'react'

export default function TabIndex (props) {
  const tabs = props.tabs

  const handleTabClick = async (name: string, path:string, type: string) => {
    props.sendDataToParent(name, path, type)
  }

  const handleTabClose = async (e, key: string) => {
    e.stopPropagation()
    props.sendCloseSignalToParent(key)
  }

  return (

    <div className='tabHeader'>
      <ul className='nav'>
        {Object.keys(tabs).map((key, index) =>
          <li key={index} className='nav-item tab-item' role='presentation'>
            <button type='button' className={tabs[key].active? 'nav-link active': 'nav-link'} 
             onClick={async () => await handleTabClick(tabs[key].name, tabs[key].path, tabs[key].type)}>
              {tabs[key].name}
              <span className='editor-button'>
                <i className='fas fa-times-circle' onClick={async (e) => await handleTabClose(e, key)} />
              </span>
            </button>
          </li>
        )}
      </ul>
    </div>
  )
}
