import { useEffect, useState } from 'react';
import { python } from '@codemirror/lang-python';
import { Extension } from '@codemirror/state';

import { lazyLanguageNamed } from '../language';

const PYTHON = python();

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
