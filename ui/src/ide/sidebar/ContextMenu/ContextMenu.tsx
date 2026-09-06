import React, { useLayoutEffect, useRef, useState } from 'react';
import { useDismissOnEscape, useDismissOnPressOutside } from '@/ide/overlays';
import './ContextMenu.scss';

interface MenuItem {
  label: string;
  action: (path: string) => void;
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

  return (
    <div className="z-overlay z-menu context-menu" role="menu" ref={menu} style={position}>
      <div className="z-overlay-list">
        {items.map((item, index) => (
          <React.Fragment key={index}>
            {index === firstDanger && index > 0 && (
              <div className="z-overlay-separator" role="separator" />
            )}
            <button
              type="button"
              role="menuitem"
              className={item.danger === true ? 'panel-row is-danger' : 'panel-row'}
              onClick={() => handleClick(item.action)}
            >
              {item.label}
            </button>
          </React.Fragment>
        ))}
      </div>
    </div>
  );
};

export default ContextMenu;
