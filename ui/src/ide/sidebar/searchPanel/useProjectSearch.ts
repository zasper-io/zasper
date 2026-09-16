import { useEffect, useMemo } from 'react';
import { useAtomValue, useSetAtom } from 'jotai';

import { apiErrorMessage, ContentQuery, SearchFile, searchBuffer, searchContents } from '@/api';
import { openDocument } from '@/store/openDocuments';
import { unsavedTabsAtom } from '@/store/unsavedState';
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
 * The results for the files an editor holds unsaved, from the text it holds. Asked of the server so that
 * every row in the panel — disk or editor — was found by the same engine; a file whose editor cannot say
 * what it holds, such as a notebook, keeps its answer from disk.
 */
async function heldFiles(query: ContentQuery, paths: string): Promise<SearchFile[]> {
  const asking = paths
    .split('\n')
    .filter((path) => path !== '')
    .map((path) => {
      const text = openDocument(path)?.text?.();
      return text === undefined ? null : searchBuffer(query, path, text).catch(() => null);
    })
    .filter((answer): answer is Promise<SearchFile | null> => answer !== null);
  return (await Promise.all(asking)).filter((file): file is SearchFile => file !== null);
}

/**
 * Runs the panel's query against the server whenever it changes, cancelling the search in flight.
 *
 * The previous results stay on screen until the new search has something to say, so typing a word does
 * not blank the list at every letter.
 */
export function useProjectSearch(): void {
  const options = useAtomValue(searchOptionsAtom);
  const unsaved = useAtomValue(unsavedTabsAtom);
  const rerun = useAtomValue(searchRerunAtom);
  const setResults = useSetAtom(searchResultsAtom);
  const setLeftOut = useSetAtom(leftOutAtom);

  const query = useMemo(() => contentQuery(options), [options]);
  const asked = JSON.stringify(query);
  // A file with unsaved edits is searched again as its editor holds it, so the rows are what the reader
  // sees rather than what is on disk. The paths, not the save functions: those change on every keystroke.
  const unsavedPaths = Object.keys(unsaved).sort().join('\n');
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
        .then(async (summary) => {
          window.clearTimeout(drawTimer);
          setResults({ files: sorted(), summary, searching: false, error: '' });
          const held = await heldFiles(wanted, unsavedPaths);
          if (held.length > 0 && !controller.signal.aborted) {
            const byPath = new Map(held.map((file) => [file.path, file]));
            const kept = files.filter((file) => !byPath.has(file.path));
            const merged = [...kept, ...held.filter((file) => file.lines.length > 0)];
            setResults({
              files: merged.sort((left, right) => left.path.localeCompare(right.path)),
              summary,
              searching: false,
              error: '',
            });
          }
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
  }, [asked, rerun, unsavedPaths, setResults]);
}
