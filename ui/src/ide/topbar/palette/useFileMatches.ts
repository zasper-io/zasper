import { useEffect, useMemo, useRef, useState } from 'react';

import { debounce } from 'lodash';

import { IContentEntry, searchFiles } from '@/api';

/**
 * The files whose name contains `query`, kept up to date as it is typed.
 *
 * The search is a walk of the whole tree on the server, so it is debounced, and answers already seen
 * are kept: the palette's query grows a character at a time and backspacing over one asks a question
 * that was just answered. The cache lives in a ref because a plain object would be rebuilt on every
 * keystroke and never hit.
 *
 * An empty query is not a search for everything but a question not yet asked, so it clears the list
 * without a request.
 */
export function useFileMatches(query: string): IContentEntry[] {
  const [matches, setMatches] = useState<IContentEntry[]>([]);
  const cache = useRef<Record<string, IContentEntry[]>>({});
  // What the list is currently meant to be about. A walk of a large tree can take longer than the
  // typing, and without this a slow answer to an abandoned query would land on top of a newer one.
  const wanted = useRef<string>('');

  const search = useMemo(
    () =>
      debounce(async (needle: string) => {
        wanted.current = needle;
        const seen = cache.current[needle];
        if (seen !== undefined) {
          setMatches(seen);
          return;
        }
        try {
          const found = await searchFiles(needle);
          cache.current[needle] = found;
          if (wanted.current === needle) {
            setMatches(found);
          }
        } catch (error) {
          console.error('Failed to search for files:', error);
        }
      }, 100),
    []
  );

  useEffect(() => {
    if (query === '') {
      search.cancel();
      wanted.current = '';
      setMatches([]);
      return;
    }
    search(query);
  }, [query, search]);

  useEffect(() => () => search.cancel(), [search]);

  return matches;
}
