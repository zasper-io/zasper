/** The sidebar panels, in the order NavigationPanel lists them. */
export type PanelName =
  | 'fileBrowser'
  | 'gitPanel'
  | 'jupyterInfoPanel'
  | 'settingsPanel'
  | 'debugPanel'
  | 'databasePanel'
  | 'secretsPanel';

/**
 * Sidebar panels all stay mounted, so each one is told whether it is the visible one.
 * Hiding uses the `.is-hidden` class from styles/_base.scss; the visible state is left
 * alone, so the panel keeps the `display` its own stylesheet gives it.
 */
export interface PanelProps {
  hidden: boolean;
}
