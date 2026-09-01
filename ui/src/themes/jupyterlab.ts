// Syntax highlighting for the JupyterLab theme.
//
// The colours are JupyterLab's own `--jp-mirror-editor-*` variables, which it
// inherited from CodeMirror 5's `codemirror/lib/codemirror.css` defaults. Two are
// nudged darker for legibility (noted inline); the rest are verbatim, so code
// reads the way it does in JupyterLab.
//
// Unlike the token layer in styles/_tokens.scss, this palette is not held to a
// 4.5:1 floor — several of JupyterLab's values land between 3.5:1 and 4.5:1 on
// the cell background, as do the vscodeLight/vscodeDark themes the other two
// themes use. Nothing here drops below 3:1.

import { createTheme } from '@uiw/codemirror-themes';
import { tags } from '@lezer/highlight';
import type { Extension } from '@codemirror/state';

// JupyterLab's --jp-mirror-editor-* palette.
const KEYWORD = '#008000';
const ATOM = '#6666e0'; // --jp-mirror-editor-atom-color is #88f, 2.80:1 on the cell background
const NUMBER = '#008000';
const DEF = '#0000ff';
const VARIABLE = '#212121';
const VARIABLE_2 = '#0055aa';
const PROPERTY = '#0055aa';
const OPERATOR = '#aa22ff';
const COMMENT = '#408080';
const STRING = '#ba2121';
const STRING_2 = '#770088';
const META = '#aa22ff';
const BUILTIN = '#008000';
const BRACKET = '#7f7f33'; // --jp-mirror-editor-bracket-color is #997, 2.73:1
const TAG = '#117700';
const ATTRIBUTE = '#0000cc';
const HEADER = '#0000ff';
const QUOTE = '#009900';
const ERROR = '#ff0000';

export const jupyterLabHighlight: Extension = createTheme({
  theme: 'light',
  settings: {
    // Transparent so the surrounding surface shows through: --z-bg-editor (white)
    // in the file editor, --z-bg-cell (#f7f7f7) in a notebook cell. Baking a
    // colour in here would override one of them.
    background: 'transparent',
    gutterBackground: 'transparent',
    gutterBorder: 'transparent',
    foreground: VARIABLE,
    caret: VARIABLE,
    // --jp-editor-selected-focused-background / --jp-editor-selected-background.
    selection: '#d7d4f0',
    selectionMatch: '#e0e0e0',
    lineHighlight: 'rgba(33, 150, 243, 0.07)',
    gutterForeground: '#757575',
  },
  styles: [
    { tag: [tags.keyword, tags.modifier, tags.self], color: KEYWORD, fontWeight: 'bold' },
    { tag: [tags.atom, tags.bool, tags.null], color: ATOM },
    { tag: [tags.number, tags.integer, tags.float], color: NUMBER },
    { tag: [tags.definition(tags.variableName), tags.className, tags.typeName], color: DEF },
    { tag: tags.function(tags.variableName), color: DEF },
    { tag: tags.variableName, color: VARIABLE },
    { tag: [tags.special(tags.variableName), tags.namespace], color: VARIABLE_2 },
    { tag: [tags.propertyName, tags.punctuation, tags.separator], color: PROPERTY },
    { tag: [tags.operator, tags.operatorKeyword], color: OPERATOR, fontWeight: 'bold' },
    { tag: [tags.comment, tags.lineComment, tags.blockComment], color: COMMENT, fontStyle: 'italic' },
    { tag: [tags.string, tags.character, tags.docString], color: STRING },
    { tag: [tags.special(tags.string), tags.regexp, tags.escape], color: STRING_2 },
    { tag: [tags.meta, tags.processingInstruction], color: META },
    { tag: [tags.standard(tags.variableName), tags.macroName], color: BUILTIN },
    { tag: [tags.bracket, tags.paren, tags.squareBracket, tags.brace], color: BRACKET },
    { tag: [tags.tagName], color: TAG },
    { tag: [tags.attributeName], color: ATTRIBUTE },
    { tag: [tags.heading], color: HEADER, fontWeight: 'bold' },
    { tag: [tags.quote], color: QUOTE },
    { tag: [tags.link], color: ATTRIBUTE, textDecoration: 'underline' },
    { tag: [tags.invalid], color: ERROR },
  ],
});
