import { useCallback } from 'react';
import { toast } from 'react-toastify';

import { NotebookModel } from '@/api';
import { saveAs } from '@/browser';

import type { ExportFormatId } from './exportFormats';

/*
Running an export, from the press to the file in the reader's downloads.

No API call. The notebook is already in the browser, the renderers that turn it into a page are already
in the browser, and `saveAs` is the same helper the file browser's Download row and the file editor use
— so nothing here touches auth, cookies, or the two ports `make dev` runs on.

Every converter is reached by a dynamic import. `toHtml` has to be: it pulls in KaTeX, the markdown
pipeline and `react-dom/server`, and importing it eagerly would put all three in the main bundle, which
is the thing MarkdownRenderer.tsx's own comment warns about. The other two are light and are imported
the same way for symmetry — a reader of this file should not have to know which is which.
*/

export interface NotebookExportSource {
  notebook: NotebookModel;
  /** The notebook's file name, which names the exported file and heads it. */
  name: string;
  /** The attached kernel's language and display name, when there is one. */
  kernelLanguage?: string;
  kernelDisplayName?: string;
}

export interface ExportOptions {
  /** HTML only: false makes the page a report rather than a record. */
  includeCode?: boolean;
  /** HTML only: false makes it the prose and the code, with nothing the kernel produced. */
  includeOutputs?: boolean;
}

interface ExportedFile {
  filename: string;
  mimeType: string;
  text: string;
}

async function convert(
  format: ExportFormatId,
  source: NotebookExportSource,
  options: ExportOptions
): Promise<ExportedFile> {
  const { notebook, name, kernelLanguage, kernelDisplayName } = source;
  const { exportFilename } = await import('./exportFormats');

  if (format === 'markdown') {
    const { notebookToMarkdown } = await import('./toMarkdown');
    return {
      filename: exportFilename(name, 'md'),
      mimeType: 'text/markdown',
      text: notebookToMarkdown(notebook, { language: kernelLanguage }),
    };
  }

  if (format === 'script') {
    const { notebookToScript } = await import('./toScript');
    const script = notebookToScript(notebook, kernelLanguage);
    return {
      filename: exportFilename(name, script.extension),
      // Not the language's own type: a browser handed `text/x-python` may offer to open it rather
      // than save it, and every one of these is a text file.
      mimeType: 'text/plain',
      text: script.text,
    };
  }

  const { notebookToHtml } = await import('./toHtml');
  return {
    filename: exportFilename(name, 'html'),
    mimeType: 'text/html',
    text: await notebookToHtml(notebook, {
      title: name,
      kernelDisplayName,
      language: kernelLanguage,
      includeCode: options.includeCode ?? true,
      includeOutputs: options.includeOutputs ?? true,
    }),
  };
}

/**
 * Exports the notebook as it is on screen — unsaved edits and the output the kernel produced a second
 * ago included. It never rejects: a failure is a toast, because an export is something the reader asked
 * for and nothing else in the tab depends on it having worked.
 */
export function useNotebookExport(
  source: NotebookExportSource
): (format: ExportFormatId, options?: ExportOptions) => Promise<void> {
  // Deliberately not memoized on `source`, for the reason useNotebookCommands gives: the notebook is a
  // new object on every keystroke and every output, and a dependency list naming it would be pointless.
  const { notebook, name, kernelLanguage, kernelDisplayName } = source;

  return useCallback(
    async (format, options) => {
      try {
        const file = await convert(
          format,
          { notebook, name, kernelLanguage, kernelDisplayName },
          options ?? {}
        );
        // A notebook with no code and no output exports as an empty file, which is a confusing thing
        // to be handed. Said rather than written.
        if (file.text.trim() === '') {
          toast.info('There is nothing in this notebook to export.');
          return;
        }
        saveAs(new Blob([file.text], { type: `${file.mimeType};charset=utf-8` }), file.filename);
        toast.success(`Exported ${file.filename}`);
      } catch (error) {
        toast.error(`The export failed: ${error instanceof Error ? error.message : String(error)}`);
      }
    },
    [notebook, name, kernelLanguage, kernelDisplayName]
  );
}
