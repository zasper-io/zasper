/**
 * The ids that tie a tab on the strip to its pane: the tab's `aria-controls` and the pane's
 * `aria-labelledby`. By the half as well as the path, since every half's panes are mounted at once, and
 * written out rather than `useId()` so that the strip and the panes, which are different components,
 * arrive at the same one.
 */
export function tabIds(group: string, path: string): { tab: string; panel: string } {
  const slug = `${group}-${path}`.replace(/\s/g, '-');
  return { tab: `tab-${slug}`, panel: `tabpanel-${slug}` };
}
