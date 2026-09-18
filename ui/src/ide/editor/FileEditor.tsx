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
import { findNext, findPrevious, search, selectNextOccurrence } from '@codemirror/search';
import { Extension, Text, Transaction } from '@codemirror/state';
import { EditorView, keymap, scrollPastEnd, ViewUpdate } from '@codemirror/view';
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
import { formatDocumentNow } from '@/lsp/formatting';
import { inlayHints } from '@/lsp/inlayHints';
import { serverLanguageFor } from '@/lsp/languages';
import { languageServerExtension } from '@/lsp/servers';
import { registerEditorView } from '@/lsp/views';
import { editorPulseAtom, goToLineAtom } from '@/store/editorRequests';
import { revealPositionAtom } from '@/store/languageServers';
import { OpenDocument, useOpenDocument } from '@/store/openDocuments';
import { revealMatchAtom } from '@/store/projectSearch';
import {
  chosenLanguagesAtom,
  columnPositionAtom,
  fileFormatsAtom,
  LineEnding,
  linePositionAtom,
} from '@/store/editorStatus';
import { projectDirAtom } from '@/store/serverInfo';
import { editorSettingsAtom } from '@/store/settings';
import { FileTab } from '@/store/tabState';
import { useUnsavedChanges } from '@/store/unsavedState';
import { useTheme } from '@/themes/useTheme';

import BreadCrumb from './BreadCrumb';
import DiskChangeBand from './DiskChangeBand';
import FindCard, { FindToggles } from './FindCard';
import { findHighlighter } from './findHighlight';
import { lineEditChanges } from './lineEdits';
import { useDocumentSymbols } from './useDocumentSymbols';
import { useEditorCommands } from './editorCommands';
import { useSymbolActions } from './useSymbolActions';
import { editorExtensions } from './editorExtensions';
import { lazyKeymap } from './keymaps';
import { detectLineEnding, formatFor, indentationOf, saveRulesOf, tidyChanges } from './fileFormat';
import languageFor, { lazyLanguageFor, lazyLanguageNamed, PLAIN_TEXT } from './language';
import { changeBetween } from './textChange';
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
  /** Whether the find card is up, what its field starts with, and which ⌘F asked for the focus. */
  const [finding, setFinding] = useState(false);
  const [findSeed, setFindSeed] = useState('');
  const [findFocus, setFindFocus] = useState(0);
  const [findSeedOptions, setFindSeedOptions] = useState<FindToggles | null>(null);
  const [findTakesFocus, setFindTakesFocus] = useState(true);
  /** Bumped when CodeMirror hands over a view, which is after the read that remounted it has rendered. */
  const [viewCount, setViewCount] = useState(0);
  const theme = useTheme();
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
    if (settingsRef.current.format_on_save) {
      // A server that cannot format, or does not answer, is not a reason to refuse a save.
      await formatDocumentNow(editor, {
        tabSize: settingsRef.current.tab_size,
        insertSpaces: !settingsRef.current.indent_with_tabs,
      }).catch(() => {});
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

  // A project replace carries out its edits here while the file is open, so the editor's undo takes
  // them back, rather than writing to disk under it.
  const openDoc = useMemo<OpenDocument | null>(
    () =>
      canSave
        ? {
            text: () => viewRef.current?.state.doc.toString() ?? '',
            applyEdits: (edits) => {
              const editor = viewRef.current;
              if (editor === null) {
                return { applied: 0, stale: edits.length };
              }
              const { changes, stale } = lineEditChanges(editor.state.doc, edits);
              if (changes.length > 0) {
                editor.dispatch({ changes });
              }
              return { applied: changes.length, stale };
            },
          }
        : null,
    [canSave]
  );
  useOpenDocument(path, openDoc);

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

  /** ⌘F: the card, with the selection in its field — which is how a reader looks for what they just read. */
  const openFind = useRef(() => {});
  openFind.current = () => {
    const editor = viewRef.current;
    if (editor === null) {
      return;
    }
    const { from, to } = editor.state.selection.main;
    const selected = from === to ? '' : editor.state.sliceDoc(from, to);
    // A selection spanning lines is a block of text rather than something to look for.
    if (selected !== '' && !selected.includes('\n')) {
      setFindSeed(selected);
    }
    setFindSeedOptions(null);
    setFindTakesFocus(true);
    setFinding(true);
    setFindFocus((count) => count + 1);
  };
  const closeFind = useRef(() => {});
  closeFind.current = () => {
    setFinding(false);
    setFindSeed('');
    viewRef.current?.focus();
  };
  const findingRef = useRef(false);
  findingRef.current = finding;

  /**
   * The search keys, ours because the basic setup's are left out: its `Mod-f` opens CodeMirror's own
   * panel, and `Mod-Alt-g` opens its go-to-line panel, which the palette answered in story 14. What is
   * kept is everything that does not draw anything — stepping between matches, and multiple cursors.
   */
  const findKeymap = useMemo(
    () =>
      keymap.of([
        {
          key: 'Mod-f',
          run: () => {
            openFind.current();
            return true;
          },
        },
        {
          key: 'Escape',
          run: () => {
            if (!findingRef.current) {
              return false;
            }
            closeFind.current();
            return true;
          },
        },
        { key: 'Mod-g', run: findNext, shift: findPrevious, preventDefault: true },
        { key: 'F3', run: findNext, shift: findPrevious, preventDefault: true },
        { key: 'Mod-d', run: selectNextOccurrence, preventDefault: true },
      ]),
    []
  );

  // The search state the commands and the card both act through, and the marks over it: the library's
  // own highlighter draws nothing while its panel is closed, and ours never opens.
  const searchExtension = useMemo(() => [search(), findHighlighter], []);

  // The file's language server, when Zasper knows one for its language (story 19).
  const projectDir = useAtomValue(projectDirAtom);
  const serverExtension = useMemo(
    () => languageServerExtension(projectDir, path, name),
    [projectDir, path, name]
  );
  // So a jump from another file to a definition in this one can wait for this editor to exist.
  useEffect(() => () => registerEditorView(path, null), [path]);

  // Stable, because an extension built from it is part of the editor's configuration: a new function
  // every render is a new extension every render, and reconfiguring an editor throws away state that was
  // added to it since — the diagnostics among it.
  const currentView = useCallback(() => viewRef.current, []);

  // Rename, quick fixes and the gutter they share with the problems (story 20). The gutter is added only
  // for a file some server serves, so a plain text file keeps its own left edge.
  const symbols = useSymbolActions({ path, name, view: currentView });
  const served = useMemo(() => serverLanguageFor(name) !== null, [name]);

  // What the file declares, for the last crumbs of the bar above it (story 20).
  const outline = useDocumentSymbols({
    name,
    view: currentView,
    served,
    readCount,
    viewCount,
  });

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

  // A line asked for in the palette, which only the tab in front can carry out. The request is cleared
  // as it is taken, so asking for the same line twice is two moves.
  const goToLine = useAtomValue(goToLineAtom);
  const setGoToLine = useSetAtom(goToLineAtom);
  useEffect(() => {
    const editor = viewRef.current;
    if (goToLine === null || editor === null || !props.data.active) {
      return;
    }
    setGoToLine(null);
    // Clamped rather than refused: `:900` in a 40-line file means the end of it.
    const line = editor.state.doc.line(Math.min(goToLine, editor.state.doc.lines));
    editor.dispatch({ selection: { anchor: line.from }, scrollIntoView: true });
    editor.focus();
  }, [goToLine, props.data.active, setGoToLine]);

  // A problem pressed in the Problems panel: the cursor where the server put it.
  const revealPosition = useAtomValue(revealPositionAtom);
  const setRevealPosition = useSetAtom(revealPositionAtom);
  useEffect(() => {
    const editor = viewRef.current;
    if (
      revealPosition === null ||
      revealPosition.path !== path ||
      editor === null ||
      readCount === 0
    ) {
      return;
    }
    setRevealPosition(null);
    const doc = editor.state.doc;
    const line = doc.line(Math.min(revealPosition.line + 1, doc.lines));
    editor.dispatch({
      selection: { anchor: Math.min(line.from + revealPosition.character, line.to) },
      scrollIntoView: true,
    });
    editor.focus();
  }, [revealPosition, path, readCount, viewCount, setRevealPosition]);

  // A match pressed in the search panel: the cursor on it, and the find card searching for what the panel
  // searched for, so ⌘G carries on from there. Taken once the file has been read.
  const reveal = useAtomValue(revealMatchAtom);
  const setReveal = useSetAtom(revealMatchAtom);
  useEffect(() => {
    const editor = viewRef.current;
    if (reveal === null || reveal.path !== path || editor === null || readCount === 0) {
      return;
    }
    setReveal(null);
    const doc = editor.state.doc;
    const line = doc.line(Math.min(reveal.line, doc.lines));
    setFindSeed(reveal.search);
    setFindSeedOptions({
      caseSensitive: reveal.caseSensitive,
      wholeWord: reveal.wholeWord,
      regexp: reveal.regexp,
    });
    setFindTakesFocus(false);
    setFinding(true);
    setFindFocus((count) => count + 1);
    editor.dispatch({
      selection: {
        anchor: Math.min(line.from + reveal.from, line.to),
        head: Math.min(line.from + reveal.to, line.to),
      },
      scrollIntoView: true,
    });
    editor.focus();
  }, [reveal, path, readCount, viewCount, setReveal]);

  /**
   * How the file is highlighted: the language a reader chose for it, then the table the app bundles,
   * then whatever @codemirror/language-data claims the file by name — and plain text when nothing does.
   * Plain text is a choice of its own, for a file some extension claims wrongly.
   */
  const chosen = useAtomValue(chosenLanguagesAtom)[path];
  const bundledLanguage = useMemo(
    () => (chosen === undefined ? languageFor(props.data.extension) : null),
    [chosen, props.data.extension]
  );
  const [loadedLanguage, setLoadedLanguage] = useState<{ key: string; language: Extension }>();
  useEffect(() => {
    if (bundledLanguage !== null) {
      return;
    }
    const loading =
      chosen === undefined
        ? lazyLanguageFor(name)
        : chosen === PLAIN_TEXT
          ? null
          : lazyLanguageNamed(chosen);
    if (loading === null) {
      return;
    }
    // What was loaded, so a language that arrives after another was chosen is not drawn.
    const key = chosen ?? name;
    let live = true;
    loading
      .then((language) => {
        if (live) {
          setLoadedLanguage({ key, language });
        }
      })
      .catch((failure: unknown) =>
        console.error(`Could not load highlighting for ${key}:`, failure)
      );
    return () => {
      live = false;
    };
  }, [bundledLanguage, chosen, name]);
  const language =
    bundledLanguage ?? (loadedLanguage?.key === (chosen ?? name) ? loadedLanguage.language : null);

  // The chosen bindings, which arrive after the editor does; until then it takes CodeMirror's own.
  const [loadedKeymap, setLoadedKeymap] = useState<{ name: string; extension: Extension }>();
  useEffect(() => {
    const loading = lazyKeymap(settings.keymap);
    if (loading === null) {
      setLoadedKeymap(undefined);
      return;
    }
    let live = true;
    loading
      .then((extension) => {
        if (live) {
          setLoadedKeymap({ name: settings.keymap, extension });
        }
      })
      .catch((failure: unknown) =>
        console.error(`Could not load the ${settings.keymap} keymap:`, failure)
      );
    return () => {
      live = false;
    };
  }, [settings.keymap]);
  const keymapExtension = loadedKeymap?.name === settings.keymap ? loadedKeymap.extension : null;

  const { indentWithTabs, tabSize } = indentationOf(format, settings);
  const settingsExtension = useMemo(
    () => editorExtensions(settings, { indentWithTabs, tabSize }),
    [settings, indentWithTabs, tabSize]
  );

  const extensions = useMemo(
    () => [
      ...(language === null ? [] : [language]),
      ...(keymapExtension === null ? [] : [keymapExtension]),
      settingsExtension,
      // The last line can be scrolled to the top, as the body's 500px of padding once allowed.
      scrollPastEnd(),
      popupPlacement,
      searchExtension,
      findKeymap,
      saveKeymap,
      serverExtension,
      ...(served ? [symbols.extension] : []),
      // Off by default, and asked for only where there is a server to ask (story 20).
      ...(served && settings.inlay_hints ? [inlayHints()] : []),
    ],
    [
      serverExtension,
      served,
      settings.inlay_hints,
      symbols.extension,
      language,
      keymapExtension,
      settingsExtension,
      popupPlacement,
      searchExtension,
      findKeymap,
      saveKeymap,
    ]
  );

  // Setters only: reading these atoms would render the whole editor again on every cursor move.
  const setLinePosition = useSetAtom(linePositionAtom);
  const setColumnPosition = useSetAtom(columnPositionAtom);
  const setPulse = useSetAtom(editorPulseAtom);
  const lineNumbers = settings.line_numbers;
  // No tabSize here: the basic setup would turn it into an indent of spaces that outranks the file's.
  // No searchKeymap either: `Mod-f` there opens CodeMirror's own panel, and ours is above.
  const basicSetup = useMemo(
    () => ({
      lineNumbers,
      searchKeymap: false,
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
      // Said once per update, for the find card's count; nothing here reads it.
      setPulse((count) => count + 1);

      // Whether the line the cursor is on has a fix to offer, which the gutter's lamp says, and which
      // symbol the cursor is in, which the breadcrumb bar says.
      if (served && (update.docChanged || update.selectionSet)) {
        symbols.askAboutLine();
        outline.onCursor(line.number, update.docChanged);
      }

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
    [setColumnPosition, setLinePosition, setPulse, isDirty, served, symbols, outline]
  );

  // Only the tab in front, so a chord or a palette entry cannot reach a file nobody is looking at.
  useRegisterCommands(
    useEditorCommands(currentView, {
      path,
      name,
      startRename: symbols.startRename,
      showQuickFix: symbols.showQuickFix,
    }),
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

  // By proportion: the rendering has no map back to source lines. Off CodeMirror's own scroller, which
  // is the one that moves, and whose scroll event does not bubble to React.
  useEffect(() => {
    const source = viewRef.current?.scrollDOM;
    const preview = previewRef.current;
    if (view !== 'split' || source === undefined || preview === null) {
      return;
    }
    const follow = () => {
      const range = source.scrollHeight - source.clientHeight;
      preview.scrollTop =
        range > 0 ? (source.scrollTop / range) * (preview.scrollHeight - preview.clientHeight) : 0;
    };
    source.addEventListener('scroll', follow, { passive: true });
    return () => source.removeEventListener('scroll', follow);
  }, [view, viewCount]);

  const editorBody = (
    <div className={view === 'preview' ? 'file-editor-body is-hidden' : 'file-editor-body'}>
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
          className="file-editor-codemirror"
          height="100%"
          width="100%"
          extensions={extensions}
          onCreateEditor={(editor) => {
            viewRef.current = editor;
            registerEditorView(path, editor);
            setViewCount((count) => count + 1);
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
        <BreadCrumb
          path={path}
          trail={outline.trail}
          symbols={outline.symbols}
          onGoTo={(line, character) => {
            const editor = viewRef.current;
            if (editor === null) {
              return;
            }
            const at = editor.state.doc.line(Math.min(line + 1, editor.state.doc.lines));
            editor.dispatch({
              selection: { anchor: Math.min(at.from + character, at.to) },
              scrollIntoView: true,
            });
            editor.focus();
          }}
        />
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
        <div className="file-editor-area" ref={symbols.area}>
          {/* Over the name being renamed, and at the cursor for a fix (story 20). */}
          {symbols.overlays}
          {/* Over the code at the top right, so opening it moves nothing in the file. */}
          {finding && viewRef.current !== null && (
            <FindCard
              view={viewRef.current}
              seed={findSeed}
              focusRequest={findFocus}
              seedOptions={findSeedOptions}
              takeFocus={findTakesFocus}
              onClose={() => closeFind.current()}
            />
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
    </div>
  );
}
