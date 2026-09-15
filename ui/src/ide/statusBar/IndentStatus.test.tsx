import { fireEvent, render, screen } from '@testing-library/react';
import { useAtomValue } from 'jotai';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { DEFAULT_EDITOR_SETTINGS } from '@/store/settings';
import { FileFormat, fileFormatsAtom } from '@/store/editorStatus';
import { Provider } from '@/testing/Provider';
import EolStatus from './EolStatus';
import IndentStatus from './IndentStatus';

const saveEditorSettings = vi.fn();

vi.mock('@/api', () => ({
  saveEditorSettings: (settings: unknown) => saveEditorSettings(settings),
  logApiError: () => () => {},
}));

const opened: FileFormat = {
  indentWithTabs: false,
  tabSize: 4,
  eol: 'LF',
  detected: { indentWithTabs: true, tabSize: 4 },
  source: 'settings',
  trim: null,
  finalNewline: null,
};

function FormatProbe() {
  const format = useAtomValue(fileFormatsAtom)['prepare.py'];
  return <span data-testid="format">{JSON.stringify(format)}</span>;
}

function format(): FileFormat {
  return JSON.parse(screen.getByTestId('format').textContent ?? '');
}

function renderStatus(initial: FileFormat = opened) {
  render(
    <Provider initialValues={[[fileFormatsAtom, { 'prepare.py': initial }]]}>
      <IndentStatus path="prepare.py" />
      <EolStatus path="prepare.py" />
      <FormatProbe />
    </Provider>
  );
}

function openIndentMenu() {
  fireEvent.click(screen.getByRole('button', { name: /^Indentation/ }));
}

describe('IndentStatus', () => {
  beforeEach(() => {
    saveEditorSettings.mockReset();
    saveEditorSettings.mockResolvedValue(undefined);
  });

  it('shows the indentation the file is edited with', () => {
    renderStatus();

    expect(screen.getByRole('button', { name: /^Indentation/ })).toHaveTextContent('Spaces: 4');
  });

  it('changes this file only', () => {
    renderStatus();
    openIndentMenu();

    fireEvent.click(screen.getByRole('menuitemradio', { name: 'Tabs' }));

    expect(format()).toMatchObject({ indentWithTabs: true, source: 'chosen' });
    expect(screen.queryByRole('menu')).not.toBeInTheDocument();
    expect(saveEditorSettings).not.toHaveBeenCalled();
  });

  it('makes this file’s indentation the default for every file', () => {
    renderStatus();
    openIndentMenu();
    fireEvent.click(screen.getByRole('menuitemradio', { name: '2' }));
    openIndentMenu();

    fireEvent.click(screen.getByRole('menuitem', { name: 'Use for every file' }));

    expect(saveEditorSettings).toHaveBeenCalledWith({ ...DEFAULT_EDITOR_SETTINGS, tab_size: 2 });
    expect(format()).toMatchObject({ source: 'settings' });
    expect(screen.getByRole('button', { name: /^Indentation/ })).toHaveTextContent('Spaces: 2');
  });

  it('takes the indentation the file’s own lines use', () => {
    renderStatus();
    openIndentMenu();

    fireEvent.click(screen.getByRole('menuitem', { name: 'Detect from the file' }));

    expect(screen.getByRole('button', { name: /^Indentation/ })).toHaveTextContent('Tabs: 4');
  });

  it('cannot detect anything in a file with nothing indented', () => {
    renderStatus({ ...opened, detected: null });
    openIndentMenu();

    expect(screen.getByRole('menuitem', { name: 'Detect from the file' })).toBeDisabled();
  });
});

describe('EolStatus', () => {
  it('changes the line endings the file is saved with', () => {
    renderStatus();
    fireEvent.click(screen.getByRole('button', { name: 'Line endings: LF' }));

    fireEvent.click(screen.getByRole('menuitemradio', { name: 'CRLF' }));

    expect(format()).toMatchObject({ eol: 'CRLF' });
    expect(screen.getByRole('button', { name: 'Line endings: CRLF' })).toBeInTheDocument();
  });
});
