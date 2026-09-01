import React, { useState } from 'react';
import HelpDialog from '../HelpDialog/HelpDialog';

import './NavigationPanel.scss';
import {
  FileBrowserIcon,
  GitPanelIcon,
  HelpIcon,
  JupyterInfoPanelIcon,
  SettingsPanelIcon,
} from '@/ide/icons';
import { PanelName } from '../types';

interface NavigationPanelProps {
  activePanel: PanelName;
  setActivePanel: (panelName: PanelName) => void;
}

const NAV_ITEMS: { name: PanelName; label: string; icon: React.ReactNode }[] = [
  { name: 'fileBrowser', label: 'File explorer', icon: <FileBrowserIcon /> },
  { name: 'gitPanel', label: 'Source control', icon: <GitPanelIcon /> },
  { name: 'jupyterInfoPanel', label: 'Jupyter info', icon: <JupyterInfoPanelIcon /> },
  { name: 'settingsPanel', label: 'Settings', icon: <SettingsPanelIcon /> },
];

// Which button is highlighted comes from the parent, which also decides which panel is
// visible — one piece of state, so the two cannot disagree.
const NavigationPanel: React.FC<NavigationPanelProps> = ({ activePanel, setActivePanel }) => {
  const [showHelpDialog, setShowHelpDialog] = useState<boolean>(false);

  const toggleHelpDialog = () => {
    setShowHelpDialog(!showHelpDialog);
  };

  return (
    <div className="navigation-list">
      {NAV_ITEMS.map((item) => (
        <button
          key={item.name}
          className={`navButton ${activePanel === item.name ? 'active' : ''}`}
          onClick={() => setActivePanel(item.name)}
          title={item.label}
          aria-label={item.label}
        >
          {item.icon}
        </button>
      ))}

      {/* Help icon button */}
      <button
        className="navButton mt-auto help-icon"
        onClick={toggleHelpDialog}
        title="Help"
        aria-label="Help"
      >
        <HelpIcon />
      </button>

      {showHelpDialog && <HelpDialog toggleHelpDialog={toggleHelpDialog} />}
    </div>
  );
};

export default NavigationPanel;
