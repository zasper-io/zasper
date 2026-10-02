import React, { lazy, Suspense, useEffect, useState } from 'react';
import { useSetAtom } from 'jotai';

import { getWhatsNew, logApiError, markWhatsNewSeen, WhatsNew } from '@/api';
import { updateStatusAtom } from '@/store/updates';
import { FileTab } from '@/store/tabState';
import './WhatsNewTab.scss';

const MarkdownRenderer = lazy(() => import('./notebook/MarkdownRenderer'));

export const CHANGELOG_URL = 'https://zasper.io/changelog/';

const MONTHS = [
  'January',
  'February',
  'March',
  'April',
  'May',
  'June',
  'July',
  'August',
  'September',
  'October',
  'November',
  'December',
];

/** `2026-09-22` as `22 September 2026`, the way the changelog's readers write it. */
export function releaseDate(date: string): string {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date);
  if (match === null) {
    return date;
  }
  return `${Number(match[3])} ${MONTHS[Number(match[2]) - 1]} ${match[1]}`;
}

/** A link in the notes leaves for a new browser tab, so following one does not replace the IDE. */
function openLinksOutside(event: React.MouseEvent) {
  const link = (event.target as HTMLElement).closest('a');
  const href = link?.getAttribute('href') ?? '';
  if (/^https?:\/\//.test(href)) {
    event.preventDefault();
    window.open(href, '_blank', 'noopener,noreferrer');
  }
}

interface WhatsNewTabProps {
  data: FileTab;
}

/** The running version's release notes, and every version's skipped since they were last shown. */
export default function WhatsNewTab(_props: WhatsNewTabProps) {
  const [notes, setNotes] = useState<WhatsNew | null>(null);
  const [failed, setFailed] = useState(false);
  const setStatus = useSetAtom(updateStatusAtom);

  useEffect(() => {
    getWhatsNew()
      .then(setNotes)
      .catch((error) => {
        setFailed(true);
        logApiError("Could not read what's new:")(error);
      });
    markWhatsNewSeen()
      .then(() => setStatus((status) => status && { ...status, whats_new: false }))
      .catch(logApiError("Could not record what's new as shown:"));
  }, [setStatus]);

  if (failed) {
    return (
      <div className="whatsnew-page">
        <p className="z-note">The release notes could not be read.</p>
      </div>
    );
  }
  if (notes === null) {
    return <div className="whatsnew-page" />;
  }

  const [newest, ...older] = notes.sections;
  return (
    <div className="whatsnew-page" onClick={openLinksOutside}>
      <div className="whatsnew-measure">
        <header className="whatsnew-head">
          <h1 className="z-heading">Zasper {notes.version}</h1>
          <span className="whatsnew-meta">
            {[
              newest?.date ? releaseDate(newest.date) : '',
              notes.from ? `you were on ${notes.from}` : '',
            ]
              .filter(Boolean)
              .join(' · ')}
          </span>
          <a className="whatsnew-link" href={CHANGELOG_URL} target="_blank" rel="noreferrer">
            Every release
          </a>
        </header>

        {newest === undefined ? (
          <p className="z-note">There are no release notes for {notes.version}.</p>
        ) : (
          <Suspense fallback={null}>
            <MarkdownRenderer source={newest.markdown} />
            {older.map((section) => (
              <section key={section.version} className="whatsnew-older">
                <h2 className="z-subheading">
                  Zasper {section.version}
                  <span className="whatsnew-meta">{releaseDate(section.date)}</span>
                </h2>
                <MarkdownRenderer source={section.markdown} />
              </section>
            ))}
          </Suspense>
        )}

        <p className="whatsnew-foot">
          Shown once after an upgrade. <em>Help: What&apos;s New</em> in the palette opens it again.
        </p>
      </div>
    </div>
  );
}
