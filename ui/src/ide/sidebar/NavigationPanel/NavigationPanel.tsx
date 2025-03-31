import React, { useEffect, useState } from 'react';
import ContextMenu from '../ContextMenu';
import HelpDialog from '../HelpDialog/HelpDialog';

import './NavigationPanel.scss';
import { useAtom } from 'jotai';
import { themeAtom } from '../../../store/Settings';

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
      { name: 'fileBrowser', icon: <FileBrowserIcon /> },
      { name: 'gitPanel', icon: <GitPanelIcon /> },
      { name: 'jupyterInfoPanel', icon: <JupyterInfoPanelIcon /> },
      // { name: 'debugPanel', icon: './images/editor/feather-play-circle.svg' },
      // { name: 'secretsPanel', icon: './images/editor/feather-lock.svg' },
      { name: 'settingsPanel', icon: <SettingsPanelIcon /> },
      // { name: 'databasePanel', icon: './images/editor/feather-database.svg' },
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

const FileBrowserIcon = () => {
  const [theme] = useAtom(themeAtom);
  var fill = theme === 'dark' ? '#747474' : '#272727';

  useEffect(() => {}, [theme]);

  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      width="15.475"
      height="18.914"
      viewBox="0 0 15.475 18.914"
      style={{ fill }}
    >
      <g id="Icon_feather-file-text" data-name="Icon feather-file-text" transform="translate(0 0)">
        <path
          id="Path_1609"
          data-name="Path 1609"
          d="M7.079,1.5h6.878a.86.86,0,0,1,.608.252L19.723,6.91a.86.86,0,0,1,.252.608V17.834A2.582,2.582,0,0,1,17.4,20.414H7.079A2.582,2.582,0,0,1,4.5,17.834V4.079A2.582,2.582,0,0,1,7.079,1.5ZM13.6,3.219H7.079a.861.861,0,0,0-.86.86V17.834a.861.861,0,0,0,.86.86H17.4a.861.861,0,0,0,.86-.86V7.874Z"
          transform="translate(-4.5 -1.5)"
        />
        <path
          id="Path_1610"
          data-name="Path 1610"
          d="M25.518,8.378H20.36a.86.86,0,0,1-.86-.86V2.36a.86.86,0,0,1,1.719,0v4.3h4.3a.86.86,0,0,1,0,1.719Z"
          transform="translate(-10.903 -1.5)"
        />
        <path
          id="Path_1611"
          data-name="Path 1611"
          d="M18.237,19.719H11.36a.86.86,0,0,1,0-1.719h6.878a.86.86,0,0,1,0,1.719Z"
          transform="translate(-7.061 -8.543)"
        />
        <path
          id="Path_1612"
          data-name="Path 1612"
          d="M18.237,25.719H11.36a.86.86,0,0,1,0-1.719h6.878a.86.86,0,0,1,0,1.719Z"
          transform="translate(-7.061 -11.104)"
        />
        <path
          id="Path_1613"
          data-name="Path 1613"
          d="M13.079,13.719H11.36a.86.86,0,0,1,0-1.719h1.719a.86.86,0,0,1,0,1.719Z"
          transform="translate(-7.061 -5.982)"
        />
      </g>
    </svg>
  );
};

const GitPanelIcon = () => {
  const [theme] = useAtom(themeAtom);
  var fill = theme === 'dark' ? '#747474' : '#272727';

  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      width="14.379"
      height="18.872"
      viewBox="0 0 14.379 18.872"
      style={{ fill }}
    >
      <path
        id="Icon_metro-flow-branch"
        data-name="Icon metro-flow-branch"
        d="M22.5,6.706a2.7,2.7,0,1,0-3.837,2.434c-.092,1.779-1.427,2.384-3.746,3.253a14.663,14.663,0,0,0-2.976,1.386V9.151a2.7,2.7,0,1,0-2.247,0v8.593a2.7,2.7,0,1,0,2.265.009c.092-1.778,1.428-2.384,3.746-3.253,2.28-.856,5.1-1.922,5.212-5.343A2.694,2.694,0,0,0,22.5,6.706ZM10.819,5.151A1.556,1.556,0,1,1,9.265,6.706,1.555,1.555,0,0,1,10.819,5.151Zm0,16.592a1.556,1.556,0,1,1,1.555-1.556,1.556,1.556,0,0,1-1.555,1.556Zm8.987-13.48a1.556,1.556,0,1,1,1.555-1.556,1.556,1.556,0,0,1-1.555,1.556Z"
        transform="translate(-8.123 -4.01)"
      />
    </svg>
  );
};

const JupyterInfoPanelIcon = () => {
  const [theme] = useAtom(themeAtom);
  var fill = theme === 'dark' ? '#747474' : '#272727';

  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      width="17.224"
      height="19.014"
      viewBox="0 0 17.224 19.014"
      style={{ fill }}
    >
      <g id="Icon_feather-box" data-name="Icon feather-box" transform="translate(0 0)">
        <path
          id="Path_1609"
          data-name="Path 1609"
          d="M11.612,20.447a2.587,2.587,0,0,1-1.291-.345L4.3,16.657l0,0A2.591,2.591,0,0,1,3,14.421V7.53A2.592,2.592,0,0,1,4.292,5.294l0,0,6.026-3.444a2.584,2.584,0,0,1,2.581,0l6.026,3.444,0,0a2.591,2.591,0,0,1,1.292,2.235V14.42a2.592,2.592,0,0,1-1.292,2.236l0,0L12.9,20.1A2.587,2.587,0,0,1,11.612,20.447Zm-6.46-5.283,6.026,3.444,0,0a.861.861,0,0,0,.861,0l0,0,6.026-3.444a.864.864,0,0,0,.43-.744V7.53a.863.863,0,0,0-.43-.744L12.046,3.343l0,0a.861.861,0,0,0-.861,0l0,0L5.152,6.786a.864.864,0,0,0-.43.744V14.42A.863.863,0,0,0,5.152,15.163Z"
          transform="translate(-3 -1.503)"
        />
        <path
          id="Path_1610"
          data-name="Path 1610"
          d="M11.785,15.012a.861.861,0,0,1-.431-.116L3.835,10.547A.861.861,0,0,1,4.7,9.056l7.087,4.1,7.087-4.1a.861.861,0,0,1,.862,1.491L12.216,14.9A.861.861,0,0,1,11.785,15.012Z"
          transform="translate(-3.172 -4.67)"
        />
        <path
          id="Path_1611"
          data-name="Path 1611"
          d="M17.361,26.9a.861.861,0,0,1-.861-.861V17.361a.861.861,0,1,1,1.722,0v8.681A.861.861,0,0,1,17.361,26.9Z"
          transform="translate(-8.749 -7.889)"
        />
      </g>
    </svg>
  );
};

const SettingsPanelIcon = () => {
  const [theme] = useAtom(themeAtom);
  var fill = theme === 'dark' ? '#747474' : '#272727';

  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      width="18.933"
      height="18.933"
      viewBox="0 0 18.933 18.933"
      style={{ fill }}
    >
      <g id="Icon_feather-settings" data-name="Icon feather-settings" transform="translate(0 0)">
        <path
          id="Path_1609"
          data-name="Path 1609"
          d="M15.155,12A3.155,3.155,0,1,1,12,15.155,3.159,3.159,0,0,1,15.155,12Zm0,4.733a1.578,1.578,0,1,0-1.578-1.578A1.58,1.58,0,0,0,15.155,16.733Z"
          transform="translate(-5.689 -5.689)"
        />
        <path
          id="Path_1610"
          data-name="Path 1610"
          d="M9.529,18.933a2.369,2.369,0,0,1-2.367-2.367v-.06a.51.51,0,0,0-.335-.462l-.046-.019a.513.513,0,0,0-.563.1l-.044.044a2.367,2.367,0,1,1-3.348-3.348l.043-.043a.51.51,0,0,0,.1-.563l0-.008A.512.512,0,0,0,2.5,11.9H2.367a2.367,2.367,0,0,1,0-4.733h.06a.51.51,0,0,0,.462-.335q.009-.023.019-.046a.51.51,0,0,0-.1-.563l-.044-.044A2.367,2.367,0,1,1,6.112,2.827l.043.043a.513.513,0,0,0,.563.1.789.789,0,0,1,.157-.05A.512.512,0,0,0,7.1,2.5V2.367a2.367,2.367,0,1,1,4.733,0v.069a.512.512,0,0,0,.311.468l.008,0a.513.513,0,0,0,.563-.1l.044-.044a2.367,2.367,0,1,1,3.348,3.348l-.043.043a.51.51,0,0,0-.1.563.789.789,0,0,1,.05.157.512.512,0,0,0,.421.225h.132a2.367,2.367,0,0,1,0,4.733H16.5a.512.512,0,0,0-.468.311l0,.008a.51.51,0,0,0,.1.563l.044.044a2.367,2.367,0,1,1-3.348,3.348l-.043-.043a.513.513,0,0,0-.563-.1l-.008,0a.512.512,0,0,0-.311.468v.132A2.369,2.369,0,0,1,9.529,18.933ZM7.4,14.572a2.079,2.079,0,0,1,1.345,1.9q0,.009,0,.018v.071a.789.789,0,1,0,1.578,0v-.134s0,0,0,0a2.1,2.1,0,0,1,3.565-1.492l.006.006.047.047a.79.79,0,1,0,1.117-1.117l-.048-.048L15,13.82a2.1,2.1,0,0,1,1.492-3.565h.074a.789.789,0,0,0,0-1.578h-.137a2.089,2.089,0,0,1-1.913-1.267.789.789,0,0,1-.057-.208,2.08,2.08,0,0,1,.479-2.153l.006-.006L14.991,5a.79.79,0,1,0-1.117-1.117l-.048.048-.006.006a2.1,2.1,0,0,1-3.565-1.492s0,0,0,0V2.367a.789.789,0,1,0-1.578,0V2.5s0,0,0,0A2.089,2.089,0,0,1,7.41,4.417a.789.789,0,0,1-.208.057A2.091,2.091,0,0,1,5.049,4l-.006-.006L5,3.942A.79.79,0,1,0,3.879,5.059l.048.048.006.006A2.08,2.08,0,0,1,4.36,7.4a2.079,2.079,0,0,1-1.9,1.345H2.367a.789.789,0,0,0,0,1.578H2.5A2.1,2.1,0,0,1,4,13.884l-.006.006-.047.047a.79.79,0,1,0,1.117,1.117l.048-.048L5.112,15A2.09,2.09,0,0,1,7.4,14.572Z"
          transform="translate(0 0)"
        />
      </g>
    </svg>
  );
};

export default NavigationPanel;
