// The two things here are asked of the browser itself rather than of the server: saving bytes the app
// already has, and writing the system clipboard. Beside paths.ts rather than inside a feature, since
// nothing about either belongs to the file browser.

/**
 * Saves a blob under `filename`, through a link the browser clicks for itself. The object URL is
 * revoked afterwards: it holds the blob in memory for the lifetime of the document otherwise, which
 * for a large file is the whole file.
 */
export function saveAs(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

/**
 * Puts text on the system clipboard. Answers false when the browser refused — the Clipboard API is
 * only available over HTTPS or on localhost, and a caller has to be able to say so.
 */
export async function copyToClipboard(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    return false;
  }
}
