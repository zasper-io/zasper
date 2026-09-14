import React, { useEffect, useMemo, useRef, useState } from 'react';
import { useAtomValue } from 'jotai';
import { toast } from 'react-toastify';

import { copyToClipboard } from '@/browser';
import { DOCS_URL, ISSUES_URL } from '@/commands/helpCommands';
import { chordParts } from '@/commands/keys';
import { ALL_COMMANDS } from '@/commands/catalog';
import { CommandInfo } from '@/commands/define';
import { Icon } from '@/ide/icons';
import {
  configPathAtom,
  helpAboutRequestAtom,
  platformAtom,
  projectDirAtom,
  zasperVersionAtom,
} from '@/store/AppState';
import { IfileTab } from '@/store/TabState';
import './HelpTab.scss';

/** Every command with a key, sorted once: the list is fixed, and a group is then a run. */
const SHORTCUTS = ALL_COMMANDS.filter((command) => command.keys?.length).sort(
  (a, b) => a.category.localeCompare(b.category) || a.label.localeCompare(b.label)
);

interface HelpTabProps {
  data: IfileTab;
}

/** Every keyboard shortcut, filtered, and what a bug report asks for. */
export default function HelpTab({ data }: HelpTabProps) {
  const [query, setQuery] = useState('');
  const filter = useRef<HTMLInputElement>(null);
  const about = useRef<HTMLElement>(null);
  const aboutRequest = useAtomValue(helpAboutRequestAtom);

  useEffect(() => {
    if (data.active) {
      filter.current?.focus({ preventScroll: true });
    }
  }, [data.active]);

  useEffect(() => {
    if (aboutRequest > 0) {
      about.current?.scrollIntoView?.({ block: 'start' });
    }
  }, [aboutRequest]);

  return (
    <div className="help-tab-page">
      <div className="help-tab-measure">
        <div className="help-filter">
          <Icon name="search" size={14} />
          <input
            ref={filter}
            className="z-field"
            type="text"
            placeholder="Filter shortcuts"
            aria-label="Filter shortcuts"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
          />
        </div>
        <Shortcuts query={query} />
        <section ref={about} className="help-about" aria-label="About Zasper">
          <About />
        </section>
      </div>
    </div>
  );
}

function Shortcuts({ query }: { query: string }) {
  const needle = query.trim().toLowerCase();

  // Matched on category as well as label, as the palette does.
  const groups = useMemo(() => {
    const byCategory = new Map<string, CommandInfo[]>();
    for (const entry of SHORTCUTS) {
      if (
        needle !== '' &&
        !entry.label.toLowerCase().includes(needle) &&
        !entry.category.toLowerCase().includes(needle)
      ) {
        continue;
      }
      const group = byCategory.get(entry.category);
      if (group) {
        group.push(entry);
      } else {
        byCategory.set(entry.category, [entry]);
      }
    }
    return [...byCategory];
  }, [needle]);

  if (groups.length === 0) {
    return (
      <p className="z-note help-empty">
        {needle === ''
          ? 'There are no keyboard shortcuts.'
          : `No shortcut matches “${query.trim()}”.`}
      </p>
    );
  }

  return (
    <>
      {groups.map(([category, entries]) => (
        <section key={category} aria-label={category}>
          <h3 className="z-label help-group">{category}</h3>
          <ul className="help-rows">
            {entries.map((entry) => (
              <li key={entry.id} className="panel-row">
                <span className="panel-row-label">{entry.label}</span>
                <span className="panel-row-keys">
                  <Chords keys={entry.keys ?? []} />
                </span>
              </li>
            ))}
          </ul>
        </section>
      ))}
    </>
  );
}

/**
 * One command's chords, each key drawn as a key. Deduplicated on the rendered form: `Mod-s` and
 * `Ctrl-s` are the same chord off mac, and listing it twice would read as two shortcuts.
 */
function Chords({ keys }: { keys: string[] }) {
  const chords = useMemo(() => {
    const seen = new Map<string, string[]>();
    for (const binding of keys) {
      const parts = chordParts(binding);
      const rendered = parts.join(' ');
      if (!seen.has(rendered)) {
        seen.set(rendered, parts);
      }
    }
    return [...seen.values()];
  }, [keys]);

  return (
    <>
      {chords.map((parts, index) => (
        <span key={index} className="help-chord">
          {parts.map((part, position) => (
            <kbd key={position} className="help-key">
              {part}
            </kbd>
          ))}
        </span>
      ))}
    </>
  );
}

function About() {
  const version = useAtomValue(zasperVersionAtom);
  const platform = useAtomValue(platformAtom);
  const directory = useAtomValue(projectDirAtom);
  const config = useAtomValue(configPathAtom);
  // All four arrive together from `/api/info`.
  const loaded = version !== '';

  const facts: [string, string][] = [
    ['Version', version],
    ['Platform', platform],
    ['Directory', directory],
    ['Config', config],
  ];

  const copyDetails = async () => {
    const text = facts.map(([label, value]) => `${label}: ${value}`).join('\n');
    if (await copyToClipboard(text)) {
      toast.success('Copied the details to the clipboard.');
    } else {
      toast.error('The browser did not allow copying to the clipboard.');
    }
  };

  return (
    <>
      <dl>
        {facts.map(([label, value]) => (
          <React.Fragment key={label}>
            <dt>{label}</dt>
            <dd>{loaded ? value || '—' : 'Loading…'}</dd>
          </React.Fragment>
        ))}
      </dl>
      <div className="help-about-actions">
        <button
          type="button"
          className="z-button z-button-secondary"
          disabled={!loaded}
          onClick={copyDetails}
        >
          <Icon name="copy" size={14} />
          Copy details
        </button>
        <span className="help-about-links">
          <a href={DOCS_URL} target="_blank" rel="noreferrer">
            Documentation
          </a>
          <a href={ISSUES_URL} target="_blank" rel="noreferrer">
            Report an issue
          </a>
        </span>
      </div>
    </>
  );
}
