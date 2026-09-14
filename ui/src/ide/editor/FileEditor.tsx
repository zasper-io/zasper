import React, {
  lazy,
  Suspense,
  useCallback,
  useDeferredValue,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';

import CodeMirror from '@uiw/react-codemirror';
import { Extension, Text, Transaction } from '@codemirror/state';
import { EditorView, keymap, ViewUpdate } from '@codemirror/view';
import { useAtomValue, useSetAtom } from 'jotai';

import { apiErrorMessage, downloadContent, getFileContent, logApiError, saveFile } from '@/api';
import { saveAs } from '@/browser';
import { Icon, IconName } from '@/ide/icons';
import IconButton from '@/ide/IconButton';
import { useContentWatcher } from '@/ide/useContentWatcher';
import { baseName } from '@/paths';
import { columnPositionAtom, indentationSizeAtom, linePositionAtom } from '@/store/editorStatus';
import { FileTab } from '@/store/tabState';
import { useUnsavedChanges } from '@/store/unsavedState';
import { useTheme } from '@/themes/useTheme';

import BreadCrumb from './BreadCrumb';
import languageFor, { lazyLanguageFor } from './language';
import { zoomAwareTooltips } from './tooltipParent';

// The notebook's renderer, and its code-splitting boundary: see MarkdownRenderer.tsx.
const MarkdownRenderer = lazy(() => import('./notebook/MarkdownRenderer'));

type MarkdownView = 'edit' | 'preview' | 'split';

const MARKDOWN_VIEWS: { view: MarkdownView; icon: IconName; label: string }[] = [
  { view: 'edit', icon: 'pencil', label: 'Edit' },
  { view: 'preview', icon: 'eye', label: 'Preview' },
  { view: 'split', icon: 'columns-2', label: 'Side by side' },
];

function isMarkdown(extension: string | null): boolean {
  const lower = extension?.toLowerCase();
  return lower === 'md' || lower === 'markdown';
}

/** Text split into lines the way CodeMirror splits a document, so the two compare as equal. */
function documentOf(text: string): Text {
  return Text.of(text.split(/\r\n?|\n/));
}

/** The one change that turns `before` into `after`: what lies between their common start and end. */
function changeBetween(before: string, after: string) {
  const shorter = Math.min(before.length, after.length);
  let start = 0;
  while (start < shorter && before.charCodeAt(start) === after.charCodeAt(start)) {
    start++;
  }
  let end = 0;
  while (
    end < shorter - start &&
    before.charCodeAt(before.length - 1 - end) === after.charCodeAt(after.length - 1 - end)
  ) {
    end++;
  }
  return { from: start, to: before.length - end, insert: after.slice(start, after.length - end) };
}

interface FileEditorProps {
  data: FileTab;
}

export default function FileEditor(props: FileEditorProps) {
  const { path } = props.data;
  const name = props.data.name || baseName(path);

  /** What the editor was mounted with, on the last read. The document lives in CodeMirror after that. */
  const [initialText, setInitialText] = useState('');
  const [dirty, setDirty] = useState(false);
  /** Why the file could not be read, when it could not be. */
  const [error, setError] = useState('');
  /** The server sent the file as base64: it is not UTF-8 text, and the editor would change its bytes. */
  const [notText, setNotText] = useState(false);
  /** Bumped on every successful read; 0 until the first one lands. */
  const [readCount, setReadCount] = useState(0);
  const [markdownView, setMarkdownView] = useState<MarkdownView>('edit');
  const [previewText, setPreviewText] = useState('');
  const theme = useTheme();
  const sourceRef = useRef<HTMLDivElement>(null);
  const previewRef = useRef<HTMLDivElement>(null);
  const viewRef = useRef<EditorView | null>(null);
  /**
   * The document as it was last read or written. Unsaved means the editor's differs from it — asked of
   * CodeMirror's own document rather than of a copy of it made on every keystroke.
   */
  const savedDoc = useRef(Text.empty);
  /** A change on disk reported while this tab was in the background, to be looked at once it is not. */
  const changedWhileHidden = useRef(false);
  // Typing stays responsive in a long document: the rendering catches up between keystrokes.
  const previewSource = useDeferredValue(previewText);

  const hasText = error === '' && !notText;
  const markdown = isMarkdown(props.data.extension);
  const view: MarkdownView = markdown && hasText ? markdownView : 'edit';
  const previewing = useRef(false);
  previewing.current = view !== 'edit';

  const saveFileToDisk = useCallback(async () => {
    const editor = viewRef.current;
    if (editor === null) {
      return;
    }
    // The document that was written, not whatever the editor holds by the time the write returns: a
    // keystroke made in between leaves the file unsaved again.
    const written = editor.state.doc;
    await saveFile(path, written.toString());
    savedDoc.current = written;
    setDirty(!editor.state.doc.eq(written));
  }, [path]);

  // Nothing to save when the read failed: what the editor holds is not the file, and writing it would
  // create the file the tab is only pointing at. The close prompt must not offer to either.
  const canSave = hasText && readCount > 0;
  useUnsavedChanges(path, canSave && dirty, saveFileToDisk);

  const save = useRef(() => {});
  save.current = () => {
    if (canSave) {
      saveFileToDisk().catch(logApiError('Error saving file:'));
    }
  };
  const saveKeymap = useMemo(
    () =>
      keymap.of([
        {
          key: 'Mod-s',
          run: () => {
            save.current();
            return true;
          },
        },
      ]),
    []
  );

  // See tooltipParent.ts: a popup left to place itself draws at its own coordinate times the zoom.
  const popupPlacement = useMemo(() => zoomAwareTooltips(), []);

  const read = useCallback(async () => {
    try {
      const file = await getFileContent(path);
      const text = file.format === 'text' ? file.content : '';
      setNotText(file.format !== 'text');
      savedDoc.current = documentOf(text);
      setInitialText(text);
      setPreviewText(text);
      setDirty(false);
      setError('');
      setReadCount((count) => count + 1);
    } catch (failure) {
      // The file is gone, or was never there — a tab restored from a previous visit pointing at
      // something since deleted. Said out loud, because the alternative is an editor that looks like
      // an empty file and writes the deleted file back to disk on the first Mod-S.
      setError(apiErrorMessage(failure));
      setNotText(false);
      setInitialText('');
    }
  }, [path]);

  useEffect(() => {
    if (props.data.load_required === true) {
      void read();
    }
  }, [props.data, read]);

  /**
   * Takes in a change made to the file on disk — a `git checkout`, a formatter, another editor — when the
   * editor holds nothing unsaved. The change is applied as an edit between the common start and end of
   * the two versions, so the cursor stays where it was, and kept out of the undo history, which would
   * otherwise step back to what the file no longer says.
   *
   * A file with unsaved edits is left alone for now: which of the two to keep is the reader's choice.
   */
  const takeChangeFromDisk = useCallback(async () => {
    let file;
    try {
      file = await getFileContent(path);
    } catch {
      return;
    }
    const editor = viewRef.current;
    if (editor === null || file.format !== 'text') {
      return;
    }
    const onDisk = documentOf(file.content);
    if (onDisk.eq(savedDoc.current) || !editor.state.doc.eq(savedDoc.current)) {
      return;
    }
    savedDoc.current = onDisk;
    editor.dispatch({
      changes: changeBetween(editor.state.doc.toString(), onDisk.toString()),
      annotations: Transaction.addToHistory.of(false),
    });
  }, [path]);

  useContentWatcher(() => {
    if (!canSave) {
      return;
    }
    // Every open file would read itself again on every change anywhere in the project; a tab nobody
    // can see waits until it is shown.
    if (!props.data.active) {
      changedWhileHidden.current = true;
      return;
    }
    void takeChangeFromDisk();
  });

  useEffect(() => {
    if (props.data.active && changedWhileHidden.current) {
      changedWhileHidden.current = false;
      void takeChangeFromDisk();
    }
  }, [props.data.active, takeChangeFromDisk]);

  // Highlighted at once for a language the app bundles; any other that @codemirror/language-data knows
  // is loaded first, and a file nothing claims is plain text.
  const bundledLanguage = useMemo(() => languageFor(props.data.extension), [props.data.extension]);
  const [loadedLanguage, setLoadedLanguage] = useState<{ name: string; language: Extension }>();
  useEffect(() => {
    if (bundledLanguage !== null) {
      return;
    }
    const loading = lazyLanguageFor(name);
    if (loading === null) {
      return;
    }
    let live = true;
    loading
      .then((language) => {
        if (live) {
          setLoadedLanguage({ name, language });
        }
      })
      .catch((failure: unknown) =>
        console.error(`Could not load highlighting for ${name}:`, failure)
      );
    return () => {
      live = false;
    };
  }, [bundledLanguage, name]);
  const language =
    bundledLanguage ?? (loadedLanguage?.name === name ? loadedLanguage.language : null);

  const extensions = useMemo(
    () => [...(language === null ? [] : [language]), popupPlacement, saveKeymap],
    [language, popupPlacement, saveKeymap]
  );

  // Setters only: reading these atoms would render the whole editor again on every cursor move.
  const setLinePosition = useSetAtom(linePositionAtom);
  const setColumnPosition = useSetAtom(columnPositionAtom);
  const indentationSize = useAtomValue(indentationSizeAtom);
  const basicSetup = useMemo(
    () => ({
      bracketMatching: true,
      highlightActiveLineGutter: true,
      autocompletion: true,
      lintKeymap: true,
      foldGutter: true,
      completionKeymap: true,
      tabSize: indentationSize,
    }),
    [indentationSize]
  );

  const onUpdate = useCallback(
    (update: ViewUpdate) => {
      const { state } = update;
      const position = state.selection.main.head;
      const line = state.doc.lineAt(position);
      setLinePosition(line.number);
      setColumnPosition(position - line.from);

      if (update.docChanged) {
        setDirty(!state.doc.eq(savedDoc.current));
        if (previewing.current) {
          setPreviewText(state.doc.toString());
        }
      }
    },
    [setColumnPosition, setLinePosition]
  );

  const showView = (next: MarkdownView) => {
    if (next !== 'edit' && viewRef.current !== null) {
      setPreviewText(viewRef.current.state.doc.toString());
    }
    setMarkdownView(next);
  };

  const download = () => {
    downloadContent(path)
      .then((blob) => saveAs(blob, name))
      .catch((failure: unknown) => setError(apiErrorMessage(failure)));
  };

  // By proportion: the rendering has no map back to source lines.
  const followSource = () => {
    const source = sourceRef.current;
    const preview = previewRef.current;
    if (view !== 'split' || source === null || preview === null) {
      return;
    }
    const range = source.scrollHeight - source.clientHeight;
    preview.scrollTop =
      range > 0 ? (source.scrollTop / range) * (preview.scrollHeight - preview.clientHeight) : 0;
  };

  const editorBody = (
    <div
      ref={sourceRef}
      className={view === 'preview' ? 'file-editor-body is-hidden' : 'file-editor-body'}
      onScroll={followSource}
    >
      {/* No editor once a read failed: it would be the empty starting state wearing the name of
          a file that is not there, and saving it would write that file. The band is the notebook
          editor's, which says the same thing for the same reason. */}
      {error !== '' ? (
        <div className="z-notice z-notice-error" role="alert">
          <Icon name="circle-alert" size={14} />
          <p>
            <strong>This file could not be loaded.</strong> {error}
          </p>
        </div>
      ) : notText ? (
        <div className="z-notice">
          <p>
            <strong>{name} is not a text file.</strong> It is not opened in the editor, which would
            change its bytes on save.
          </p>
          <button
            type="button"
            className="z-button z-button-secondary z-notice-action"
            onClick={download}
          >
            Download
          </button>
        </div>
      ) : readCount === 0 ? null : (
        // Mounted only once the file is read, and afresh on each read: handed the text after
        // mounting, @uiw/react-codemirror records it as an edit, and Mod-z undoes it to a blank
        // editor. Hidden rather than unmounted in preview, which keeps its undo history. No onChange:
        // the wrapper turns the whole document into a string before every call to it.
        <CodeMirror
          key={readCount}
          value={initialText}
          theme={theme.codeMirror}
          minHeight="100%"
          width="100%"
          extensions={extensions}
          onCreateEditor={(editor) => {
            viewRef.current = editor;
          }}
          onUpdate={onUpdate}
          basicSetup={basicSetup}
        />
      )}
    </div>
  );

  return (
    <div className="tab-surface">
      <div className={props.data.active ? 'editor-pane' : 'editor-pane is-hidden'}>
        {/* Outside .file-editor-body, so it stays put while the file scrolls. */}
        <BreadCrumb path={path} />
        {markdown && hasText && (
          <div className="editor-strip">
            <span>{MARKDOWN_VIEWS.find((option) => option.view === view)?.label}</span>
            <span className="editor-strip-actions">
              {MARKDOWN_VIEWS.map((option) => (
                <IconButton
                  key={option.view}
                  icon={option.icon}
                  label={option.label}
                  pressed={view === option.view}
                  onClick={() => showView(option.view)}
                />
              ))}
            </span>
          </div>
        )}
        {markdown ? (
          <div className="markdown-panes">
            {editorBody}
            {view !== 'edit' && (
              <div ref={previewRef} className="markdown-preview">
                <Suspense
                  fallback={
                    <p className="z-note">
                      <span className="z-spinner" /> Loading preview…
                    </p>
                  }
                >
                  <MarkdownRenderer source={previewSource} />
                </Suspense>
              </div>
            )}
          </div>
        ) : (
          editorBody
        )}
      </div>
    </div>
  );
}
