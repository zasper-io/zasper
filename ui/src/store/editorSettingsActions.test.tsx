import { act, renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { Provider } from '@/testing/Provider';
import { useEditorSettings } from './editorSettingsActions';
import { DEFAULT_EDITOR_SETTINGS } from './settings';

const saveEditorSettings = vi.fn();

vi.mock('@/api', () => ({
  saveEditorSettings: (settings: unknown) => saveEditorSettings(settings),
  logApiError: () => () => {},
}));

describe('useEditorSettings', () => {
  beforeEach(() => {
    saveEditorSettings.mockReset();
    saveEditorSettings.mockResolvedValue(undefined);
  });

  it('keeps both of two changes made before the next render', () => {
    const { result } = renderHook(() => useEditorSettings(), { wrapper: Provider });

    act(() => {
      const [, change] = result.current;
      change({ rulers: [80] });
      change({ show_whitespace: true });
    });

    const both = { ...DEFAULT_EDITOR_SETTINGS, rulers: [80], show_whitespace: true };
    expect(result.current[0]).toEqual(both);
    expect(saveEditorSettings).toHaveBeenLastCalledWith(both);
  });
});
