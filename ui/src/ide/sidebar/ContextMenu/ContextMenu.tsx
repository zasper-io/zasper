import React, { useEffect, useLayoutEffect, useRef, useState } from 'react';
import './ContextMenu.scss';

interface MenuItem {
  label: string;
  action: (path: string) => void;
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

  useEffect(() => {
    const dismiss = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        onClose();
      }
    };
    // A press anywhere else closes it. This is also what closes it when another row is right-clicked:
    // mousedown arrives before contextmenu, so the old menu is gone before the new one opens.
    const dismissOnPressOutside = (event: MouseEvent) => {
      if (menu.current !== null && !menu.current.contains(event.target as Node)) {
        onClose();
      }
    };

    window.addEventListener('keydown', dismiss);
    window.addEventListener('mousedown', dismissOnPressOutside);
    return () => {
      window.removeEventListener('keydown', dismiss);
      window.removeEventListener('mousedown', dismissOnPressOutside);
    };
  }, [onClose]);

  const handleClick = (action: MenuItem['action']) => {
    action(path);
    onClose();
  };

  return (
    <div className="context-menu" role="menu" ref={menu} style={position}>
      {items.map((item, index) => (
        <div key={index} className="context-menu-item" onClick={() => handleClick(item.action)}>
          {item.label}
        </div>
      ))}
    </div>
  );
};

export default ContextMenu;
