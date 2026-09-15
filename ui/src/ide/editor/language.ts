import { LanguageDescription } from '@codemirror/language';
import { Extension } from '@codemirror/state';
import { go } from '@codemirror/lang-go';
import { html } from '@codemirror/lang-html';
import { javascript } from '@codemirror/lang-javascript';
import { json } from '@codemirror/lang-json';
import { less } from '@codemirror/lang-less';
import { markdown, markdownLanguage } from '@codemirror/lang-markdown';
import { python } from '@codemirror/lang-python';
import { sass } from '@codemirror/lang-sass';
import { languages } from '@codemirror/language-data';

/**
 * How a file extension is highlighted, or null for one nothing here knows.
 *
 * Shared by the editor and the diff, which have to agree: the same file highlighted one way in a tab
 * and another way beside it reads as two different files.
 */
export default function languageFor(extension: string | null): Extension | null {
  switch (extension?.toLowerCase()) {
    case 'go':
    case 'mod':
      return go();
    case 'py':
    case 'python':
    // A notebook diff is the source of its cells with `# %%` markers between them, which is Python
    // with comments in it.
    case 'ipynb':
      return python();
    case 'js':
      return javascript();
    case 'json':
      return json();
    case 'ts':
      return javascript({ jsx: false, typescript: true });
    case 'tsx':
      return javascript({ jsx: true, typescript: true });
    case 'jsx':
      return javascript({ jsx: false, typescript: false });
    case 'html':
      return html();
    case 'css':
      return less();
    case 'sass':
    case 'scss':
      return sass();
    case 'md':
    case 'markdown':
      return markdown({ base: markdownLanguage, codeLanguages: languages });
  }
  return null;
}

/** What the status bar and the language picker call a file nothing claims. */
export const PLAIN_TEXT = 'Plain Text';

/** What a file's language is called, by its name, or null when nothing claims it. */
export function languageNameFor(fileName: string): string | null {
  return LanguageDescription.matchFilename(languages, fileName)?.name ?? null;
}

export interface LanguageChoice {
  name: string;
  /** The extension it is usually written with, for telling two languages of one family apart. */
  extension: string;
}

/**
 * Every language a file can be read as, for the status bar's picker: the 180-odd
 * @codemirror/language-data knows, and plain text, which is the absence of all of them.
 *
 * Built once at module load from descriptions that are names and dynamic imports — the grammar itself
 * is not loaded until a language is actually chosen.
 */
export const LANGUAGE_CHOICES: LanguageChoice[] = [
  { name: PLAIN_TEXT, extension: '' },
  ...languages
    .map((description) => ({
      name: description.name,
      extension: description.extensions[0] === undefined ? '' : `.${description.extensions[0]}`,
    }))
    .sort((left, right) => left.name.localeCompare(right.name)),
];

/**
 * The highlighting @codemirror/language-data has for a file the table above does not bundle, matched by
 * its name or extension (`main.rs`, `Dockerfile`) and loaded on demand. Null when nothing claims the
 * file, which is shown as plain text.
 */
export function lazyLanguageFor(fileName: string): Promise<Extension> | null {
  const description = LanguageDescription.matchFilename(languages, fileName);
  return description === null ? null : description.load();
}

/** The same for a kernel's language name, such as `R` or `julia`, for a notebook's code cells. */
export function lazyLanguageNamed(name: string): Promise<Extension> | null {
  const description = LanguageDescription.matchLanguageName(languages, name, true);
  return description === null ? null : description.load();
}
