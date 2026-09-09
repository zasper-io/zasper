import React, { useLayoutEffect, useRef, useState } from 'react';
import { Icon, IconName } from '@/ide/icons';
import { useDismissOnEscape, useDismissOnPressOutside } from '@/ide/overlays';
import { currentZoomFactor } from '@/zoom';
import './ContextMenu.scss';

interface MenuItem {
  label: string;
  /**
   * `path` is the file tree's, and is what this menu was written for. A caller with nothing to
   * address — a cell's menu names commands, not paths — passes a function that takes no argument,
   * which is assignable here and is why `path` on the menu itself is optional.
   */
  action: (path: string) => void;
  icon?: IconName;
  /**
   * The chord that does the same thing, drawn at the row's right edge. Only some rows have one and
   * that is the point: the palette taught this app that a menu which shows its shortcuts is how the
   * shortcuts get learnt, and the cell toolbar it replaced showed none of the five it had.
   */
  keys?: string;
  /**
   * The heading this row belongs under. Rows carrying the same group in a run are drawn beneath one
   * `.z-overlay-group` heading. This is the family's answer to a menu with several kinds of thing in
   * it, and the reason there is still only ever one separator: see `danger` below.
   */
  group?: string;
  /**
   * One of a set of alternatives, and the one that currently holds — a cell's type. Drawn with the
   * row fill `.is-selected`, which is what the surface already uses for "this is the one".
   */
  selected?: boolean;
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
  /** What the items act on, for the file tree. A menu of commands has none. */
  path?: string;
}

const ContextMenu: React.FC<ContextMenuProps> = ({ xPos, yPos, items, onClose, path = '' }) => {
  const menu = useRef<HTMLDivElement>(null);
  const [position, setPosition] = useState({ top: yPos, left: xPos });

  // Clamped once the menu has been measured: opened near the bottom of the tree it would otherwise
  // run past the window edge, and nothing can be scrolled to reach it.
  //
  // The clamping is all in window pixels, which is what the pointer, `innerWidth` and a measured
  // rect are all in. Only the answer is divided: the menu is laid out inside #root, which zoom
  // scales, so writing the pointer's own 165px there draws it at 165 × the factor.
  useLayoutEffect(() => {
    if (menu.current === null) {
      return;
    }
    const { width, height } = menu.current.getBoundingClientRect();
    const margin = 4;
    const factor = currentZoomFactor();
    setPosition({
      top: Math.max(margin, Math.min(yPos, window.innerHeight - height - margin)) / factor,
      left: Math.max(margin, Math.min(xPos, window.innerWidth - width - margin)) / factor,
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
    if (item.selected === true) {
      classes.push('is-selected');
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
            {/* A heading only where the group changes, so a run of rows sits under one. */}
            {item.group !== undefined && item.group !== items[index - 1]?.group && (
              <li className="z-overlay-group" role="presentation">
                <span className="z-label">{item.group}</span>
              </li>
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
                {item.keys !== undefined && <span className="panel-row-keys">{item.keys}</span>}
              </button>
            </li>
          </React.Fragment>
        ))}
      </ul>
    </div>
  );
};

export default ContextMenu;
