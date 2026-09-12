import { useRef, useState } from 'react';
import { useAtom } from 'jotai';

import { Icon } from '@/ide/icons';
import { useDismissOnEscape, useDismissOnPressOutside, useTooltip } from '@/ide/overlays';
import Tooltip from '@/ide/Tooltip';
import { zoomLevelAtom } from '@/store/AppState';
import { MAX_ZOOM_LEVEL, MIN_ZOOM_LEVEL, zoomLevelLabel } from '@/zoom';

// Largest first, so the list runs the way a scale does with the bigger end up, and so 0 lands in
// the middle of it rather than at either end.
const LEVELS: number[] = [];
for (let level = MAX_ZOOM_LEVEL; level >= MIN_ZOOM_LEVEL; level--) {
  LEVELS.push(level);
}

/**
 * The window's zoom, in the status bar: what it is now, and every level it can be set to.
 *
 * The keyboard already has Cmd +/-/0 (commands/appCommands.ts). This is the same setting for
 * someone who does not know that, and the one place the current level is written down — a zoom is
 * otherwise only visible in the size of everything, which is exactly what you lose track of.
 */
export default function ZoomStatus() {
  const [zoomLevel, setZoomLevel] = useAtom(zoomLevelAtom);
  const [open, setOpen] = useState<boolean>(false);
  const picker = useRef<HTMLDivElement>(null);

  // Spelled out, because on screen the magnifier beside it says what the number counts and read
  // aloud a bare "+2" does not.
  const spokenLabel = `Zoom level ${zoomLevelLabel(zoomLevel)}`;

  const tip = useTooltip();

  const close = () => setOpen(false);
  useDismissOnEscape(close, open);
  useDismissOnPressOutside(picker, close, open);

  return (
    <div className="statusItem zoomPicker" ref={picker}>
      <button
        type="button"
        className="statusButton zoomButton"
        aria-label={spokenLabel}
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen(!open)}
        {...tip.anchorProps}
      >
        <Icon name="zoom-in" size={12} />
        {/* Tabular, so the bar's last item does not change width as the level does. */}
        <span className="z-tabular">{zoomLevelLabel(zoomLevel)}</span>
      </button>
      <Tooltip tip={tip} label="Zoom" />

      {open && (
        <div className="z-overlay z-menu zoomMenu">
          <ul className="z-overlay-list" role="menu">
            {LEVELS.map((level) => (
              <li key={level} className="panel-row" role="none">
                <button
                  type="button"
                  className="panel-row-name"
                  role="menuitemradio"
                  aria-checked={level === zoomLevel}
                  onClick={() => {
                    setZoomLevel(level);
                    close();
                  }}
                >
                  {/* The tick's place is held whether or not there is one, so the numbers line up. */}
                  <span className="zoomTick">
                    {level === zoomLevel && <Icon name="check" size={12} />}
                  </span>
                  <span className="panel-row-label z-tabular">{zoomLevelLabel(level)}</span>
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
