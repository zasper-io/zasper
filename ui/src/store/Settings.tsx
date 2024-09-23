import { atom } from 'jotai';

export const settingsAtom = atom({
    theme: 'light',
    language: 'en',
    notificationsEnabled: true,
    tabSize: '4'
});

