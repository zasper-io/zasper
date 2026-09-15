import { useEffect, useMemo } from 'react';
import { useAtomValue, useSetAtom } from 'jotai';

import { apiErrorMessage, SearchFile, searchContents } from '@/api';
import {
  contentQuery,
  leftOutAtom,
  NO_RESULTS,
  searchOptionsAtom,
  searchRerunAtom,
  searchResultsAtom,
} from '@/store/projectSearch';

/** How long the query has to stay still before it is searched: one search per word, not per letter. */
export const SEARCH_DELAY = 250;

/** How often files arriving from a search are drawn, rather than one render per file. */
const DRAW_EVERY = 60;

/**
 * Runs the panel's query against the server whenever it changes, cancelling the search in flight.
 *
 * The previous results stay on screen until the new search has something to say, so typing a word does
 * not blank the list at every letter.
 */
export function useProjectSearch(): void {
  const options = useAtomValue(searchOptionsAtom);
  const rerun = useAtomValue(searchRerunAtom);
  const setResults = useSetAtom(searchResultsAtom);
  const setLeftOut = useSetAtom(leftOutAtom);

  const query = useMemo(() => contentQuery(options), [options]);
  const asked = JSON.stringify(query);
  // What was left out belongs to a list of matches, and a different query is a different list. The
  // replacement text is not part of that: changing it leaves the same matches.
  const searched = JSON.stringify({ ...query, replace: undefined });

  useEffect(() => {
    setLeftOut({ files: [], matches: [] });
  }, [searched, setLeftOut]);

  useEffect(() => {
    const wanted = JSON.parse(asked) as typeof query;
    if (wanted.pattern === '') {
      setResults(NO_RESULTS);
      return;
    }

    const controller = new AbortController();
    const files: SearchFile[] = [];
    let drawTimer: number | undefined;
    // By path, so a search run again after a replace does not reshuffle the list under the reader.
    const sorted = () => [...files].sort((left, right) => left.path.localeCompare(right.path));
    const draw = () => {
      drawTimer = undefined;
      setResults({ files: sorted(), summary: null, searching: true, error: '' });
    };

    const start = window.setTimeout(() => {
      setResults((current) => ({ ...current, searching: true, error: '' }));
      searchContents(
        wanted,
        (file) => {
          files.push(file);
          drawTimer ??= window.setTimeout(draw, DRAW_EVERY);
        },
        controller.signal
      )
        .then((summary) => {
          window.clearTimeout(drawTimer);
          setResults({ files: sorted(), summary, searching: false, error: '' });
        })
        .catch((error: unknown) => {
          window.clearTimeout(drawTimer);
          if (!controller.signal.aborted) {
            setResults({ ...NO_RESULTS, error: apiErrorMessage(error) });
          }
        });
    }, SEARCH_DELAY);

    return () => {
      window.clearTimeout(start);
      window.clearTimeout(drawTimer);
      controller.abort();
    };
  }, [asked, rerun, setResults]);
}
