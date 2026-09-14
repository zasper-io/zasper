import { atom, useAtomValue, useSetAtom } from 'jotai';

import { EditorSettings, logApiError, saveEditorSettings } from '@/api';

import { editorSettingsAtom } from './settings';

// Merged into the settings as the store holds them, not as a render saw them, so two changes made before
// the next render both land.
const changeEditorSettingsAtom = atom(null, (get, set, change: Partial<EditorSettings>) => {
  const next = { ...get(editorSettingsAtom), ...change };
  set(editorSettingsAtom, next);
  saveEditorSettings(next).catch(logApiError('Error saving the editor settings:'));
});

/** The editor settings, and a change to some of them: applied at once, and saved whole. */
export function useEditorSettings(): [EditorSettings, (change: Partial<EditorSettings>) => void] {
  return [useAtomValue(editorSettingsAtom), useSetAtom(changeEditorSettingsAtom)];
}
