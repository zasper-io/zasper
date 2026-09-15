import { atom } from 'jotai';

import type { EditorSettings } from '@/api';

import { storedTheme } from '../themes';

/**
 * A theme id from the registry (src/themes). IDE.tsx publishes it to <html>.
 *
 * Starts at what this browser last applied rather than at the default, so the atom agrees with the
 * attributes main.tsx has already written and `GET /api/config` confirms the theme instead of
 * changing it.
 */
export const themeAtom = atom(storedTheme().id);

/**
 * What the server said about telemetry: whether anything is being sent, and whether this install has
 * ever been asked. Held in an atom so the settings panel and the first-run notice agree without
 * either of them asking the server again.
 */
export const telemetryAtom = atom({ enabled: false, chosen: true });

/**
 * Whether widget libraries that are not bundled may be loaded from cdn.jsdelivr.net. Kept in the
 * server's config and read from /api/info, because it is a choice about the install rather than about
 * one browser.
 */
export const widgetCdnAtom = atom(true);

/** What an install that has chosen nothing gets, and what a server older than the setting implies. */
export const DEFAULT_EDITOR_SETTINGS: EditorSettings = {
  font_size: 13,
  tab_size: 4,
  indent_with_tabs: false,
  word_wrap: false,
  line_numbers: true,
  show_whitespace: false,
  rulers: [],
  cell_tab_indents: false,
  trim_trailing_whitespace: false,
  insert_final_newline: false,
  auto_save: false,
  keymap: 'default',
};

/** The file editor's defaults, from /api/info and changed in the Settings tab or the status bar. */
export const editorSettingsAtom = atom<EditorSettings>(DEFAULT_EDITOR_SETTINGS);
