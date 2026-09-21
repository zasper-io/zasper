import { fireEvent, render, screen, within } from '@testing-library/react';
import { createStore, Provider, useAtomValue } from 'jotai';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import SettingsTab, { parseRulers } from './SettingsTab';
import { interpreterChoiceAtom } from '@/store/interpreters';
import { DEFAULT_EDITOR_SETTINGS, themeAtom } from '@/store/settings';
import { FileTab } from '@/store/tabState';
import { themes } from '@/themes';

const modifyConfig = vi.fn();
const getInterpreters = vi.fn();

vi.mock('@/api', () => ({
  modifyConfig: (key: string, value: string) => modifyConfig(key, value),
  saveEditorSettings: (settings: unknown) => modifyConfig('editor', JSON.stringify(settings)),
  logApiError: () => () => {},
  getInterpreters: () => getInterpreters(),
  apiErrorMessage: (error: unknown) => String(error),
}));

const tab: FileTab = {
  type: 'settings',
  path: 'zasper:settings',
  name: 'Settings',
  active: true,
  extension: null,
  load_required: false,
  kernelspec: 'none',
};

/** The atom is what the rest of the IDE reads, so the test reads it the same way. */
function ThemeProbe() {
  return <span data-testid="theme">{useAtomValue(themeAtom)}</span>;
}

function renderTab() {
  return render(
    <Provider>
      <SettingsTab data={tab} />
      <ThemeProbe />
    </Provider>
  );
}

function savedEditor(change: object) {
  return ['editor', JSON.stringify({ ...DEFAULT_EDITOR_SETTINGS, ...change })];
}

describe('SettingsTab', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    modifyConfig.mockResolvedValue(undefined);
  });

  it('labels the theme picker', () => {
    renderTab();
    expect(screen.getByLabelText('Theme').tagName).toBe('SELECT');
  });

  it('offers every registered theme', () => {
    renderTab();
    const options = within(screen.getByLabelText('Theme')).getAllByRole('option');
    expect(options.map((option) => option.textContent)).toEqual(themes.map((theme) => theme.label));
  });

  it('applies the chosen theme and saves it', () => {
    renderTab();
    fireEvent.change(screen.getByLabelText('Theme'), { target: { value: 'teal-dark' } });

    expect(screen.getByTestId('theme')).toHaveTextContent('teal-dark');
    expect(modifyConfig).toHaveBeenCalledWith('theme', 'teal-dark');
  });

  // A failed write must not undo the theme the user can already see.
  it('keeps the theme when saving it fails', async () => {
    modifyConfig.mockRejectedValue(new Error('disk full'));
    renderTab();
    fireEvent.change(screen.getByLabelText('Theme'), { target: { value: 'orange-light' } });

    await Promise.resolve();
    expect(screen.getByTestId('theme')).toHaveTextContent('orange-light');
  });

  it('turns loading widget code from the CDN off, and saves that', () => {
    renderTab();
    const box = screen.getByLabelText('Load widget libraries from the internet');
    expect(box).toBeChecked();

    fireEvent.click(box);

    expect(box).not.toBeChecked();
    expect(modifyConfig).toHaveBeenCalledWith('widget_cdn', 'off');
  });

  it('saves the editor settings whole when one of them changes', () => {
    renderTab();

    fireEvent.change(screen.getByLabelText('Tab size'), { target: { value: '2' } });
    fireEvent.click(screen.getByLabelText('Insert a tab in a cell'));

    expect(modifyConfig).toHaveBeenCalledWith(...savedEditor({ tab_size: 2 }));
    expect(modifyConfig).toHaveBeenLastCalledWith(
      ...savedEditor({ tab_size: 2, cell_tab_indents: true })
    );
  });

  it('saves the keymap the editor should take', () => {
    renderTab();

    fireEvent.change(screen.getByLabelText('Keymap'), { target: { value: 'vim' } });

    expect(modifyConfig).toHaveBeenCalledWith(...savedEditor({ keymap: 'vim' }));
  });

  it('saves a font size on leaving the field, and puts back one out of range', () => {
    renderTab();
    const field = screen.getByLabelText('Font size');

    fireEvent.change(field, { target: { value: '99' } });
    fireEvent.blur(field);
    expect(field).toHaveValue('13');
    expect(modifyConfig).not.toHaveBeenCalled();

    fireEvent.change(field, { target: { value: '15' } });
    fireEvent.keyDown(field, { key: 'Enter' });
    expect(modifyConfig).toHaveBeenCalledWith(...savedEditor({ font_size: 15 }));
  });

  it('reads rulers as columns, in order, and empty as none', () => {
    expect(parseRulers('100, 80 80')).toEqual([80, 100]);
    expect(parseRulers('')).toEqual([]);
    expect(parseRulers('80, wide')).toBeNull();
  });

  it('finds a setting in any group from one search', () => {
    renderTab();

    fireEvent.change(screen.getByLabelText('Search settings'), { target: { value: 'tab' } });

    expect(screen.getByLabelText('Tab size')).toBeInTheDocument();
    expect(screen.getByLabelText('Indent with')).toBeInTheDocument();
    expect(screen.getByLabelText('Insert a tab in a cell')).toBeInTheDocument();
    expect(screen.queryByLabelText('Theme')).not.toBeInTheDocument();
    expect(screen.queryByLabelText('Font size')).not.toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Notebook' })).toBeInTheDocument();
  });

  it('says when no setting matches', () => {
    renderTab();

    fireEvent.change(screen.getByLabelText('Search settings'), { target: { value: 'kerning' } });

    expect(screen.getByText('No setting matches “kerning”.')).toBeInTheDocument();
  });
});

describe('the Python interpreter', () => {
  const choice = {
    chosen: '',
    automatic: '/p/.venv/bin/python3',
    interpreters: [
      { executable: '/p/.venv/bin/python3', version: '3.12', where: '.venv' },
      { executable: '/opt/homebrew/bin/python3', version: '3.13', where: 'Homebrew' },
    ],
  };

  function renderWith(value: typeof choice) {
    const store = createStore();
    store.set(interpreterChoiceAtom, value);
    render(
      <Provider store={store}>
        <SettingsTab data={tab} />
      </Provider>
    );
    return store;
  }

  beforeEach(() => {
    vi.clearAllMocks();
    modifyConfig.mockResolvedValue(undefined);
  });

  it('offers automatic and every Python found, and names the one in use', () => {
    renderWith(choice);
    const options = within(screen.getByLabelText('Python interpreter')).getAllByRole('option');
    expect(options.map((option) => option.textContent)).toEqual([
      'Automatic',
      '.venv · 3.12',
      'Homebrew · 3.13',
    ]);
    // The select is too narrow for a path, so the one in use is spelled out beside it.
    expect(screen.getByText('/p/.venv/bin/python3').tagName).toBe('CODE');
  });

  it('saves the choice, and takes the answer the server gives back', async () => {
    const chosen = { ...choice, chosen: '/opt/homebrew/bin/python3' };
    getInterpreters.mockResolvedValue(chosen);
    const store = renderWith(choice);
    fireEvent.change(screen.getByLabelText('Python interpreter'), {
      target: { value: '/opt/homebrew/bin/python3' },
    });

    expect(modifyConfig).toHaveBeenCalledWith('python_interpreter', '/opt/homebrew/bin/python3');
    await vi.waitFor(() => expect(store.get(interpreterChoiceAtom)).toEqual(chosen));
  });

  it('still shows a choice whose Python has since gone, rather than claiming automatic', () => {
    renderWith({ ...choice, chosen: '/gone/bin/python3' });
    const select = screen.getByLabelText('Python interpreter') as HTMLSelectElement;
    expect(select.value).toBe('/gone/bin/python3');
    expect(select.selectedOptions[0].textContent).toBe('Not found');
    expect(screen.getByText('/gone/bin/python3').tagName).toBe('CODE');
  });
});
