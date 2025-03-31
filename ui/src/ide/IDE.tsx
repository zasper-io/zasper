import React, { useEffect, useState, useCallback } from 'react';
import { useAtom } from 'jotai';
import { Panel, PanelGroup, PanelResizeHandle } from 'react-resizable-panels';
import { themeAtom } from '../store/Settings';

import NavigationPanel from './sidebar/NavigationPanel/NavigationPanel';
import FileBrowser from './sidebar/FileBrowser/FileBrowser';
import ContentPanel from './editor/ContentPanel';
import TabIndex from './tabs/TabIndex';
import Topbar from './topbar/Topbar';
import GitPanel from './sidebar/GitPanel';
import JupyterInfoPanel from './sidebar/JupyterInfoPanel/JupyterInfoPanel';
import SettingsPanel from './sidebar/SettingsPanel';
import DebugPanel from './sidebar/DebugPanel';
import DatabasePanel from './sidebar/DatabasePanel';
import SecretsPanel from './sidebar/SecretsPanel';
import StatusBar from './statusBar/StatusBar';

import './IDE.scss';
import {
  fileBrowserReloadCountAtom,
  fontSizeAtom,
  projectNameAtom,
  userNameAtom,
  zasperVersionAtom,
} from '../store/AppState';
import { BaseApiUrl } from './config';
interface INav {
  name: string;
  display: string;
}

interface INavDict {
  [id: string]: INav;
}

function IDE() {
  const [theme, setTheme] = useAtom(themeAtom);
  const [reloadCount] = useAtom(fileBrowserReloadCountAtom);
  const [, setProjectName] = useAtom(projectNameAtom);
  const [, setUserName] = useAtom(userNameAtom);
  const [, setVersion] = useAtom(zasperVersionAtom);

  const defaultNavState: INavDict = {
    fileBrowser: { name: 'fileBrowser', display: 'd-block' },
    settingsPanel: { name: 'settingsPanel', display: 'd-none' },
    gitPanel: { name: 'gitPanel', display: 'd-none' },
    jupyterInfoPanel: { name: 'jupyterInfoPanel', display: 'd-none' },
    debugPanel: { name: 'debugPanel', display: 'd-none' },
    databasePanel: { name: 'databasePanel', display: 'd-none' },
    secretsPanel: { name: 'secretsPanel', display: 'd-none' },
  };

  const [navState, setNavState] = useState<INavDict>(defaultNavState);

  const handleNavigationPanel = (name: string) => {
    const updatedNavState = Object.fromEntries(
      Object.keys(navState).map((key) => [
        key,
        { ...navState[key], display: key === name ? 'd-block' : 'd-none' },
      ])
    );
    setNavState(updatedNavState);
  };

  const [fontSize, setFontSize] = useAtom(fontSizeAtom); // Initial font size

  // Helper function to handle keydown events
  const handleKeyDown = useCallback(
    (event) => {
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
      }
    },
    [setFontSize]
  );

  const initConfig = useCallback(async () => {
    const res = await fetch(BaseApiUrl + '/api/info');
    const resJson = await res.json();

    setProjectName(resJson.project.toUpperCase());
    setUserName(resJson.username);
    setVersion(resJson.version);
    setTheme(resJson.theme);
  }, [setProjectName, setUserName, setVersion, setTheme]);

  useEffect(() => {
    initConfig();
  }, [initConfig]);

  useEffect(() => {
    // Listen to the keydown event
    window.addEventListener('keydown', handleKeyDown);

    // Clean up the event listener on component unmount
    return () => {
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, [handleKeyDown]);

  const getFontClass = (fontSize: number) => {
    return 'zfont-' + fontSize;
  };

  return (
    <div className={theme === 'light' ? 'editor themeLight' : 'editor themeDark'}>
      <Topbar />
      <div className="editor-container">
        <PanelGroup direction="horizontal">
          <Panel defaultSize={20} minSize={20}>
            <div className="navigation">
              <NavigationPanel handleNavigationPanel={handleNavigationPanel} />
              <div className="sideBar">
                <FileBrowser display={navState.fileBrowser.display} reloadCount={reloadCount} />
                <SettingsPanel display={navState.settingsPanel.display} />
                <JupyterInfoPanel display={navState.jupyterInfoPanel.display} />
                <GitPanel display={navState.gitPanel.display} />
                <DebugPanel display={navState.debugPanel.display} />
                <DatabasePanel display={navState.databasePanel.display} />
                <SecretsPanel display={navState.secretsPanel.display} />
              </div>
            </div>
          </Panel>
          <PanelResizeHandle />
          <Panel defaultSize={80} minSize={50}>
            <div className={'main-content ' + getFontClass(fontSize)}>
              <TabIndex />
              <ContentPanel theme={theme} />
            </div>
          </Panel>
        </PanelGroup>
      </div>
      <StatusBar />
    </div>
  );
}

export default IDE;
