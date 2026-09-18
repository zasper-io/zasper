import { LSPClient, LSPPlugin, Workspace, WorkspaceFile } from '@codemirror/lsp-client';
import { ChangeSet, Text } from '@codemirror/state';
import { EditorView } from '@codemirror/view';

import { changeBetween } from '@/ide/editor/textChange';
import { VirtualDocument } from './notebookDocument';

class OpenFile implements WorkspaceFile {
  constructor(
    readonly uri: string,
    readonly languageId: string,
    public version: number,
    public doc: Text,
    readonly view: EditorView
  ) {}

  getView(): EditorView {
    return this.view;
  }
}

/**
 * A notebook's cells as one document (`notebookDocument.ts`). No editor holds it, so what has changed is
 * kept here rather than read from a view, with the layout that says which cell each line came from.
 */
export class NotebookFile implements WorkspaceFile {
  pending: { doc: Text; layout: VirtualDocument } | null = null;

  constructor(
    readonly uri: string,
    readonly languageId: string,
    public version: number,
    public doc: Text,
    /** Where each cell is in `doc`, the text the server was last sent. */
    public layout: VirtualDocument
  ) {}

  getView(): null {
    return null;
  }

  /** Takes in what is waiting, returning the change from the text the server has. */
  settle(): ChangeSet | null {
    const waiting = this.pending;
    this.pending = null;
    if (waiting === null || waiting.doc.eq(this.doc)) {
      if (waiting !== null) {
        this.layout = waiting.layout;
      }
      return null;
    }
    const changes = ChangeSet.of(
      changeBetween(this.doc.toString(), waiting.doc.toString()),
      this.doc.length
    );
    this.doc = waiting.doc;
    this.layout = waiting.layout;
    return changes;
  }
}

export interface WorkspaceHooks {
  /** A file of this server's language was opened, which is when the server is wanted. */
  opened: (uri: string) => void;
  /** The last one was closed. */
  emptied: () => void;
  /** Puts a file in front of the reader, for a jump into another file. */
  display: (uri: string) => Promise<EditorView | null>;
}

/**
 * The files one server has open: one editor per file, as the file editor has.
 *
 * Ours rather than the library's default for one reason — `displayFile`, which is how go to definition
 * reaches a file in another tab. An editor remounted for the same file (the file editor makes a new one
 * each time it reads the file) is the file closed and opened again, at a new version.
 */
export class ZasperWorkspace extends Workspace {
  files: (OpenFile | NotebookFile)[] = [];
  private versions: Record<string, number> = {};

  constructor(
    client: LSPClient,
    private readonly hooks: WorkspaceHooks
  ) {
    super(client);
  }

  private nextVersion(uri: string): number {
    this.versions[uri] = (this.versions[uri] ?? -1) + 1;
    return this.versions[uri];
  }

  /**
   * What each editor has changed since its file was last sent. A file with edits waiting moves on to a new
   * version holding the editor's document, and the edits are handed over once, to be sent as that version.
   */
  syncFiles(): { file: WorkspaceFile; prevDoc: Text; changes: ChangeSet }[] {
    return this.files.flatMap(
      (file): { file: WorkspaceFile; prevDoc: Text; changes: ChangeSet }[] => {
        if (file instanceof NotebookFile) {
          const prevDoc = file.doc;
          const changes = file.settle();
          if (changes === null) {
            return [];
          }
          file.version = this.nextVersion(file.uri);
          return [{ file, prevDoc, changes }];
        }
        const plugin = LSPPlugin.get(file.view);
        const waiting = plugin?.unsyncedChanges;
        if (!plugin || !waiting || waiting.empty) {
          return [];
        }
        const sent = { file, prevDoc: file.doc, changes: waiting };
        plugin.clear();
        file.version = this.nextVersion(file.uri);
        file.doc = file.view.state.doc;
        return [sent];
      }
    );
  }

  openFile(uri: string, languageId: string, view: EditorView): void {
    const open = this.getFile(uri) as OpenFile | NotebookFile | null;
    if (open !== null) {
      if (open instanceof NotebookFile || open.view === view) {
        return;
      }
      this.closeFile(uri, open.view);
    }
    const file = new OpenFile(uri, languageId, this.nextVersion(uri), view.state.doc, view);
    this.files.push(file);
    this.client.didOpen(file);
    this.hooks.opened(uri);
  }

  /** Opens a notebook's virtual document, which has no editor to open it through. */
  openNotebook(
    uri: string,
    languageId: string,
    text: string,
    layout: VirtualDocument
  ): NotebookFile {
    const known = this.getFile(uri);
    if (known !== null) {
      this.forget(known as OpenFile | NotebookFile);
    }
    const file = new NotebookFile(
      uri,
      languageId,
      this.nextVersion(uri),
      Text.of(text.split('\n')),
      layout
    );
    this.files.push(file);
    this.client.didOpen(file);
    this.hooks.opened(uri);
    return file;
  }

  closeNotebook(file: NotebookFile): void {
    if (this.files.includes(file)) {
      this.forget(file);
    }
  }

  /** A reconnected server is sent each notebook as it stands, not as it was last synchronised. */
  connected(): void {
    this.files.forEach((file) => {
      if (file instanceof NotebookFile) {
        file.settle();
      }
    });
    super.connected();
  }

  closeFile(uri: string, view: EditorView): void {
    const file = this.getFile(uri) as OpenFile | NotebookFile | null;
    if (file === null || file instanceof NotebookFile || file.view !== view) {
      return;
    }
    this.forget(file);
  }

  private forget(file: OpenFile | NotebookFile): void {
    this.files = this.files.filter((each) => each !== file);
    this.client.didClose(file.uri);
    if (this.files.length === 0) {
      this.hooks.emptied();
    }
  }

  displayFile(uri: string): Promise<EditorView | null> {
    return this.hooks.display(uri);
  }
}
