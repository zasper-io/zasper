// src/ContextMenu.tsx
import React from 'react';
import './ContextMenu.scss'; // Optional: for styling

interface MenuItem {
  label: string;
  action: () => void;
}

interface ContextMenuProps {
  xPos: number;
  yPos: number;
  items: MenuItem[];
  onClose: () => void;
}

const ContextMenu: React.FC<ContextMenuProps> = ({ xPos, yPos, items, onClose }) => {
  const handleClick = (action: () => void) => {
    action();
    onClose();
  };

  return (
    <div
      className="context-menu"
      style={{ top: yPos, left: xPos }}
      onMouseLeave={onClose}
    >
      {items.map((item, index) => (
        <div
          key={index}
          className="context-menu-item"
          onClick={() => handleClick(item.action)}
        >
          {item.label}
        </div>
      ))}
    </div>
  );
};

export default ContextMenu;

