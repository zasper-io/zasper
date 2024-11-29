import React, { useEffect, useState } from 'react'
import ContextMenu from './sidebar/ContextMenu'

const NavigationPanel = ({ handleNavigationPanel }) => {
  const [menuPosition, setMenuPosition] = useState<{ xPos: number, yPos: number } | null>(null)
  const [isMenuVisible, setIsMenuVisible] = useState<boolean>(false)
  const [contextPath, setContextPath] = useState<string>('')

  const menuBarClickHandler = (e) => {
    e.preventDefault() // prevent the default behaviour when right clicked
    console.log('Left Click')

    setMenuPosition({ xPos: e.pageX, yPos: e.pageY })
    setIsMenuVisible(true)
  }

  const menuItems = [
    { label: 'Open Project', action: () => handleSelectDirectory() },
    { label: 'Edit', action: () => alert('Edit') }
  ]

  const [directory, setDirectory] = useState('');
  const [output, setOutput] = useState('');

  const handleSelectDirectory = async () => {
    const result = await window.api.openDirectory();
    if (result.length > 0) {
      setDirectory(result[0]);
      await window.api.runCommand(result[0]);
      setOutput(`Selected Directory: ${result[0]}`);
    }
  };

  const changeActiveKey = () => {
    // setActiveTab('demo');
  }

  const handleCloseMenu = () => {
    setIsMenuVisible(false)
  }

  return (
    <div className='navigation-list'>
      <button className='editor-button nav-link' onClick={(e) => menuBarClickHandler(e)}><img src='./images/editor/menu-bar.svg' alt='' /></button>
      <button className='editor-button nav-link active' onClick={() => handleNavigationPanel('fileBrowser')}><img src='./images/editor/feather-file-text.svg' alt='' /></button>
      <button className='editor-button nav-link' onClick={() => handleNavigationPanel('gitPanel')}><img src='./images/editor/metro-flow-branch.svg' alt='' /></button>
      <button className='editor-button nav-link' onClick={() => handleNavigationPanel('jupyterInfoPanel')}><img src='./images/editor/feather-box.svg' alt='' /></button>
      <button className='editor-button nav-link' onClick={() => handleNavigationPanel('debugPanel')}><img src='./images/editor/feather-play-circle.svg' alt='' /></button>
      <button className='editor-button nav-link' onClick={() => handleNavigationPanel('secretsPanel')}><img src='./images/editor/feather-lock.svg' alt='' /></button>
      <button className='editor-button nav-link' onClick={() => handleNavigationPanel('settingsPanel')}><img src='./images/editor/feather-settings.svg' alt='' /></button>
      <button className='editor-button nav-link' onClick={() => handleNavigationPanel('databasePanel')}><img src='./images/editor/feather-database.svg' alt='' /></button>
      <button className='editor-button nav-link'><img src='./images/editor/ionic-ios-checkmark-circle-outline.svg' alt='' /></button>
      <button className='editor-button mt-auto help-icon'><i className='fas fa-question-circle' /></button>

      <div>
        {isMenuVisible && (menuPosition != null) && (
          <ContextMenu
            xPos={menuPosition.xPos}
            yPos={menuPosition.yPos}
            items={menuItems}
            path={contextPath}
            onClose={handleCloseMenu}
          />
        )}
      </div>
    </div>
  )
}

export default NavigationPanel
