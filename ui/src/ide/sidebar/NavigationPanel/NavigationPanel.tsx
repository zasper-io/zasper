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

interface NavigationPanelProps {
  handleNavigationPanel: (panelName: string) => void;
}

const NavigationPanel: React.FC<NavigationPanelProps> = ({ handleNavigationPanel }) => {
  // State to track the active navigation item
  const [activeNavItem, setActiveNavItem] = useState<string>('fileBrowser'); // Default active item
  const [showHelpDialog, setShowHelpDialog] = useState<boolean>(false);

  // Handle navigation item click (set active class)
  const handleNavItemClick = (panelName: string) => {
    setActiveNavItem(panelName); // Update the active item
    handleNavigationPanel(panelName); // Call the parent handler
  };

  // Render navigation buttons
  const renderNavButtons = () => {
    const navItems = [
      { name: 'fileBrowser', icon: <FileBrowserIcon /> },
      { name: 'gitPanel', icon: <GitPanelIcon /> },
      { name: 'jupyterInfoPanel', icon: <JupyterInfoPanelIcon /> },
      // { name: 'debugPanel', icon: './images/editor/feather-play-circle.svg' },
      // { name: 'secretsPanel', icon: './images/editor/feather-lock.svg' },
      { name: 'settingsPanel', icon: <SettingsPanelIcon /> },
      // { name: 'databasePanel', icon: './images/editor/feather-database.svg' },
      // { name: 'databasePanel', icon: <CheckmarkIcon /> },
    ];

    return navItems.map((item) => (
      <button
        key={item.name}
        className={`navButton ${activeNavItem === item.name ? 'active' : ''}`}
        onClick={() => handleNavItemClick(item.name)} // Set active item and navigate
      >
        {item.icon}
      </button>
    ));
  };

  const toggleHelpDialog = () => {
    setShowHelpDialog(!showHelpDialog);
  };

  return (
    <div className="navigation-list">
      {/* Render navigation buttons */}
      {renderNavButtons()}

      {/* Help icon button */}
      <button className="navButton mt-auto help-icon" onClick={toggleHelpDialog}>
        <HelpIcon />
      </button>

      {showHelpDialog && <HelpDialog toggleHelpDialog={toggleHelpDialog} />}
    </div>
  );
};

export default NavigationPanel;
