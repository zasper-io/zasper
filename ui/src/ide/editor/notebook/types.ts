// View-model types for the notebook editor. The document itself — cells,
// outputs, nbformat metadata — is a wire shape and lives in api/notebook.ts.

/**
 * The kernel websocket, as handed down to widget output. Left loose because the
 * comm-based widget protocol is not wired up yet.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type IKernelConnection = any;

/**
 * The subset of a keyboard event the notebook shortcut handler reads. CodeMirror
 * cells forward synthesised events, so a full React event is not always available.
 */
export interface INotebookKeyEvent {
  key: string;
  ctrlKey?: boolean;
  shiftKey?: boolean;
  metaKey?: boolean;
  preventDefault: () => void;
}
