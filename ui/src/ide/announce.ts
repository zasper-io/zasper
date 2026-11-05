/** The id of the IDE's one polite live region, rendered in IDE.tsx. */
export const ANNOUNCER_ID = 'z-announcer';

/**
 * Says `text` to a screen reader, politely, for something done that leaves nothing new to look at: a
 * save changes a dot in the tab and the window's title, and neither is read out. A repeat gains a
 * no-break space, since the same words twice are no change to a live region.
 */
export function announce(text: string): void {
  const region = document.getElementById(ANNOUNCER_ID);
  if (region !== null) {
    region.textContent = region.textContent === text ? `${text} ` : text;
  }
}
