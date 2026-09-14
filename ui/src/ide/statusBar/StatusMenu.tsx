import React, { ReactNode, useRef, useState } from 'react';

import { Icon } from '@/ide/icons';
import { useDismissOnEscape, useDismissOnPressOutside } from '@/ide/overlays';

interface StatusPickerProps {
  /** What the bar shows, which is the current value. */
  label: string;
  /** Read aloud: the value with what it is a value of. */
  spokenLabel: string;
  children: (close: () => void) => ReactNode;
}

/** A status bar item that is the control for what it shows: pressed, it opens a menu upwards. */
export function StatusPicker({ label, spokenLabel, children }: StatusPickerProps) {
  const [open, setOpen] = useState(false);
  const picker = useRef<HTMLDivElement>(null);

  const close = () => setOpen(false);
  useDismissOnEscape(close, open);
  useDismissOnPressOutside(picker, close, open);

  return (
    <div className="statusItem statusPicker" ref={picker}>
      <button
        type="button"
        className="statusButton z-tabular"
        aria-label={spokenLabel}
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen(!open)}
      >
        {label}
      </button>
      {open && (
        <div className="z-overlay z-menu statusMenu">
          <ul className="z-overlay-list" role="menu">
            {children(close)}
          </ul>
        </div>
      )}
    </div>
  );
}

export function MenuGroup({ label }: { label: string }) {
  return (
    <li className="z-overlay-group z-label" role="presentation">
      {label}
    </li>
  );
}

export function MenuSeparator() {
  return <li className="z-overlay-separator" role="separator" />;
}

interface MenuChoiceProps {
  label: string;
  checked: boolean;
  onSelect: () => void;
}

export function MenuChoice({ label, checked, onSelect }: MenuChoiceProps) {
  return (
    <li className={checked ? 'panel-row is-selected' : 'panel-row'} role="none">
      <button
        type="button"
        className="panel-row-name"
        role="menuitemradio"
        aria-checked={checked}
        onClick={onSelect}
      >
        {/* The tick's place is held whether or not there is one, so the names line up. */}
        <span className="menuTick">{checked && <Icon name="check" size={12} />}</span>
        <span className="panel-row-label">{label}</span>
      </button>
    </li>
  );
}

interface MenuActionProps {
  label: string;
  disabled?: boolean;
  onSelect: () => void;
}

export function MenuAction({ label, disabled, onSelect }: MenuActionProps) {
  return (
    <li className="panel-row" role="none">
      <button
        type="button"
        className="panel-row-name"
        role="menuitem"
        disabled={disabled}
        onClick={onSelect}
      >
        <span className="menuTick" />
        <span className="panel-row-label">{label}</span>
      </button>
    </li>
  );
}
