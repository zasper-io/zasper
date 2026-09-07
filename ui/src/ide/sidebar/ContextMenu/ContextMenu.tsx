import React, { useLayoutEffect, useRef, useState } from 'react';
import { Icon, IconName } from '@/ide/icons';
import { useDismissOnEscape, useDismissOnPressOutside } from '@/ide/overlays';
import './ContextMenu.scss';

interface MenuItem {
  label: string;
  action: (path: string) => void;
  icon?: IconName;
  /**
   * Nothing can be done with this right now — e.g. Paste with nothing on the clipboard. Listed rather
   * than omitted, the same rule the row itself follows: a missing row only raises the question a
   * greyed-out one answers.
   */
  disabled?: boolean;
  /**
   * This item throws something away. It is drawn in red and separated from the rest, and the menu
   * derives the separator from it rather than taking one as an item: a menu that needs two separators
   * is a menu that should be shorter, and this way it cannot have two.
   */
  danger?: boolean;
}

interface ContextMenuProps {
  /** Where the pointer was, in client coordinates: the menu is `position: fixed`. */
  xPos: number;
  yPos: number;
  items: MenuItem[];
  onClose: () => void;
  path: string;
}

const ContextMenu: React.FC<ContextMenuProps> = ({ xPos, yPos, items, onClose, path }) => {
  const menu = useRef<HTMLDivElement>(null);
  const [position, setPosition] = useState({ top: yPos, left: xPos });

  // Clamped once the menu has been measured: opened near the bottom of the tree it would otherwise
  // run past the window edge, and nothing can be scrolled to reach it.
  useLayoutEffect(() => {
    if (menu.current === null) {
      return;
    }
    const { width, height } = menu.current.getBoundingClientRect();
    const margin = 4;
    setPosition({
      top: Math.max(margin, Math.min(yPos, window.innerHeight - height - margin)),
      left: Math.max(margin, Math.min(xPos, window.innerWidth - width - margin)),
    });
  }, [xPos, yPos]);

  // A menu is not a question, so both halves of the family's dismissal rule apply to it.
  useDismissOnEscape(onClose);
  useDismissOnPressOutside(menu, onClose);

  const handleClick = (action: MenuItem['action']) => {
    action(path);
    onClose();
  };

  // Where the red rows start, which is where the one separator goes.
  const firstDanger = items.findIndex((item) => item.danger === true);

  const rowClassName = (item: MenuItem) => {
    const classes = ['panel-row'];
    if (item.danger === true) {
      classes.push('is-danger');
    }
    if (item.disabled === true) {
      classes.push('is-disabled');
    }
    return classes.join(' ');
  };

  return (
    <div className="z-overlay z-menu context-menu" ref={menu} style={position}>
      <ul className="z-overlay-list" role="menu">
        {items.map((item, index) => (
          <React.Fragment key={index}>
            {index === firstDanger && index > 0 && (
              <li className="z-overlay-separator" role="separator" />
            )}
            <li className={rowClassName(item)} role="none">
              <button
                type="button"
                role="menuitem"
                className="panel-row-name"
                disabled={item.disabled === true}
                onClick={() => handleClick(item.action)}
              >
                {item.icon !== undefined && <Icon name={item.icon} />}
                <span className="panel-row-label">{item.label}</span>
              </button>
            </li>
          </React.Fragment>
        ))}
      </ul>
    </div>
  );
};

export default ContextMenu;
