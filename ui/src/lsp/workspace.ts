import { LSPClient, LSPPlugin, Workspace, WorkspaceFile } from '@codemirror/lsp-client';
import { ChangeSet, Text } from '@codemirror/state';
import { EditorView } from '@codemirror/view';

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

export interface WorkspaceHooks {
  /** A file of this server's language was opened, which is when the server is wanted. */
  opened: () => void;
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
  files: OpenFile[] = [];
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
    return this.files.flatMap((file) => {
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
    });
  }

  openFile(uri: string, languageId: string, view: EditorView): void {
    const open = this.getFile(uri) as OpenFile | null;
    if (open !== null) {
      if (open.view === view) {
        return;
      }
      this.closeFile(uri, open.view);
    }
    const file = new OpenFile(uri, languageId, this.nextVersion(uri), view.state.doc, view);
    this.files.push(file);
    this.client.didOpen(file);
    this.hooks.opened();
  }

  closeFile(uri: string, view: EditorView): void {
    const file = this.getFile(uri) as OpenFile | null;
    if (file === null || file.view !== view) {
      return;
    }
    this.files = this.files.filter((each) => each !== file);
    this.client.didClose(uri);
    if (this.files.length === 0) {
      this.hooks.emptied();
    }
  }

  displayFile(uri: string): Promise<EditorView | null> {
    return this.hooks.display(uri);
  }
}
