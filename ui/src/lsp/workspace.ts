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

  syncFiles(): { file: WorkspaceFile; prevDoc: Text; changes: ChangeSet }[] {
    const updates: { file: WorkspaceFile; prevDoc: Text; changes: ChangeSet }[] = [];
    for (const file of this.files) {
      const plugin = LSPPlugin.get(file.view);
      if (plugin === null || plugin.unsyncedChanges.empty) {
        continue;
      }
      updates.push({ file, prevDoc: file.doc, changes: plugin.unsyncedChanges });
      file.doc = file.view.state.doc;
      file.version = this.nextVersion(file.uri);
      plugin.clear();
    }
    return updates;
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
