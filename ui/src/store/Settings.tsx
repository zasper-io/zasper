import { atom } from 'jotai';

export const settingsAtom = atom({
  theme: 'light',
  encoding: 'UTF-8',
  language: 'en',
  activeLine: 1,
  activeColumn: 1,
  notificationsEnabled: true,
  tabSize: '4',
});

export const themeAtom = atom('light');
