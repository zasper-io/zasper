import { ICONS } from './icons';
import type { IconName } from './icons';

export interface IconProps {
  name: IconName;
  /** Square, in px. 16 in a row or a button, 12 for a chevron that points at something. */
  size?: number;
  className?: string;
}

/**
 * The only way an icon reaches the screen. See icons.ts for the table it draws from.
 *
 * Always `aria-hidden`: an icon here is never the label. The button around it carries the words —
 * as a `title`, an `aria-label`, or visible text — which is also what a tooltip needs.
 *
 * Colour arrives as `currentColor` rather than being named here, which is the whole gain over the
 * `<img>` icons this replaced: the same file reads on a white panel, on the purple banner and on a
 * selected row, where those needed `filter: brightness(500%)` to fake it.
 */
export default function Icon({ name, size = 16, className }: IconProps) {
  const Glyph = ICONS[name];
  const classNames = ['z-icon'];
  if (className !== undefined) {
    classNames.push(className);
  }

  return (
    <Glyph
      className={classNames.join(' ')}
      size={size}
      // 1.5 rather than Lucide's own 2: at 16px in a 22px row a 2px stroke reads as bold, which is
      // what the Font Awesome solids looked like and the reason the toolbar drew the eye first.
      strokeWidth={1.5}
      aria-hidden="true"
      focusable={false}
    />
  );
}
