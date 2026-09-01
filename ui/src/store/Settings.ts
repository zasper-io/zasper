import { atom } from 'jotai';

import { defaultTheme } from '../themes';

export const settingsAtom = atom({
  theme: defaultTheme.id,
  encoding: 'UTF-8',
  language: 'en',
  activeLine: 1,
  activeColumn: 1,
  notificationsEnabled: true,
  tabSize: '4',
});

/** A theme id from the registry (src/themes). IDE.tsx publishes it to <html>. */
export const themeAtom = atom(defaultTheme.id);
