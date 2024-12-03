import React, { useEffect, useState } from 'react';
import { useAtom } from 'jotai';
import { Panel, PanelGroup, PanelResizeHandle } from 'react-resizable-panels';
import { settingsAtom, themeAtom } from '../store/Settings';

import NavigationPanel from './NavigationPanel';
import FileBrowser from './sidebar/FileBrowser';
import ContentPanel from './editor/ContentPanel';
import TabIndex from './tabs/TabIndex';
import Topbar from './topbar/Topbar';
import GitPanel from './sidebar/GitPanel';
import JupyterInfoPanel from './sidebar/JupyterInfoPanel';
import SettingsPanel from './sidebar/SettingsPanel';
import DebugPanel from './sidebar/DebugPanel';
import DatabasePanel from './sidebar/DatabasePanel';
import SecretsPanel from './sidebar/SecretsPanel';
import StatusBar from './statusBar/StatusBar';

import getFileExtension from './utils';

import './IDE.scss'
import { fontSizeAtom, languageModeAtom } from '../store/AppState';

interface Ifile {
  type: string
  path: string
  name: string
  active: boolean
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
  const [theme] = useAtom(themeAtom)
  const [languageMode, setLanguageMode] = useAtom(languageModeAtom)

  const defaultNavState: INavDict = {
    fileBrowser: { name: 'fileBrowser', display: 'd-block' },
    settingsPanel: { name: 'settingsPanel', display: 'd-none' },
    gitPanel: { name: 'gitPanel', display: 'd-none' },
    jupyterInfoPanel: { name: 'jupyterInfoPanel', display: 'd-none' },
    debugPanel: { name: 'debugPanel', display: 'd-none' },
    databasePanel: { name: 'databasePanel', display: 'd-none' },
    secretsPanel: { name: 'secretsPanel', display: 'd-none' },
  };

  const defaultFileState: IfileDict = {
    Launcher: {
      type: 'launcher',
      path: 'none',
      name: 'Launcher',
      active: true,
      extension: 'txt',
      load_required: false,
    },
  };

  const [prevActiveTab, setPrevActiveTab] = useState("launcher")

  const [dataFromChild, setDataFromChild] = useState<IfileDict>(defaultFileState)
  const [navState, setNavState] = useState<INavDict>(defaultNavState)

  const handleNavigationPanel = (name: string) => {
    const updatedNavState = Object.fromEntries(
      Object.keys(navState).map(key => [
        key, 
        { ...navState[key], display: key === name ? 'd-block' : 'd-none' }
      ])
    );
    setNavState(updatedNavState);
  };

  const handleDataFromChild = (name: string, path: string, type: string) => {
    const updatedDataFromChild = { ...dataFromChild };
    const fileData: Ifile = {
      type,
      path,
      name,
      extension: getFileExtension(name),
      active: true,
      load_required: true,
    };

    Object.keys(updatedDataFromChild).forEach(key => {
      updatedDataFromChild[key] = { ...updatedDataFromChild[key], active: false, load_required: false };
    });
    if (updatedDataFromChild[name]) {
      updatedDataFromChild[name] = { ...updatedDataFromChild[name], active: true };
    } else {
      updatedDataFromChild[name] = fileData;
    }
    if(updatedDataFromChild[name].extension){
      setLanguageMode( updatedDataFromChild[name].extension)
    }
    

    setDataFromChild(updatedDataFromChild);
  };

  function handlCloseTabSignal (key) {
    console.log('closing key', key)
    const updatedDataFromChild: IfileDict = Object.assign({}, dataFromChild)
    delete updatedDataFromChild[key]
    setDataFromChild(updatedDataFromChild)
    console.log(updatedDataFromChild)
  }

  const [fontSize, setFontSize] = useAtom(fontSizeAtom); // Initial font size

  // Helper function to handle keydown events
  const handleKeyDown = (event) => {
    if (event.metaKey) {
      if (event.key === '+' || event.key === '=') {
        // Increase font size
        setFontSize((prevFontSize) => {
          const newSize = Math.min(prevFontSize + 2, 24);
          return newSize;
        });
        
      } else if (event.key === '-') {
        // Decrease font size
        setFontSize((prevFontSize) => {
          const newSize = Math.max(prevFontSize - 2, 8);
          return newSize;
        });
      }
      event.preventDefault();
    }
  };

  useEffect(() => {
    // Listen to the keydown event
    window.addEventListener('keydown', handleKeyDown);

    // Clean up the event listener on component unmount
    return () => {
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, []);

  const getFontClass = (fontSize: number) => {
    return "zfont-" + fontSize
  }

  return (
    <div className={theme === 'light'? 'editor themeLight': 'editor themeDark'}>
      <PanelGroup direction='vertical'>
        <Panel defaultSize={5}>
          <Topbar />
        </Panel>
        <Panel defaultSize={92.5} maxSize={93}>
          <PanelGroup direction='horizontal'>
            <Panel defaultSize={20} minSize={20}>
              <div className='navigation'>
                <NavigationPanel handleNavigationPanel={handleNavigationPanel} />
                <div className='sideBar'>
                  <FileBrowser sendDataToParent={handleDataFromChild} display={navState.fileBrowser.display} />
                  <SettingsPanel sendDataToParent={handleDataFromChild} display={navState.settingsPanel.display} />
                  <JupyterInfoPanel sendDataToParent={handleDataFromChild} display={navState.jupyterInfoPanel.display}/>
                  <GitPanel sendDataToParent={handleDataFromChild} display={navState.gitPanel.display}/>
                  <DebugPanel sendDataToParent={handleDataFromChild} display={navState.debugPanel.display}/>
                  <DatabasePanel sendDataToParent={handleDataFromChild} display={navState.databasePanel.display}/>
                  <SecretsPanel sendDataToParent={handleDataFromChild} display={navState.secretsPanel.display}/>
                </div>
              </div>
            </Panel>
            <PanelResizeHandle />
            <Panel defaultSize={80} minSize={50}>
              <div className={"main-content " + getFontClass(fontSize)}>
                <TabIndex tabs={dataFromChild} sendDataToParent={handleDataFromChild} sendCloseSignalToParent={handlCloseTabSignal} />
                <ContentPanel tabs={dataFromChild} sendDataToParent={handleDataFromChild} theme={theme}/>
              </div>
            </Panel>
          </PanelGroup>
        </Panel>
        <Panel maxSize={2.5}>
          <StatusBar/>
        </Panel>
      </PanelGroup>

    </div>
  )
}

export default IDE
