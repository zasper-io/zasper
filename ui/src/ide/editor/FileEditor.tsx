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
import { selectAtom } from 'jotai/utils';

import {
  apiErrorMessage,
  downloadContent,
  EditorConfig,
  getEditorConfig,
  getFileContent,
  logApiError,
  saveFile,
} from '@/api';
import { saveAs } from '@/browser';
import { Icon, IconName } from '@/ide/icons';
import IconButton from '@/ide/IconButton';
import { useRegisterCommands } from '@/commands/registry';
import { useContentWatcher } from '@/ide/useContentWatcher';
import { baseName } from '@/paths';
import { diskComparesAtom, diskResolutionsAtom } from '@/store/diskChanges';
import {
  columnPositionAtom,
  fileFormatsAtom,
  LineEnding,
  linePositionAtom,
} from '@/store/editorStatus';
import { editorSettingsAtom } from '@/store/settings';
import { FileTab } from '@/store/tabState';
import { useUnsavedChanges } from '@/store/unsavedState';
import { useTheme } from '@/themes/useTheme';

import BreadCrumb from './BreadCrumb';
import DiskChangeBand from './DiskChangeBand';
import { useEditorCommands } from './editorCommands';
import { editorExtensions } from './editorExtensions';
import { detectLineEnding, formatFor, indentationOf, saveRulesOf, tidyChanges } from './fileFormat';
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

/** How long after the last keystroke an autosave writes. */
const AUTO_SAVE_DELAY = 1000;

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

function without<T>(record: Record<string, T>, key: string): Record<string, T> {
  if (!(key in record)) {
    return record;
  }
  const next = { ...record };
  delete next[key];
  return next;
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
  /**
   * The file as it now is on disk, while that differs from both the version last read or written and
   * the editor's unsaved text, and the reader has not yet said which to keep.
   */
  const [conflict, setConflict] = useState<string | null>(null);
  const theme = useTheme();
  const sourceRef = useRef<HTMLDivElement>(null);
  const previewRef = useRef<HTMLDivElement>(null);
  const viewRef = useRef<EditorView | null>(null);
  /**
   * The document as it was last read or written. Unsaved means the editor's differs from it — asked of
   * CodeMirror's own document rather than of a copy of it made on every keystroke.
   */
  const savedDoc = useRef(Text.empty);
  /** The last version seen on disk, so a change already answered is not asked about again. */
  const diskDoc = useRef(Text.empty);
  /** A change on disk reported while this tab was in the background, to be looked at once it is not. */
  const changedWhileHidden = useRef(false);
  // Typing stays responsive in a long document: the rendering catches up between keystrokes.
  const previewSource = useDeferredValue(previewText);

  const settings = useAtomValue(editorSettingsAtom);
  // Read when the file is, without making the read depend on the settings.
  const settingsRef = useRef(settings);
  settingsRef.current = settings;
  const formatAtom = useMemo(() => selectAtom(fileFormatsAtom, (formats) => formats[path]), [path]);
  const format = useAtomValue(formatAtom);
  const setFormats = useSetAtom(fileFormatsAtom);
  const setCompares = useSetAtom(diskComparesAtom);
  const resolutionAtom = useMemo(
    () => selectAtom(diskResolutionsAtom, (resolutions) => resolutions[path]),
    [path]
  );
  const resolution = useAtomValue(resolutionAtom);
  const setResolutions = useSetAtom(diskResolutionsAtom);

  const eol: LineEnding = format?.eol ?? 'LF';
  const eolRef = useRef(eol);
  eolRef.current = eol;
  /** The line endings the file had when it was last read or written. */
  const savedEol = useRef<LineEnding>('LF');
  /** What a save does to this file's whitespace, read when the save happens rather than when it renders. */
  const saveRules = useRef(saveRulesOf(format, settings));
  saveRules.current = saveRulesOf(format, settings);
  /** Whether a change should start the autosave timer: off while the band is up, which a save would answer. */
  const autoSaving = useRef(false);
  autoSaving.current = settings.auto_save && conflict === null;
  const autoSaveTimer = useRef<number | undefined>(undefined);

  const hasText = error === '' && !notText;
  const markdown = isMarkdown(props.data.extension);
  const view: MarkdownView = markdown && hasText ? markdownView : 'edit';
  const previewing = useRef(false);
  previewing.current = view !== 'edit';

  // Line endings changed from the status bar are an unsaved change too.
  const isDirty = useCallback(
    (doc: Text) => !doc.eq(savedDoc.current) || eolRef.current !== savedEol.current,
    []
  );

  const saveFileToDisk = useCallback(async () => {
    const editor = viewRef.current;
    if (editor === null) {
      return;
    }
    // Applied to the document rather than to the text being written, so what the editor holds is what
    // went to disk and the file is not left looking unsaved by its own save.
    const tidy = tidyChanges(editor.state.doc, saveRules.current);
    if (tidy.length > 0) {
      editor.dispatch({ changes: tidy });
    }
    // The document that was written, not whatever the editor holds by the time the write returns: a
    // keystroke made in between leaves the file unsaved again.
    const written = editor.state.doc;
    const writtenEol = eolRef.current;
    await saveFile(
      path,
      written.sliceString(0, written.length, writtenEol === 'CRLF' ? '\r\n' : '\n')
    );
    savedDoc.current = written;
    diskDoc.current = written;
    savedEol.current = writtenEol;
    // A save made while the band is up keeps the reader's version.
    setConflict(null);
    setDirty(isDirty(editor.state.doc));
  }, [path, isDirty]);

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

  /** The file's line endings as they are on disk now, for a version of it the editor has taken. */
  const adoptLineEnding = useCallback(
    (text: string) => {
      const found = detectLineEnding(text);
      if (found === null || found === savedEol.current) {
        return;
      }
      savedEol.current = found;
      setFormats((formats) =>
        formats[path] === undefined
          ? formats
          : { ...formats, [path]: { ...formats[path], eol: found } }
      );
    },
    [path, setFormats]
  );

  const read = useCallback(async () => {
    try {
      // A server from before .editorconfig was read has no answer, and the file opens without one.
      const [file, editorConfig] = await Promise.all([
        getFileContent(path),
        getEditorConfig(path).catch((): EditorConfig => ({})),
      ]);
      const text = file.format === 'text' ? file.content : '';
      setNotText(file.format !== 'text');
      savedDoc.current = documentOf(text);
      diskDoc.current = savedDoc.current;
      if (file.format === 'text') {
        const opened = formatFor(text, settingsRef.current, editorConfig);
        savedEol.current = opened.eol;
        setFormats((formats) => ({ ...formats, [path]: opened }));
      } else {
        setFormats((formats) => without(formats, path));
      }
      setInitialText(text);
      setPreviewText(text);
      setDirty(false);
      setConflict(null);
      setError('');
      setReadCount((count) => count + 1);
    } catch (failure) {
      // The file is gone, or was never there — a tab restored from a previous visit pointing at
      // something since deleted. Said out loud, because the alternative is an editor that looks like
      // an empty file and writes the deleted file back to disk on the first Mod-S.
      setError(apiErrorMessage(failure));
      setNotText(false);
      setInitialText('');
      setFormats((formats) => without(formats, path));
    }
  }, [path, setFormats]);

  useEffect(() => {
    if (props.data.load_required === true) {
      void read();
    }
  }, [props.data, read]);

  useEffect(() => () => window.clearTimeout(autoSaveTimer.current), []);

  // The status bar and the comparison tab show this file only while it is open.
  useEffect(
    () => () => {
      setFormats((formats) => without(formats, path));
      setCompares((compares) => without(compares, path));
      setResolutions((resolutions) => without(resolutions, path));
    },
    [path, setFormats, setCompares, setResolutions]
  );

  useEffect(() => {
    const editor = viewRef.current;
    if (editor !== null) {
      setDirty(isDirty(editor.state.doc));
    }
  }, [eol, isDirty]);

  /**
   * Looks at a change made to the file on disk — a `git checkout`, a formatter, another editor.
   *
   * With nothing unsaved it is taken in, as an edit between the common start and end of the two versions
   * so the cursor stays where it was, and kept out of the undo history, which would otherwise step back
   * to what the file no longer says. With unsaved edits the reader is asked, in the band.
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
    if (onDisk.eq(diskDoc.current)) {
      return;
    }
    diskDoc.current = onDisk;
    const doc = editor.state.doc;

    if (!isDirty(doc)) {
      savedDoc.current = onDisk;
      adoptLineEnding(file.content);
      setConflict(null);
      editor.dispatch({
        changes: changeBetween(doc.toString(), onDisk.toString()),
        annotations: Transaction.addToHistory.of(false),
      });
      return;
    }
    // Someone wrote what the editor already holds: nothing is left to choose between.
    if (doc.eq(onDisk)) {
      savedDoc.current = onDisk;
      setConflict(null);
      setDirty(isDirty(doc));
      return;
    }
    setConflict(file.content);
  }, [path, isDirty, adoptLineEnding]);

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

  // The band comes down and the editor stays unsaved, so the next save writes it.
  const keepMine = useCallback(() => setConflict(null), []);

  // An edit like any other, so undo brings the reader's version back.
  const takeTheirs = useCallback(() => {
    const editor = viewRef.current;
    if (editor === null || conflict === null) {
      return;
    }
    const theirs = documentOf(conflict);
    savedDoc.current = theirs;
    adoptLineEnding(conflict);
    setConflict(null);
    editor.dispatch({ changes: changeBetween(editor.state.doc.toString(), theirs.toString()) });
  }, [conflict, adoptLineEnding]);

  const compareWithDisk = () => {
    const editor = viewRef.current;
    if (editor !== null && conflict !== null) {
      const mine = editor.state.doc.toString();
      setCompares((compares) => ({ ...compares, [path]: { onDisk: conflict, mine } }));
    }
  };

  useEffect(() => {
    if (conflict === null) {
      setCompares((compares) => without(compares, path));
    }
  }, [conflict, path, setCompares]);

  // An answer given in the comparison tab.
  useEffect(() => {
    if (resolution === undefined) {
      return;
    }
    setResolutions((resolutions) => without(resolutions, path));
    if (resolution === 'mine') {
      keepMine();
    } else {
      takeTheirs();
    }
  }, [resolution, path, keepMine, takeTheirs, setResolutions]);

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

  const { indentWithTabs, tabSize } = indentationOf(format, settings);
  const settingsExtension = useMemo(
    () => editorExtensions(settings, { indentWithTabs, tabSize }),
    [settings, indentWithTabs, tabSize]
  );

  const extensions = useMemo(
    () => [...(language === null ? [] : [language]), settingsExtension, popupPlacement, saveKeymap],
    [language, settingsExtension, popupPlacement, saveKeymap]
  );

  // Setters only: reading these atoms would render the whole editor again on every cursor move.
  const setLinePosition = useSetAtom(linePositionAtom);
  const setColumnPosition = useSetAtom(columnPositionAtom);
  const lineNumbers = settings.line_numbers;
  // No tabSize here: the basic setup would turn it into an indent of spaces that outranks the file's.
  const basicSetup = useMemo(
    () => ({
      lineNumbers,
      bracketMatching: true,
      highlightActiveLineGutter: true,
      autocompletion: true,
      lintKeymap: true,
      foldGutter: true,
      completionKeymap: true,
    }),
    [lineNumbers]
  );

  const onUpdate = useCallback(
    (update: ViewUpdate) => {
      const { state } = update;
      const position = state.selection.main.head;
      const line = state.doc.lineAt(position);
      setLinePosition(line.number);
      setColumnPosition(position - line.from);

      if (update.docChanged) {
        setDirty(isDirty(state.doc));
        if (previewing.current) {
          setPreviewText(state.doc.toString());
        }
        if (autoSaving.current) {
          // Restarted on every change, so the write lands in a pause rather than mid-word. Not React
          // state: the editor deliberately does not render on a keystroke.
          window.clearTimeout(autoSaveTimer.current);
          autoSaveTimer.current = window.setTimeout(() => {
            if (autoSaving.current) {
              save.current();
            }
          }, AUTO_SAVE_DELAY);
        }
      }
    },
    [setColumnPosition, setLinePosition, isDirty]
  );

  // Only the tab in front, so a chord or a palette entry cannot reach a file nobody is looking at.
  useRegisterCommands(
    useEditorCommands(() => viewRef.current),
    props.data.active && canSave
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
        {conflict !== null && (
          <DiskChangeBand
            path={path}
            name={name}
            onCompare={compareWithDisk}
            onKeepMine={keepMine}
            onTakeTheirs={takeTheirs}
          />
        )}
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
