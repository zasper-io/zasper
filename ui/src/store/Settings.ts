import { atom } from 'jotai';

import { defaultTheme, storedTheme } from '../themes';

export const settingsAtom = atom({
  theme: defaultTheme.id,
  encoding: 'UTF-8',
  language: 'en',
  activeLine: 1,
  activeColumn: 1,
  notificationsEnabled: true,
  tabSize: '4',
});

/**
 * A theme id from the registry (src/themes). IDE.tsx publishes it to <html>.
 *
 * Starts at what this browser last applied rather than at the default, so the atom agrees with the
 * attributes main.tsx has already written and `GET /api/config` confirms the theme instead of
 * changing it.
 */
export const themeAtom = atom(storedTheme().id);
