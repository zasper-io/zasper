import React, { useEffect, useState, useCallback } from 'react';
import { useAtom } from 'jotai';
import { Panel, PanelGroup, PanelResizeHandle } from 'react-resizable-panels';
import { ToastContainer } from 'react-toastify';
import { themeAtom } from '../store/Settings';

import NavigationPanel from './sidebar/NavigationPanel/NavigationPanel';
import FileBrowser from './sidebar/FileBrowser/FileBrowser';
import ContentPanel from './editor/ContentPanel';
import TabIndex from './tabs/TabIndex';
import Topbar from './topbar/Topbar';
import GitPanel from './sidebar/GitPanel/GitPanel';
import JupyterInfoPanel from './sidebar/JupyterInfoPanel/JupyterInfoPanel';
import SettingsPanel from './sidebar/SettingsPanel/SettingsPanel';
import StatusBar from './statusBar/StatusBar';

import './IDE.scss';
import {
  fileBrowserReloadCountAtom,
  projectNameAtom,
  protectedStateAtom,
  userNameAtom,
  zasperVersionAtom,
  zoomLevelAtom,
} from '../store/AppState';
import { ApiError, getInfo } from '../api';
import { useKernelspecActions } from '../store/KernelspecActions';
import { applyTheme, getTheme, rememberTheme } from '../themes';
import { applyZoom, rememberZoomLevel } from '../zoom';
import { PanelName } from './sidebar/types';
import { useAppCommands } from '../commands/appCommands';
import { useRegisterCommands } from '../commands/registry';
import { useCommandKeymap } from '../commands/useCommandKeymap';
import { useTelemetry } from '../telemetry';

function IDE() {
  const [theme, setTheme] = useAtom(themeAtom);
  const [reloadCount] = useAtom(fileBrowserReloadCountAtom);
  const [, setProjectName] = useAtom(projectNameAtom);
  const [, setProtectedState] = useAtom(protectedStateAtom);
  const [, setUserName] = useAtom(userNameAtom);
  const [, setVersion] = useAtom(zasperVersionAtom);
  const { loadKernelspecs } = useKernelspecActions();

  const [activePanel, setActivePanel] = useState<PanelName>('fileBrowser');

  const [zoomLevel] = useAtom(zoomLevelAtom);

  // The application's only keyboard dispatcher, and the window-level commands that used to be a
  // `keydown` listener here. Everything else contributes to the same registry from its own tab.
  useCommandKeymap();
  useRegisterCommands(useAppCommands());
  useTelemetry();

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

  // Read once for the whole session rather than by whoever happens to want them first. The launcher
  // used to fetch them, so the Jupyter info panel listed no kernels at all until the launcher had
  // rendered — and none again once its tab was closed. It can ask for the read again, through the
  // same action, without owning it.
  useEffect(() => {
    loadKernelspecs();
  }, [loadKernelspecs]);

  // Publish the active theme to <html>, as the hue and the polarity it is made of.
  // Every colour in the app resolves through the custom properties keyed off those
  // two attributes (see styles/_accents.scss), so this repaints the whole UI.
  //
  // Remembered as well as applied, because main.tsx applies what is remembered before anything
  // renders — which is the only theme /login will ever see.
  useEffect(() => {
    const resolved = getTheme(theme);
    applyTheme(resolved);
    rememberTheme(resolved.id);
  }, [theme]);

  // Applied to <html>, so it reaches the overlays that hang outside this tree as well.
  // Remembered for the same reason the theme is: main.tsx puts it back before the first render.
  useEffect(() => {
    applyZoom(zoomLevel);
    rememberZoomLevel(zoomLevel);
  }, [zoomLevel]);

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
                <GitPanel
                  hidden={activePanel !== 'gitPanel'}
                  reveal={() => setActivePanel('gitPanel')}
                />
              </div>
            </div>
          </Panel>
          <PanelResizeHandle className="panelResizeHandle" />
          <Panel defaultSize={80} minSize={50}>
            <div className="main-content">
              <TabIndex />
              <ContentPanel />
            </div>
          </Panel>
        </PanelGroup>
      </div>
      <StatusBar onBranchClick={() => setActivePanel('gitPanel')} />
      {/* The IDE's only toast host. Until now the one container lived in Login, so every toast()
          raised from inside the IDE — a failed commit, a failed save — rendered nowhere at all. */}
      <ToastContainer position="bottom-right" autoClose={4000} newestOnTop />
    </div>
  );
}

export default IDE;
