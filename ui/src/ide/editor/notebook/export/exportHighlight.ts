import { HighlightStyle, LanguageDescription, LanguageSupport } from '@codemirror/language';
import { languages } from '@codemirror/language-data';
import { python } from '@codemirror/lang-python';
import { highlightCode } from '@lezer/highlight';
import { vscodeLightStyle } from '@uiw/codemirror-theme-vscode';

/*
Syntax highlighting for a code cell in an exported page.

The editor draws code with CodeMirror, which a static file cannot have: its highlighting is a set of
editor extensions, and its colours live in a StyleModule rather than in a stylesheet anything can read.
What a file *can* have is the same grammar and the same colours, run once at export time —
`@lezer/highlight`'s `highlightCode` walks a parsed tree and hands back spans, and a `HighlightStyle`
built from the same `vscodeLightStyle` the editor is given knows what colour each span is.

That is why nothing here names a colour: the export's code is the editor's code, generated from the one
array that already decides it. Always the light style, because an exported page is always light.
*/

const EXPORT_HIGHLIGHT = HighlightStyle.define(vscodeLightStyle);

/** The rules for the classes `highlightSource` emits, for the exported file's own `<style>`. */
export function highlightCss(): string {
  return EXPORT_HIGHLIGHT.module?.getRules() ?? '';
}

export function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

const PYTHON_PARSER = python().language.parser;

/**
 * The parser for a kernel language, or null when nothing claims it.
 *
 * Python is answered without a load because it is what most notebooks are and it is bundled anyway;
 * everything else comes from `@codemirror/language-data` on demand, which is the same table
 * `lazyLanguageNamed` in editor/language.ts uses — a language highlighted one way in a cell and
 * another way in the export of that cell would be two different answers to one question.
 */
async function parserFor(language: string) {
  const wanted = language.trim().toLowerCase();
  if (wanted === '' || wanted === 'python') {
    return PYTHON_PARSER;
  }

  const description = LanguageDescription.matchLanguageName(languages, wanted, true);
  if (description === null) {
    return null;
  }

  try {
    const support = await description.load();
    return support instanceof LanguageSupport ? support.language.parser : null;
  } catch {
    // A grammar that will not load is not worth failing an export over: the code goes in unhighlighted,
    // which is what the editor does for the same language.
    return null;
  }
}

/**
 * One cell's source as HTML. Highlighted when the language is known, escaped and nothing more when it
 * is not — either way the text is exactly what was in the cell.
 */
export async function highlightSource(source: string, language: string): Promise<string> {
  const parser = await parserFor(language);
  if (parser === null) {
    return escapeHtml(source);
  }

  let out = '';
  try {
    highlightCode(
      source,
      parser.parse(source),
      EXPORT_HIGHLIGHT,
      (text, classes) => {
        const escaped = escapeHtml(text);
        out += classes === '' ? escaped : `<span class="${classes}">${escaped}</span>`;
      },
      () => {
        out += '\n';
      }
    );
  } catch {
    // A parser that throws on a partial or malformed cell — which a notebook is full of — must not
    // take the export with it.
    return escapeHtml(source);
  }
  return out;
}
