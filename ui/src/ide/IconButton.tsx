import { MouseEventHandler, ReactNode } from 'react';

import { Icon, IconName } from '@/ide/icons';
import { useTooltip } from '@/ide/overlays';
import Tooltip from '@/ide/Tooltip';

interface IconButtonProps {
  icon: IconName;
  /** What the button does, said once: the tooltip, and the accessible name unless `name` differs. */
  label: string;
  /**
   * The accessible name, where it cannot be the label. A toggle is the only case — the eye in the
   * file browser says "Hide hidden files" once they are shown, and a name that changes under a
   * screen reader's user is a different control arriving where one was.
   */
  name?: string;
  onClick?: MouseEventHandler<HTMLButtonElement>;
  disabled?: boolean;
  /** The one modifier this button takes, e.g. `on-chrome` or a caller's own placement class. */
  className?: string;
  /** A toggle that is on. */
  pressed?: boolean;
  /** Whether what this button opens is open — the sidebar, a menu. */
  expanded?: boolean;
  size?: number;
  /** A count or a dot drawn beside the glyph — the sync actions and the kernel's status light. */
  children?: ReactNode;
}

/**
 * An icon on its own with a label under it: every toolbar button, every row action, every close
 * cross. `.z-icon-button` is the box and `useTooltip` is the label, which is the whole reason this
 * is a component rather than a class — a tooltip is a hook, and a hook needs somewhere to live.
 *
 * It also settles what an icon button says it is. Before this the same button carried `title` and
 * `aria-label` at twenty call sites and only one of them at twenty more, so a third of the app's
 * buttons were announced as "button" and nothing else. One `label` is both.
 *
 * A disabled button keeps its tooltip: Chromium fires pointer events on one even though it suppresses
 * the click, so `.z-icon-button:disabled` — which is most of the git panel before a repository has
 * anything to say — can still explain itself. A keyboard cannot reach it, which is the browser's
 * rule about disabled controls rather than this component's.
 */
export default function IconButton({
  icon,
  label,
  name,
  onClick,
  disabled,
  className,
  pressed,
  expanded,
  size,
  children,
}: IconButtonProps) {
  const tip = useTooltip();
  const classNames = className === undefined ? 'z-icon-button' : `z-icon-button ${className}`;

  return (
    <>
      <button
        type="button"
        className={classNames}
        aria-label={name ?? label}
        aria-pressed={pressed}
        aria-expanded={expanded}
        disabled={disabled}
        onClick={onClick}
        {...tip.anchorProps}
      >
        <Icon name={icon} size={size} />
        {children}
      </button>
      <Tooltip tip={tip} label={label} />
    </>
  );
}
