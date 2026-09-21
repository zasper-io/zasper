import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { Provider } from '@/testing/Provider';

import NotebookEditor from './NotebookEditor';
import {
  createSession,
  deleteSession,
  FakeSocket,
  getNotebook,
  resetIds,
  saveNotebook,
  sessionForPath,
  sockets,
} from './notebookEditorFakes';
import { notebookContent, session, tab } from './notebookEditorTestKit';

vi.mock('@/api', async () => (await import('./notebookEditorFakes')).apiModule());
vi.mock('uuid', async () => ({ v4: (await import('./notebookEditorFakes')).nextId }));
vi.mock('@uiw/react-codemirror', async () =>
  (await import('./notebookEditorFakes')).codeMirrorModule()
);

vi.stubGlobal('WebSocket', FakeSocket);

const saveAs = vi.fn();
vi.mock('@/browser', async () => {
  const actual = await vi.importActual<typeof import('@/browser')>('@/browser');
  return { ...actual, saveAs: (...args: unknown[]) => saveAs(...args) };
});

/**
 * The export control: a download button at the end of the notebook toolbar, and a dialog in front of
 * the HTML format alone.
 *
 * What the conversion produces has its own suites under export/. This is only about the way in.
 */
describe('NotebookEditor export', () => {
  beforeEach(() => {
    sockets.length = 0;
    resetIds();
    saveAs.mockReset();
    getNotebook.mockReset();
    getNotebook.mockResolvedValue({
      name: tab.name,
      type: 'notebook',
      path: tab.path,
      content: structuredClone(notebookContent),
    });
    sessionForPath.mockReset();
    sessionForPath.mockResolvedValue(undefined);
    createSession.mockReset();
    createSession.mockResolvedValue(session);
    deleteSession.mockReset();
    deleteSession.mockResolvedValue(undefined);
    saveNotebook.mockReset();
    saveNotebook.mockResolvedValue(undefined);
  });

  /** The menu's own rows. `role="menuitem"` tells "Markdown" here from the cell-type option above. */
  const row = (label: string) => screen.getByRole('menuitem', { name: label });

  /** The dialog's Export, which shares its name with the toolbar button that opened the menu. */
  const dialogButton = (label: string) =>
    within(screen.getByRole('dialog')).getByRole('button', { name: label });

  async function openExportMenu() {
    render(
      <Provider>
        <NotebookEditor data={tab} />
      </Provider>
    );
    await waitFor(() => expect(sockets).toHaveLength(1));

    fireEvent.click(screen.getByRole('button', { name: 'Export' }));
  }

  it('offers the three formats and the notebook itself', async () => {
    await openExportMenu();

    expect(screen.getByText('Export as')).toBeInTheDocument();
    expect(row('HTML page…')).toBeInTheDocument();
    expect(row('Markdown')).toBeInTheDocument();
    expect(row('Script')).toBeInTheDocument();
    // The row that already existed, moved to where someone exporting would look for it.
    expect(row('Download notebook')).toBeInTheDocument();
  });

  it('writes a Markdown file straight from the row, with no question asked', async () => {
    await openExportMenu();

    fireEvent.click(row('Markdown'));

    await waitFor(() => expect(saveAs).toHaveBeenCalled());
    expect(saveAs.mock.calls[0][1]).toBe('notebook.md');
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  // Option D: HTML is the one format with something to leave out, so it is the one that asks.
  it('asks before writing an HTML page', async () => {
    await openExportMenu();

    fireEvent.click(row('HTML page…'));

    expect(await screen.findByRole('dialog')).toBeInTheDocument();
    expect(screen.getByText('Export as HTML')).toBeInTheDocument();
    expect(screen.getByLabelText('Include the code')).toBeChecked();
    expect(screen.getByLabelText('Include the outputs')).toBeChecked();
    expect(saveAs).not.toHaveBeenCalled();
  });

  it('writes the page once the dialog is confirmed', async () => {
    await openExportMenu();
    fireEvent.click(row('HTML page…'));
    await screen.findByRole('dialog');

    fireEvent.click(dialogButton('Export'));

    await waitFor(() => expect(saveAs).toHaveBeenCalled());
    expect(saveAs.mock.calls[0][1]).toBe('notebook.html');
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('writes nothing when the dialog is cancelled', async () => {
    await openExportMenu();
    fireEvent.click(row('HTML page…'));
    await screen.findByRole('dialog');

    fireEvent.click(dialogButton('Cancel'));

    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    expect(saveAs).not.toHaveBeenCalled();
  });

  // Both boxes clear leaves a page with a title and nothing under it, which is not worth writing.
  it('refuses an export that would carry nothing', async () => {
    await openExportMenu();
    fireEvent.click(row('HTML page…'));
    await screen.findByRole('dialog');

    fireEvent.click(screen.getByLabelText('Include the code'));
    fireEvent.click(screen.getByLabelText('Include the outputs'));

    expect(dialogButton('Export')).toBeDisabled();
  });
});
