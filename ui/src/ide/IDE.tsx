import React, { useEffect, useState, useCallback } from 'react';
import { useAtom } from 'jotai';
import { Panel, PanelGroup, PanelResizeHandle } from 'react-resizable-panels';
import { themeAtom } from '../store/Settings';

import NavigationPanel from './sidebar/NavigationPanel/NavigationPanel';
import FileBrowser from './sidebar/FileBrowser/FileBrowser';
import ContentPanel from './editor/ContentPanel';
import TabIndex from './tabs/TabIndex';
import Topbar from './topbar/Topbar';
import GitPanel from './sidebar/GitPanel/GitPanel';
import JupyterInfoPanel from './sidebar/JupyterInfoPanel/JupyterInfoPanel';
import SettingsPanel from './sidebar/SettingsPanel/SettingsPanel';
import DebugPanel from './sidebar/DebugPanel';
import DatabasePanel from './sidebar/DatabasePanel';
import SecretsPanel from './sidebar/SecretsPanel';
import StatusBar from './statusBar/StatusBar';

import './IDE.scss';
import {
  fileBrowserReloadCountAtom,
  fontSizeAtom,
  projectNameAtom,
  protectedStateAtom,
  userNameAtom,
  zasperVersionAtom,
} from '../store/AppState';
import { ApiError, getInfo } from '../api';
import { getTheme } from '../themes';
import { PanelName } from './sidebar/types';

function IDE() {
  const [theme, setTheme] = useAtom(themeAtom);
  const [reloadCount] = useAtom(fileBrowserReloadCountAtom);
  const [, setProjectName] = useAtom(projectNameAtom);
  const [, setProtectedState] = useAtom(protectedStateAtom);
  const [, setUserName] = useAtom(userNameAtom);
  const [, setVersion] = useAtom(zasperVersionAtom);

  const [activePanel, setActivePanel] = useState<PanelName>('fileBrowser');

  const [fontSize, setFontSize] = useAtom(fontSizeAtom); // Initial font size

  // Helper function to handle keydown events
  const handleKeyDown = useCallback(
    (event: KeyboardEvent) => {
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
    let info;
    try {
      info = await getInfo();
    } catch (error) {
      if (error instanceof ApiError && error.status === 401) {
        localStorage.removeItem('token');
        window.location.href = '/login';
        return;
      }
      throw error;
    }

    setProjectName(info.project.toUpperCase());
    setUserName(info.username);
    setVersion(info.version);
    // Resolve through the registry so a config naming a theme we no longer ship
    // falls back instead of writing a data-theme with no stylesheet behind it.
    setTheme(getTheme(info.theme).id);
    setProtectedState(info.protected);
  }, [setProjectName, setUserName, setVersion, setTheme, setProtectedState]);

  useEffect(() => {
    initConfig();
  }, [initConfig]);

  // Publish the active theme as `data-theme` on <html>. Every colour in the app
  // resolves through the custom properties keyed off this attribute (see
  // styles/_tokens.scss), so this one write repaints the whole UI.
  useEffect(() => {
    document.documentElement.dataset.theme = theme;
  }, [theme]);

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
    <div className="editor">
      <Topbar />
      <div className="editor-container">
        <PanelGroup direction="horizontal">
          <Panel defaultSize={20} minSize={20}>
            <div className="navigation">
              {/* The activity bar reads the same state it writes, so its highlight and
                  the visible panel cannot disagree. */}
              <NavigationPanel activePanel={activePanel} setActivePanel={setActivePanel} />
              <div className="sideBar">
                <FileBrowser hidden={activePanel !== 'fileBrowser'} reloadCount={reloadCount} />
                <SettingsPanel hidden={activePanel !== 'settingsPanel'} />
                <JupyterInfoPanel hidden={activePanel !== 'jupyterInfoPanel'} />
                <GitPanel hidden={activePanel !== 'gitPanel'} />
                <DebugPanel hidden={activePanel !== 'debugPanel'} />
                <DatabasePanel hidden={activePanel !== 'databasePanel'} />
                <SecretsPanel hidden={activePanel !== 'secretsPanel'} />
              </div>
            </div>
          </Panel>
          <PanelResizeHandle />
          <Panel defaultSize={80} minSize={50}>
            <div className={'main-content ' + getFontClass(fontSize)}>
              <TabIndex />
              <ContentPanel />
            </div>
          </Panel>
        </PanelGroup>
      </div>
      <StatusBar />
    </div>
  );
}

export default IDE;
