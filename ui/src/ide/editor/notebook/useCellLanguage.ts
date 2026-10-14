import { useEffect, useState } from 'react';
import { LanguageDescription } from '@codemirror/language';
import { languages } from '@codemirror/language-data';
import { python } from '@codemirror/lang-python';
import { Extension } from '@codemirror/state';

import { lazyLanguageNamed } from '../language';

const PYTHON = python();

// CodeMirror 5 mode MIME types, which a kernel's `codemirror_mode` can be, by the language they are.
const MODE_MIMES: Record<string, string> = {
  'text/x-c++src': 'c++',
  'text/x-csrc': 'c',
  'text/x-java': 'java',
  'text/x-scala': 'scala',
  'text/x-kotlin': 'kotlin',
  'text/x-csharp': 'c#',
  'text/x-fsharp': 'f#',
  'text/x-sh': 'shell',
  'text/x-rsrc': 'r',
  'text/x-julia': 'julia',
  'text/x-go': 'go',
  'text/x-rustsrc': 'rust',
  'text/x-sql': 'sql',
  'text/typescript': 'typescript',
  'text/javascript': 'javascript',
};

/** One name a notebook gives its language, as CodeMirror calls it in lower case, or null if unknown. */
function canonical(candidate: unknown): string | null {
  const raw =
    typeof candidate === 'object' && candidate !== null
      ? (candidate as { name?: unknown }).name
      : candidate;
  if (typeof raw !== 'string') {
    return null;
  }
  let name = raw.trim().toLowerCase();
  name = MODE_MIMES[name] ?? name;
  // xeus-cpp's C kernels say which standard: C11, C17, C23.
  if (/^c\d\d$/.test(name)) {
    name = 'c';
  }
  if (name === '') {
    return null;
  }
  return LanguageDescription.matchLanguageName(languages, name, true)?.name.toLowerCase() ?? null;
}

/**
 * The language a notebook's cells are in, from the first of `candidates` that names one: the running
 * kernel's own account first (its codemirror_mode, then its language name), then its kernelspec's, then
 * what the file says it was last run with. Lower case, as CodeMirror names it, so `cpp`, `C++17` and
 * `text/x-c++src` all read `c++` to the highlighter and the language server alike. A name nothing
 * knows is kept as it is, for the cells to be plain text; undefined when nothing says.
 */
export function cellLanguageOf(candidates: unknown[]): string | undefined {
  for (const candidate of candidates) {
    const known = canonical(candidate);
    if (known !== null) {
      return known;
    }
  }
  const named = candidates.find((candidate) => typeof candidate === 'string' && candidate.trim());
  return typeof named === 'string' ? named.trim().toLowerCase() : undefined;
}

/**
 * Highlighting for a notebook's code cells, in its kernel's language. Python when nothing says otherwise,
 * which is what most notebooks are; plain text for a language nothing highlights, and while one loads.
 */
export function useCellLanguage(name: string | undefined): Extension {
  const wanted = name?.trim().toLowerCase() ?? '';
  const isPython = wanted === '' || wanted === 'python';
  const [loaded, setLoaded] = useState<{ name: string; language: Extension } | null>(null);

  useEffect(() => {
    if (isPython) {
      return;
    }
    const loading = lazyLanguageNamed(wanted);
    if (loading === null) {
      setLoaded({ name: wanted, language: [] });
      return;
    }
    let live = true;
    loading
      .then((language) => {
        if (live) {
          setLoaded({ name: wanted, language });
        }
      })
      .catch((error: unknown) =>
        console.error(`Could not load highlighting for ${wanted}:`, error)
      );
    return () => {
      live = false;
    };
  }, [wanted, isPython]);

  if (isPython) {
    return PYTHON;
  }
  return loaded?.name === wanted ? loaded.language : [];
}
