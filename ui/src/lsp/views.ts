import { EditorView } from '@codemirror/view';

const views = new Map<string, EditorView>();
const waiting = new Map<string, ((view: EditorView) => void)[]>();

/** Says which editor view holds a file, or that none does any more. */
export function registerEditorView(path: string, view: EditorView | null): void {
  if (view === null) {
    views.delete(path);
    return;
  }
  views.set(path, view);
  waiting.get(path)?.forEach((resolve) => resolve(view));
  waiting.delete(path);
}

/**
 * The view for a file once an editor has it, for a jump into a file that is only now being opened. Null
 * when no editor arrives in time — the file could not be read, or is not text.
 */
export function waitForEditorView(path: string, timeout = 5000): Promise<EditorView | null> {
  const open = views.get(path);
  if (open !== undefined) {
    return Promise.resolve(open);
  }
  return new Promise((resolve) => {
    const timer = window.setTimeout(() => {
      waiting.set(
        path,
        (waiting.get(path) ?? []).filter((each) => each !== done)
      );
      resolve(null);
    }, timeout);
    const done = (view: EditorView) => {
      window.clearTimeout(timer);
      resolve(view);
    };
    waiting.set(path, [...(waiting.get(path) ?? []), done]);
  });
}
