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
import { go } from '@codemirror/lang-go';
import { keymap, ViewUpdate } from '@codemirror/view';
import { apiErrorMessage, downloadContent, getFileContent, logApiError, saveFile } from '@/api';
import { saveAs } from '@/browser';
import { Icon, IconName } from '@/ide/icons';
import IconButton from '@/ide/IconButton';
import { baseName } from '@/paths';

import { useAtom } from 'jotai';
import { useTheme } from '@/themes/useTheme';
import { columnPositionAtom, indentationSizeAtom, linePositionAtom } from '@/store/AppState';
import BreadCrumb from './BreadCrumb';
import languageFor from './language';
import { IfileTab } from '@/store/TabState';
import { useUnsavedChanges } from '@/store/UnsavedState';
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

interface FileEditorProps {
  data: IfileTab;
}

export default function FileEditor(props: FileEditorProps) {
  const [fileContents, setFileContents] = useState('');
  /** What the file held when it was last read or written. */
  const [savedContents, setSavedContents] = useState('');
  /** Why the file could not be read, when it could not be. */
  const [error, setError] = useState('');
  /** The server sent the file as base64: it is not UTF-8 text, and the editor would change its bytes. */
  const [notText, setNotText] = useState(false);
  /** Bumped on every successful read; 0 until the first one lands. */
  const [readCount, setReadCount] = useState(0);
  const [markdownView, setMarkdownView] = useState<MarkdownView>('edit');
  const theme = useTheme();
  const sourceRef = useRef<HTMLDivElement>(null);
  const previewRef = useRef<HTMLDivElement>(null);
  // Typing stays responsive in a long document: the rendering catches up between keystrokes.
  const previewSource = useDeferredValue(fileContents);

  const saveFileToDisk = useCallback(async () => {
    // The text that was written, not whatever the editor holds by the time the write returns: a
    // keystroke made in between leaves the file unsaved again.
    const written = fileContents;
    await saveFile(props.data.path, written);
    setSavedContents(written);
  }, [fileContents, props.data.path]);

  const handleCmdEnter = () => {
    // Nothing to save when the read failed: what the editor holds is the empty starting state, and
    // writing it would create the file the tab is only pointing at.
    if (error !== '' || notText) {
      return true;
    }
    saveFileToDisk().catch(logApiError('Error saving file:'));

    return true;
  };

  // Not registered while the read failed, for the same reason: the close prompt must not offer to
  // save a buffer that is not the file.
  useUnsavedChanges(
    props.data.path,
    error === '' && !notText && fileContents !== savedContents,
    saveFileToDisk
  );

  const customKeymap = keymap.of([
    {
      key: 'Mod-s',
      run: handleCmdEnter,
    },
  ]);

  // See tooltipParent.ts: a popup left to place itself draws at its own coordinate times the zoom.
  const popupPlacement = useMemo(() => zoomAwareTooltips(), []);

  const FetchFileData = async (path: string) => {
    try {
      const file = await getFileContent(path);
      const text = file.format === 'text' ? file.content : '';
      setNotText(file.format !== 'text');
      setFileContents(text);
      setSavedContents(text);
      setError('');
      setReadCount((count) => count + 1);
    } catch (failure) {
      // The file is gone, or was never there — a tab restored from a previous visit pointing at
      // something since deleted. Said out loud, because the alternative is an editor that looks like
      // an empty file and writes the deleted file back to disk on the first Mod-S.
      setError(apiErrorMessage(failure));
      setNotText(false);
      setFileContents('');
      setSavedContents('');
    }
  };

  const name = props.data.name || baseName(props.data.path);
  const download = () => {
    downloadContent(props.data.path)
      .then((blob) => saveAs(blob, name))
      .catch((failure: unknown) => setError(apiErrorMessage(failure)));
  };

  useEffect(() => {
    if (props.data.load_required === true) {
      void FetchFileData(props.data.path);
    }
  }, [props.data]);

  // Go for anything unrecognised, which is what this has always fallen back to.
  const getExtensionToLoad = () => languageFor(props.data.extension) ?? go();
  const [, setLinePosition] = useAtom(linePositionAtom);
  const [, setColumnPosition] = useAtom(columnPositionAtom);
  const [indentationSize] = useAtom(indentationSizeAtom);

  const onUpdate = useCallback(
    (viewUpdate: ViewUpdate) => {
      if (viewUpdate) {
        const { state } = viewUpdate;
        const position = state.selection.main.head;

        // Get the line and column based on the absolute position
        const line = state.doc.lineAt(position); // Get the line info for the cursor position
        const column = position - line.from; // Calculate the column as an offset from line start
        setLinePosition(line.number);
        setColumnPosition(column);
      }
    },
    [setColumnPosition, setLinePosition]
  );

  const markdown = isMarkdown(props.data.extension);
  // A failed read has no text to render, so it keeps the notice in view.
  const hasText = error === '' && !notText;
  const view: MarkdownView = markdown && hasText ? markdownView : 'edit';

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
        // editor. Hidden rather than unmounted in preview, which keeps its undo history.
        <CodeMirror
          key={readCount}
          value={fileContents}
          theme={theme.codeMirror}
          minHeight="100%"
          width="100%"
          extensions={[getExtensionToLoad(), popupPlacement, customKeymap]}
          // , linter(jsonParseLinter())
          // linter(esLint(new eslint.Linter(), config)),
          onChange={(fileContents) => {
            setFileContents(fileContents);
          }}
          onUpdate={onUpdate}
          basicSetup={{
            bracketMatching: true,
            highlightActiveLineGutter: true,
            autocompletion: true,
            lintKeymap: true,
            foldGutter: true,
            completionKeymap: true,
            tabSize: indentationSize,
          }}
        />
      )}
    </div>
  );

  return (
    <div className="tab-surface">
      <div className={props.data.active ? 'editor-pane' : 'editor-pane is-hidden'}>
        {/* Outside .file-editor-body, so it stays put while the file scrolls. */}
        <BreadCrumb path={props.data.path} />
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
                  onClick={() => setMarkdownView(option.view)}
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
