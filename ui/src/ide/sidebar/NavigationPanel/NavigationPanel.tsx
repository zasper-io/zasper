import React, { useState } from 'react';
import ContextMenu from '../ContextMenu';
import HelpDialog from '../HelpDialog/HelpDialog';

import './NavigationPanel.scss';

interface NavigationPanelProps {
  handleNavigationPanel: (panelName: string) => void;
}

const NavigationPanel: React.FC<NavigationPanelProps> = ({ handleNavigationPanel }) => {
  const [menuPosition, setMenuPosition] = useState<{ xPos: number; yPos: number } | null>(null);
  const [isMenuVisible, setIsMenuVisible] = useState<boolean>(false);
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const [contextPath, setContextPath] = useState<string>('');

  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const [directory, setDirectory] = useState<string>('');
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const [output, setOutput] = useState<string>('');

  // State to track the active navigation item
  const [activeNavItem, setActiveNavItem] = useState<string>('fileBrowser'); // Default active item
  const [showHelpDialog, setShowHelpDialog] = useState<boolean>(false);

  // Open directory selection dialog
  const handleSelectDirectory = async () => {
    const result = await window.api.openDirectory();
    if (result.length > 0) {
      const selectedDirectory = result[0];
      setDirectory(selectedDirectory);
      await window.api.runCommand(selectedDirectory);
      setOutput(`Selected Directory: ${selectedDirectory}`);
    }
  };

  const menuItems = [{ label: 'Open Project', action: handleSelectDirectory }];

  // Handle the right-click event to show context menu
  const handleContextMenu = (e: React.MouseEvent) => {
    e.preventDefault();
    setMenuPosition({ xPos: e.pageX, yPos: e.pageY });
    setIsMenuVisible(true);
  };

  // Close the context menu
  const handleCloseMenu = () => {
    setIsMenuVisible(false);
  };

  // Handle navigation item click (set active class)
  const handleNavItemClick = (panelName: string) => {
    setActiveNavItem(panelName); // Update the active item
    handleNavigationPanel(panelName); // Call the parent handler
  };

  // Render navigation buttons
  const renderNavButtons = () => {
    const navItems = [
      { name: 'fileBrowser', icon: './images/editor/feather-file-text.svg' },
      { name: 'gitPanel', icon: './images/editor/metro-flow-branch.svg' },
      { name: 'jupyterInfoPanel', icon: './images/editor/feather-box.svg' },
      { name: 'debugPanel', icon: './images/editor/feather-play-circle.svg' },
      { name: 'secretsPanel', icon: './images/editor/feather-lock.svg' },
      { name: 'settingsPanel', icon: './images/editor/feather-settings.svg' },
      { name: 'databasePanel', icon: './images/editor/feather-database.svg' },
    ];

    return navItems.map((item) => (
      <button
        key={item.name}
        className={`navButton ${activeNavItem === item.name ? 'active' : ''}`}
        onClick={() => handleNavItemClick(item.name)} // Set active item and navigate
      >
        <img src={item.icon} alt={item.name} />
      </button>
    ));
  };

  const toggleHelpDialog = () => {
    setShowHelpDialog(!showHelpDialog);
  };

  return (
    <div className="navigation-list">
      {/* Menu button */}
      <button className="navButton" onClick={handleContextMenu}>
        <img src="./images/editor/menu-bar.svg" alt="menu" />
      </button>

      {/* Render navigation buttons */}
      {renderNavButtons()}

      {/* Checkmark button */}
      <button className="navButton">
        <img src="./images/editor/ionic-ios-checkmark-circle-outline.svg" alt="checkmark" />
      </button>

      {/* Help icon button */}
      <button className="navButton mt-auto help-icon" onClick={toggleHelpDialog}>
        <i className="fas fa-question-circle" />
      </button>

      {showHelpDialog && <HelpDialog toggleHelpDialog={toggleHelpDialog} />}

      {/* Context menu */}
      {isMenuVisible && menuPosition && (
        <ContextMenu
          xPos={menuPosition.xPos}
          yPos={menuPosition.yPos}
          items={menuItems}
          path={contextPath}
          onClose={handleCloseMenu}
        />
      )}
    </div>
  );
};

export default NavigationPanel;
