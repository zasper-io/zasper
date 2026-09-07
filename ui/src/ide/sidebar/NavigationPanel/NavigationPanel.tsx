import React, { useState } from 'react';
import HelpDialog from '../HelpDialog/HelpDialog';

import './NavigationPanel.scss';
import type { IconName } from '@/ide/icons';
import { Icon } from '@/ide/icons';
import { PanelName } from '../types';

interface NavigationPanelProps {
  activePanel: PanelName;
  setActivePanel: (panelName: PanelName) => void;
}

// 20px rather than the 16px an icon takes elsewhere: the rail is the one place an icon is the
// whole control rather than a marker beside a word.
const RAIL_ICON_SIZE = 20;

const NAV_ITEMS: { name: PanelName; label: string; icon: IconName }[] = [
  { name: 'fileBrowser', label: 'File explorer', icon: 'files' },
  { name: 'gitPanel', label: 'Source control', icon: 'git-branch' },
  { name: 'jupyterInfoPanel', label: 'Jupyter info', icon: 'cpu' },
  { name: 'settingsPanel', label: 'Settings', icon: 'settings' },
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
          <Icon name={item.icon} size={RAIL_ICON_SIZE} />
        </button>
      ))}

      {/* Help icon button. `.navButton-last` is what pushes it to the bottom of the rail — it was
          Bootstrap's `.mt-auto`, the only utility class left in the app and the reason a whole
          utility-generation pass ran over the stylesheet for one declaration. */}
      <button
        className="navButton navButton-last"
        onClick={toggleHelpDialog}
        title="Help"
        aria-label="Help"
      >
        <Icon name="circle-help" size={RAIL_ICON_SIZE} />
      </button>

      {showHelpDialog && <HelpDialog toggleHelpDialog={toggleHelpDialog} />}
    </div>
  );
};

export default NavigationPanel;
