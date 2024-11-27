
import NavigationPanel from './NavigationPanel'

import React, { useState } from 'react'
import { Panel, PanelGroup, PanelResizeHandle } from 'react-resizable-panels'
import { useAtom } from 'jotai'

import FileBrowser from './sidebar/FileBrowser'
import './IDE.scss'

import ContentPanel from './editor/ContentPanel'
import TabIndex from './tabs/TabIndex'
import Topbar from './topbar/Topbar'
import getFileExtension from './utils'
import { settingsAtom, themeAtom } from '../store/Settings'
import SettingsPanel from './settings/SettingsPanel'
import GitPanel from './sidebar/GitPanel'

interface Ifile {
  type: string
  path: string
  name: string
  display: string
  extension: string | null
  load_required: boolean
}

interface IfileDict {
  [id: string]: Ifile
}

interface INav {
  name: string
  display: string
}

interface INavDict {
  [id: string]: INav
}

function IDE () {
  const [settings, setSettings] = useAtom(settingsAtom)
  const [theme, setTheme] = useAtom(themeAtom)

  const fileBrowser: INav = {
    name: 'fileBrowser',
    display: 'd-block'
  }

  const settingsPanel: INav = {
    name: 'settingsPanel',
    display: 'd-none'
  }

  const gitPanel: INav = {
    name: 'gitPanel',
    display: 'd-none'
  }

  const navStateDict: INavDict = {
    fileBrowser: fileBrowser,
    settingsPanel: settingsPanel,
    gitPanel: gitPanel

  }

  const ksfile: Ifile = {
    type: 'launcher',
    path: 'none',
    name: 'Launcher',
    display: 'd-block',
    extension: 'txt',
    load_required: false
  }

  const ksfileDict: IfileDict = {
    Launcher: ksfile
  }

  const [dataFromChild, setDataFromChild] = useState<IfileDict>(ksfileDict)
  const [navState, setNavState] = useState<INavDict>(navStateDict)

  function handleNavigationPanel (name: string) {
    console.log(name)
    const updatedNavState: INavDict = Object.assign({}, navState)
    for (const key in updatedNavState) {
      updatedNavState[key].display = 'd-none'
    }
    updatedNavState[name].display = 'd-block'
    setNavState(updatedNavState)
  }

  function handleDataFromChild (name: string, path: string, type: string) {
    console.log(name, type)
    if (dataFromChild[name] === undefined) {
      const fileData: Ifile = {
        type,
        path,
        name,
        extension: getFileExtension(name),
        display: 'd-block',
        load_required: true
      }

      const updatedDataFromChild: IfileDict = Object.assign({}, dataFromChild)
      for (const key in updatedDataFromChild) {
        updatedDataFromChild[key].display = 'd-none'
        updatedDataFromChild[key].load_required = false
      }
      updatedDataFromChild[name.toString()] = fileData
      console.log(updatedDataFromChild)
      setDataFromChild(updatedDataFromChild)
    } else {
      const updatedDataFromChild: IfileDict = Object.assign({}, dataFromChild)
      for (const key in updatedDataFromChild) {
        updatedDataFromChild[key].display = 'd-none'
        updatedDataFromChild[key].load_required = false
      }
      updatedDataFromChild[name].display = 'd-block'
      setDataFromChild(updatedDataFromChild)
    }
    console.log('state: ', dataFromChild)
  }

  function handlCloseTabSignal (key) {
    console.log('closing key', key)
    const updatedDataFromChild: IfileDict = Object.assign({}, dataFromChild)
    delete updatedDataFromChild[key]
    setDataFromChild(updatedDataFromChild)
    console.log(updatedDataFromChild)
  }

  return (
    <div className={theme === 'light'? 'editor themeLight': 'editor themeDark'}>
      <PanelGroup direction='vertical'>
        <Panel defaultSize={5}>
          <Topbar />
        </Panel>
        <Panel defaultSize={93} maxSize={93}>
          <PanelGroup direction='horizontal'>
            <Panel defaultSize={20} minSize={20}>
              <div className='navigation'>
                <NavigationPanel handleNavigationPanel={handleNavigationPanel} />
                <div className='sideBar'>
                  <FileBrowser sendDataToParent={handleDataFromChild} display={navState.fileBrowser.display} />
                  <SettingsPanel sendDataToParent={handleDataFromChild} display={navState.settingsPanel.display} />
                  <GitPanel sendDataToParent={handleDataFromChild} display={navState.gitPanel.display}/>
                </div>
              </div>
            </Panel>
            <PanelResizeHandle />
            <Panel defaultSize={80} minSize={50}>
              <div className='main-content'>
                <TabIndex tabs={dataFromChild} sendDataToParent={handleDataFromChild} sendCloseSignalToParent={handlCloseTabSignal} />
                <ContentPanel tabs={dataFromChild} sendDataToParent={handleDataFromChild} theme={theme}/>
              </div>
            </Panel>
          </PanelGroup>
        </Panel>
        <Panel maxSize={2}>
          <div className='statusBar'>
            Spaces: {settings.tabSize} | {settings.encoding} | {settings.language} | Ln {settings.activeLine}, Col {settings.activeColumn}
          </div>
        </Panel>
      </PanelGroup>

    </div>
  )
}

export default IDE
