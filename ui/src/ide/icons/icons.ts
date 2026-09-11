import {
  ArrowDown,
  ArrowRight,
  ArrowUp,
  BetweenHorizontalEnd,
  BetweenHorizontalStart,
  Check,
  ChevronDown,
  ChevronRight,
  ChevronUp,
  ChevronsUp,
  CircleAlert,
  CircleHelp,
  ClipboardPaste,
  CloudDownload,
  Copy,
  CornerDownLeft,
  Cpu,
  Download,
  Ellipsis,
  Eraser,
  Eye,
  EyeOff,
  FastForward,
  File,
  FileCode,
  FilePlus,
  Files,
  Folder,
  FolderOpen,
  FolderPlus,
  GitBranch,
  Image,
  Link,
  Lock,
  LogOut,
  Minus,
  NotebookPen,
  PanelLeft,
  Pause,
  Pencil,
  Play,
  PlugZap,
  Plus,
  Power,
  RefreshCw,
  RotateCw,
  Save,
  Scissors,
  ScrollText,
  Search,
  Settings,
  Square,
  Terminal,
  Trash2,
  Undo2,
  Upload,
  X,
  ZoomIn,
} from 'lucide-react';
import type { LucideIcon } from 'lucide-react';

/*
Every icon in the app, in one table, keyed by its Lucide name.

`Icon` is the only way one reaches the screen, so this object is the only place a glyph is chosen —
"which icon is Restart?" has one answer rather than one per component. The comment on each group says
what it took over from, because until this landed an icon was one of four things depending on where
it stood: a Font Awesome glyph (a *font*, so it took `color` and `font-size` and nothing else, 30
classes at 51 sites out of 232KB of webfont), an `<img>` from public/images/editor/ where nothing
agreed on a width and 21 of 30 files had a `fill` baked in that no theme could reach, an inline SVG
component in this directory, or a brand logo.

The keys are Lucide's own names and not roles ('square', not 'interrupt'). A role would read better
at the call site, but two roles that want the same glyph then quietly become two entries that can
drift apart — and the button around the icon already carries the words. The table came from
scripts/build-sprite.mjs in the design prototype, a separate repository, which is where the one-for-one
mapping was worked out.
*/
export const ICONS = {
  // --- The navigation rail and the launcher ---------------------------------
  // Seven inline SVG components used to live in this directory: 122 lines of path data at seven
  // different viewBoxes, from `0 0 16 16` to `0 0 55.437 55.437`.
  files: Files, // FileBrowserIcon
  'git-branch': GitBranch, // GitPanelIcon, and fa-code-branch in the status bar and git panel
  cpu: Cpu, // JupyterInfoPanelIcon
  settings: Settings, // SettingsPanelIcon
  'circle-help': CircleHelp, // HelpIcon
  terminal: Terminal, // TerminalIcon, on the launcher's terminal tile
  search: Search, // images/icons/search.svg
  'log-out': LogOut, // images/icons/logout.svg
  'panel-left': PanelLeft, // The topbar's sidebar toggle, as the prototype draws it

  // --- The file browser ----------------------------------------------------
  'file-plus': FilePlus, // images/editor/feather-file-plus.svg
  'folder-plus': FolderPlus, // images/editor/feather-folder-plus.svg
  'notebook-pen': NotebookPen, // images/editor/jupyter-icon.svg, on the New notebook button
  folder: Folder, // images/editor/directory.svg
  file: File, // images/editor/unknown-file-icon.svg — a file with no mark of its own
  image: Image, // images/editor/image-icon.svg
  upload: Upload, // fa-upload
  'refresh-cw': RefreshCw, // fa-sync
  'chevrons-up': ChevronsUp, // fa-angle-double-up
  eye: Eye, // fa-eye
  'eye-off': EyeOff, // fa-eye-slash
  lock: Lock, // fa-lock
  'chevron-right': ChevronRight, // fa-chevron-right
  'chevron-down': ChevronDown, // fa-chevron-down, and fa-forward on Select next cell
  pencil: Pencil, // Rename, in the file tree's context menu
  'folder-open': FolderOpen, // Open as Root, in a folder row's context menu
  link: Link, // Copy Path, in a row's context menu
  download: Download, // Download, in a file row's context menu

  // --- The notebook --------------------------------------------------------
  save: Save, // fa-save
  play: Play, // fa-play
  'fast-forward': FastForward, // fa-forward on Restart and run all
  square: Square, // fa-square, Interrupt
  'rotate-cw': RotateCw, // fa-redo, Restart
  'chevron-up': ChevronUp, // fa-backward, Select previous cell
  plus: Plus, // fa-plus
  minus: Minus, // fa-minus
  scissors: Scissors, // fa-cut
  copy: Copy, // fa-copy
  'clipboard-paste': ClipboardPaste, // fa-paste
  'trash-2': Trash2, // fa-trash
  'plug-zap': PlugZap, // images/editor/reconnect-icon.svg
  // The two cell-insert icons were hand-drawn SVGs with a mask, the only icons in the app that took
  // a `color` prop. Lucide's read as a row being inserted between two others, which is the action.
  'between-horizontal-start': BetweenHorizontalStart,
  'between-horizontal-end': BetweenHorizontalEnd,
  // The two output actions on a cell. An output area has a height cap on it (see `.inner-text` in
  // NotebookEditor.scss); the scroll icon is what lifts the cap, and the eraser throws the output
  // away, which is the other answer to a cell that printed more than anyone wants to scroll past.
  eraser: Eraser,
  'scroll-text': ScrollText,
  // A cell's own menu: the button that opens it, and the two rows that have no glyph anywhere else
  // in the app. `corner-down-left` is the shape of the Shift-Enter it stands for, and `file-code` is
  // the Code row of the cell-type group — `file` is Raw there and `pencil` is Markdown, both of which
  // the file tree already uses for the same two ideas.
  ellipsis: Ellipsis,
  'corner-down-left': CornerDownLeft,
  'file-code': FileCode,

  // --- Kernels -------------------------------------------------------------
  pause: Pause, // fa-pause, Interrupt on a kernel row
  power: Power, // fa-power-off, Shut down

  // --- Source control ------------------------------------------------------
  'cloud-download': CloudDownload, // fa-cloud-download-alt, Fetch
  'arrow-down': ArrowDown, // fa-arrow-down, Pull
  'arrow-up': ArrowUp, // fa-arrow-up, Push
  'arrow-right': ArrowRight, // fa-arrow-right, the direction of a diff
  'undo-2': Undo2, // fa-undo, Discard
  check: Check, // fa-check, and CheckmarkIcon

  // --- Everywhere ----------------------------------------------------------
  x: X, // fa-times-circle: close a tab, dismiss a dialog
  'zoom-in': ZoomIn, // The status bar's zoom control, whatever level it is showing
  // The one glyph in a `.z-notice-error`, which is where the app now says something failed.
  'circle-alert': CircleAlert,
} satisfies Record<string, LucideIcon>;

export type IconName = keyof typeof ICONS;
