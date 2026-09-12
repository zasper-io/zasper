import React, { useState } from 'react';
import HelpDialog from '../HelpDialog/HelpDialog';

import './NavigationPanel.scss';
import type { IconName } from '@/ide/icons';
import { Icon } from '@/ide/icons';
import { useTooltip } from '@/ide/overlays';
import Tooltip from '@/ide/Tooltip';
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
        <RailButton
          key={item.name}
          icon={item.icon}
          label={item.label}
          isActive={activePanel === item.name}
          onClick={() => setActivePanel(item.name)}
        />
      ))}

      {/* Help icon button. `.navButton-last` is what pushes it to the bottom of the rail — it was
          Bootstrap's `.mt-auto`, the only utility class left in the app and the reason a whole
          utility-generation pass ran over the stylesheet for one declaration. */}
      <RailButton
        icon="circle-help"
        label="Help"
        className="navButton-last"
        onClick={toggleHelpDialog}
      />

      {showHelpDialog && <HelpDialog toggleHelpDialog={toggleHelpDialog} />}
    </div>
  );
};

export default NavigationPanel;

interface RailButtonProps {
  icon: IconName;
  label: string;
  isActive?: boolean;
  className?: string;
  onClick: () => void;
}

/**
 * One button on the rail. `.navButton` rather than `.z-icon-button` — the rail's is 32px and carries
 * the active marker — so it takes `useTooltip` directly instead of going through `IconButton`, and the
 * label is the only thing naming it: the rail is four glyphs and no words.
 */
function RailButton({ icon, label, isActive, className, onClick }: RailButtonProps) {
  const tip = useTooltip();
  const classes = ['navButton'];
  if (isActive === true) {
    classes.push('active');
  }
  if (className !== undefined) {
    classes.push(className);
  }

  return (
    <>
      <button
        type="button"
        className={classes.join(' ')}
        aria-label={label}
        onClick={onClick}
        {...tip.anchorProps}
      >
        <Icon name={icon} size={RAIL_ICON_SIZE} />
      </button>
      <Tooltip tip={tip} label={label} />
    </>
  );
}
