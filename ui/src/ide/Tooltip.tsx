import { useLayoutEffect, useRef, useState } from 'react';

import { TooltipState } from '@/ide/overlays';
import { currentZoomFactor } from '@/zoom';

interface TooltipProps {
  /** What `useTooltip` decided: whether there is one, and the box it belongs under. */
  tip: TooltipState;
  /**
   * One line, or the several a row's worth of facts needs. Nothing to say is a real answer — the
   * commit button has a reason only while it is disabled — and draws no box.
   */
  label: string | string[] | undefined;
}

/** Between the anchor's edge and the box, and between the box and the window's. */
const GAP = 4;

/**
 * The drawn half of a tooltip. `useTooltip` says when; this says where — under whatever it labels, and
 * over it where there is no room below.
 *
 * Placed the way the context menu is, for the same two reasons: `position: fixed` off a measured box,
 * clamped to the window once the box's own size is known, and the answer divided by the zoom factor
 * because the coordinates are the window's while the layout this renders into is scaled. A tooltip that
 * runs off the bottom of the screen is worse than none, since nothing can be scrolled to reach it.
 */
export default function Tooltip({ tip, label }: TooltipProps) {
  const box = useRef<HTMLDivElement>(null);
  const { anchor } = tip;
  const [at, setAt] = useState({ top: 0, left: 0 });

  useLayoutEffect(() => {
    if (anchor === null || box.current === null) {
      return;
    }
    const { width, height } = box.current.getBoundingClientRect();
    const factor = currentZoomFactor();
    const below = anchor.bottom + GAP;
    const top = below + height + GAP > window.innerHeight ? anchor.top - height - GAP : below;
    setAt({
      top: Math.max(GAP, top) / factor,
      left: Math.max(GAP, Math.min(anchor.left, window.innerWidth - width - GAP)) / factor,
    });
  }, [anchor]);

  const lines = typeof label === 'string' ? [label] : (label ?? []);

  if (anchor === null || lines.length === 0) {
    return null;
  }

  return (
    <div ref={box} id={tip.id} role="tooltip" className="z-overlay z-tooltip" style={at}>
      {lines.map((line) => (
        <span className="z-tooltip-line" key={line}>
          {line}
        </span>
      ))}
    </div>
  );
}
