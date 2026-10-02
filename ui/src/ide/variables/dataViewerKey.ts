/** A data viewer tab's key: the notebook whose kernel holds the variable, and the variable's name. */
const PREFIX = 'data-viewer:';
const SEPARATOR = '::';

export function dataViewerKey(notebookPath: string, name: string): string {
  return `${PREFIX}${notebookPath}${SEPARATOR}${name}`;
}

export function parseDataViewerKey(key: string): { notebookPath: string; name: string } | null {
  if (!key.startsWith(PREFIX)) {
    return null;
  }
  const rest = key.slice(PREFIX.length);
  const at = rest.lastIndexOf(SEPARATOR);
  if (at < 0) {
    return null;
  }
  return { notebookPath: rest.slice(0, at), name: rest.slice(at + SEPARATOR.length) };
}

/** Rows by columns, or a length, as the panel and the viewer show a variable's size. */
export function dimensions(shape: number[] | null, size: number | null): string {
  if (shape !== null && shape.length > 0) {
    return shape.map((n) => n.toLocaleString()).join(' × ');
  }
  return size === null ? '' : `len ${size.toLocaleString()}`;
}
