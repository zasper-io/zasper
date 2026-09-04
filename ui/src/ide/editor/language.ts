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
