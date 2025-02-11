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
import { fileBrowserReloadCountAtom, fontSizeAtom, languageModeAtom, terminalsAtom } from '../store/AppState';

interface Ifile {
  type: string
  path: string
  name: string
  active: boolean
  extension: string | null
  load_required: boolean
  kernelspec: string
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
  const [, setLanguageMode] = useAtom(languageModeAtom)
  const [terminals, setTerminals] = useAtom(terminalsAtom)
  const [reloadCount] = useAtom(fileBrowserReloadCountAtom)

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
      path: 'Launcher',
      name: 'Launcher',
      active: true,
      extension: 'txt',
      load_required: false,
      kernelspec: 'none'
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

  const handleDataFromChild = (name: string, path: string, type: string, kernelspec: string) => {
    const updatedDataFromChild = { ...dataFromChild };
    const fileData: Ifile = {
      type,
      path,
      name,
      extension: getFileExtension(name),
      active: true,
      load_required: true,
      kernelspec: kernelspec
    };

    Object.keys(updatedDataFromChild).forEach(key => {
      updatedDataFromChild[key] = { ...updatedDataFromChild[key], active: false, load_required: false };
    });
    if (updatedDataFromChild[path]) {
      updatedDataFromChild[path] = { ...updatedDataFromChild[path], active: true };
    } else {
      updatedDataFromChild[path] = fileData;
    }
    if(updatedDataFromChild[path].extension){
      setLanguageMode( updatedDataFromChild[path].extension)
    }
    

    setDataFromChild(updatedDataFromChild);
  };

  function handlCloseTabSignal (key) {
    console.log('closing key', key)
    const updatedDataFromChild: IfileDict = Object.assign({}, dataFromChild)
    if ("Launcher" in updatedDataFromChild){
      updatedDataFromChild["Launcher"]["active"] = true
    }
    delete updatedDataFromChild[key]
    setDataFromChild(updatedDataFromChild)
    console.log(updatedDataFromChild)

    var updatedterminals = { ...terminals };
    delete updatedterminals[key] 
    setTerminals(updatedterminals)
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
          <Topbar sendDataToParent={handleDataFromChild}/>
        </Panel>
        <PanelResizeHandle disabled/>
        <Panel defaultSize={92.5} maxSize={93}>
          <PanelGroup direction='horizontal'>
            <Panel defaultSize={20} minSize={20}>
              <div className='navigation'>
                <NavigationPanel handleNavigationPanel={handleNavigationPanel} />
                <div className='sideBar'>
                  <FileBrowser sendDataToParent={handleDataFromChild} display={navState.fileBrowser.display} reloadCount={reloadCount} />
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
        <PanelResizeHandle disabled />
        <Panel maxSize={2.5}>
          <StatusBar/>
        </Panel>
      </PanelGroup>

    </div>
  )
}

export default IDE
