// View-model types for the notebook editor. The document itself — cells,
// outputs, nbformat metadata — is a wire shape and lives in api/notebook.ts.

/**
 * The kernel websocket, as handed down to widget output. Left loose because the
 * comm-based widget protocol is not wired up yet.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type IKernelConnection = any;

// INotebookKeyEvent used to live here: the shape a cell synthesised so it could hand a fake
// keyboard event up to the notebook's shortcut handler. Both are gone — shortcuts are commands
// now, and a cell dispatches one by id instead of pretending to be a keypress.
