import React, { useEffect, useState, useCallback, useMemo, useRef } from 'react';
import { useAtom } from 'jotai';
import {
  ImperativePanelHandle,
  Panel,
  PanelGroup,
  PanelResizeHandle,
} from 'react-resizable-panels';
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
} from '../store/AppState';
import { ApiError, getInfo } from '../api';
import { useKernelspecActions } from '../store/KernelspecActions';
import { applyTheme, getTheme, rememberTheme } from '../themes';
import { useApplyZoom } from '../zoom/useApplyZoom';
import { PanelName } from './sidebar/types';
import { useAppCommands } from '../commands/appCommands';
import { isMac, terminalHasFocus } from '../commands/keys';
import { useRegisterCommands } from '../commands/registry';
import { ICommand } from '../commands/types';
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

  // The library owns the panel's size, so it is asked to collapse and expand and this only mirrors
  // the answer for the topbar's toggle — which also catches a drag past the minimum collapsing it.
  const sidebarRef = useRef<ImperativePanelHandle>(null);
  const [sidebarOpen, setSidebarOpen] = useState(true);

  const toggleSidebar = useCallback(() => {
    const sidebar = sidebarRef.current;
    if (sidebar === null) return;
    if (sidebar.isCollapsed()) {
      sidebar.expand();
    } else {
      sidebar.collapse();
    }
  }, []);

  // Everything that names a panel also brings the sidebar back: a rail click, the branch in the
  // status bar, the git panel revealing itself. Otherwise each would change a panel nobody can see.
  const showPanel = useCallback((name: PanelName) => {
    setActivePanel(name);
    sidebarRef.current?.expand();
  }, []);

  const sidebarCommands = useMemo<ICommand[]>(
    () => [
      {
        id: 'view:toggle-sidebar',
        label: 'Toggle Sidebar',
        category: 'View',
        scope: 'app',
        keys: ['Mod-b'],
        // Off mac this is Ctrl-B, which a shell reads as back-a-character.
        isEnabled: () => isMac || !terminalHasFocus(),
        execute: toggleSidebar,
      },
    ],
    [toggleSidebar]
  );

  // The application's only keyboard dispatcher, and the window-level commands that used to be a
  // `keydown` listener here. Everything else contributes to the same registry from its own tab.
  useCommandKeymap();
  useRegisterCommands(useAppCommands());
  useRegisterCommands(sidebarCommands);
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

  useApplyZoom();

  return (
    <div className="editor">
      <Topbar sidebarOpen={sidebarOpen} onToggleSidebar={toggleSidebar} />
      <div className="editor-container">
        {/* Outside the resizable group, so hiding the sidebar leaves the rail — and the way back —
            on screen. The activity bar reads the same state it writes, so its highlight and the
            visible panel cannot disagree. */}
        <NavigationPanel activePanel={activePanel} setActivePanel={showPanel} />
        <PanelGroup direction="horizontal" className="workbench-panels">
          <Panel
            ref={sidebarRef}
            defaultSize={20}
            minSize={20}
            collapsible
            collapsedSize={0}
            onCollapse={() => setSidebarOpen(false)}
            onExpand={() => setSidebarOpen(true)}
          >
            <div className="navigation">
              <div className="sideBar">
                <FileBrowser hidden={activePanel !== 'fileBrowser'} reloadCount={reloadCount} />
                <SettingsPanel hidden={activePanel !== 'settingsPanel'} />
                <JupyterInfoPanel hidden={activePanel !== 'jupyterInfoPanel'} />
                <GitPanel
                  hidden={activePanel !== 'gitPanel'}
                  reveal={() => showPanel('gitPanel')}
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
      <StatusBar onBranchClick={() => showPanel('gitPanel')} />
      {/* The IDE's only toast host. Until now the one container lived in Login, so every toast()
          raised from inside the IDE — a failed commit, a failed save — rendered nowhere at all. */}
      <ToastContainer position="bottom-right" autoClose={4000} newestOnTop />
    </div>
  );
}

export default IDE;
