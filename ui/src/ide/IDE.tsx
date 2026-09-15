import React, { useEffect, useState, useCallback, useMemo, useRef } from 'react';
import { useAtom } from 'jotai';
import {
  ImperativePanelHandle,
  Panel,
  PanelGroup,
  PanelResizeHandle,
} from 'react-resizable-panels';
import { ToastContainer } from 'react-toastify';
import {
  DEFAULT_EDITOR_SETTINGS,
  editorSettingsAtom,
  themeAtom,
  widgetCdnAtom,
} from '../store/settings';

import NavigationPanel from './sidebar/navigationPanel/NavigationPanel';
import FileBrowser from './sidebar/fileBrowser/FileBrowser';
import ContentPanel from './editor/ContentPanel';
import TabIndex from './tabs/TabIndex';
import Topbar from './topBar/Topbar';
import GitPanel from './sidebar/gitPanel/GitPanel';
import JupyterInfoPanel from './sidebar/jupyterInfoPanel/JupyterInfoPanel';
import SearchPanel from './sidebar/searchPanel/SearchPanel';
import StatusBar from './statusBar/StatusBar';

import './IDE.scss';
import { fileBrowserReloadCountAtom } from '@/store/fileBrowser';
import { searchFocusRequestAtom } from '@/store/projectSearch';
import {
  platformAtom,
  projectDirAtom,
  projectNameAtom,
  serverOsAtom,
  userNameAtom,
  zasperVersionAtom,
} from '@/store/serverInfo';
import { ApiError, getInfo } from '../api';
import { useKernelspecActions } from '../store/kernelspecActions';
import { useRememberRecentFiles } from '../store/useRememberRecentFiles';
import { useRememberTabs } from '../store/useRememberTabs';
import { applyTheme, getTheme, rememberTheme } from '../themes';
import { useApplyZoom } from '../zoom/useApplyZoom';
import { PanelName } from './sidebar/types';
import { APP_COMMANDS, useAppCommands } from '../commands/appCommands';
import { useHelpCommands } from '../commands/helpCommands';
import { isMac, terminalHasFocus } from '../commands/keys';
import { useRegisterCommands } from '../commands/registry';
import { useTabActions } from '../store/tabActions';
import { Command } from '../commands/types';
import { useCommandKeymap } from '../commands/useCommandKeymap';
import { useTelemetry } from '../telemetry';
import { markSignedOut } from '../auth/signedIn';
import SessionEndedNotice from '../auth/SessionEndedNotice';
import { allowWidgetCdn } from './widgets/cdnLoader';

function IDE() {
  const [theme, setTheme] = useAtom(themeAtom);
  const [reloadCount] = useAtom(fileBrowserReloadCountAtom);
  const [, setProjectName] = useAtom(projectNameAtom);
  const [, setProjectDir] = useAtom(projectDirAtom);
  const [, setServerOs] = useAtom(serverOsAtom);
  const [, setUserName] = useAtom(userNameAtom);
  const [, setVersion] = useAtom(zasperVersionAtom);
  const [, setPlatform] = useAtom(platformAtom);
  const [widgetCdn, setWidgetCdn] = useAtom(widgetCdnAtom);
  const [, setEditorSettings] = useAtom(editorSettingsAtom);
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

  const { openSettings } = useTabActions();
  const [, setSearchFocus] = useAtom(searchFocusRequestAtom);

  const windowCommands = useMemo<Command[]>(
    () => [
      {
        ...APP_COMMANDS['view:toggle-sidebar'],
        // Off mac this is Ctrl-B, which a shell reads as back-a-character.
        isEnabled: () => isMac || !terminalHasFocus(),
        execute: toggleSidebar,
      },
      { ...APP_COMMANDS['view:settings'], execute: () => openSettings() },
      {
        ...APP_COMMANDS['view:search'],
        isEnabled: () => isMac || !terminalHasFocus(),
        execute: () => {
          showPanel('searchPanel');
          setSearchFocus((count) => count + 1);
        },
      },
    ],
    [toggleSidebar, openSettings, showPanel, setSearchFocus]
  );

  // The application's only keyboard dispatcher, and the window-level commands that used to be a
  // `keydown` listener here. Everything else contributes to the same registry from its own tab.
  useCommandKeymap();
  useRegisterCommands(useAppCommands());
  useRegisterCommands(windowCommands);
  useRegisterCommands(useHelpCommands());
  useTelemetry();

  const initConfig = useCallback(async () => {
    let info;
    try {
      info = await getInfo();
    } catch (error) {
      if (error instanceof ApiError && error.status === 401) {
        markSignedOut();
        window.location.href = '/login';
        return;
      }
      throw error;
    }

    setProjectName(info.project.toUpperCase());
    setProjectDir(info.directory);
    setUserName(info.username);
    setVersion(info.version);
    setPlatform(info.arch ? `${info.os} · ${info.arch}` : info.os);
    // Resolve through the registry so a config naming a theme we no longer ship
    // falls back instead of writing a data-theme with no stylesheet behind it.
    setTheme(getTheme(info.theme).id);
    setServerOs(info.os);
    // A server from before the setting existed sends nothing, which means on.
    setWidgetCdn(info.widget_cdn !== false);
    setEditorSettings(info.editor ?? DEFAULT_EDITOR_SETTINGS);
  }, [
    setProjectName,
    setProjectDir,
    setUserName,
    setVersion,
    setPlatform,
    setTheme,
    setServerOs,
    setWidgetCdn,
    setEditorSettings,
  ]);

  useEffect(() => {
    initConfig();
  }, [initConfig]);

  useEffect(() => {
    allowWidgetCdn(widgetCdn);
  }, [widgetCdn]);

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
  // Remembers the open tabs, and drops a strip remembered for another project. The strip itself was
  // already seeded when TabState loaded; this is what confirms and maintains it.
  useRememberTabs();
  // The files this project had open, for the palette's empty query and the Launcher's Recent list.
  useRememberRecentFiles();

  return (
    <div className="editor">
      <Topbar sidebarOpen={sidebarOpen} onToggleSidebar={toggleSidebar} />
      <SessionEndedNotice />
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
                <SearchPanel hidden={activePanel !== 'searchPanel'} />
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
              <TabIndex onShowFileBrowser={() => showPanel('fileBrowser')} />
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
