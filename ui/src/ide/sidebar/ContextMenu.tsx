import React from 'react';
import './ContextMenu.scss';

interface MenuItem {
  label: string;
  action: (path: string) => void;
}

interface ContextMenuProps {
  xPos: number;
  yPos: number;
  items: MenuItem[];
  onClose: () => void;
  path: string;
}

const ContextMenu: React.FC<ContextMenuProps> = ({ xPos, yPos, items, onClose, path }) => {
  const handleClick = (action: (path) => void) => {
    action(path);
    onClose();
  };

  return (
    <div className="context-menu" style={{ top: yPos, left: xPos }} onMouseLeave={onClose}>
      {items.map((item, index) => (
        <div key={index} className="context-menu-item" onClick={() => handleClick(item.action)}>
          {item.label}
        </div>
      ))}
    </div>
  );
};

export default ContextMenu;
