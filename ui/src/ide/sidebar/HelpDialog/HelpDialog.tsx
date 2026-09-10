import React, { useMemo, useState } from 'react';
import { useAtom } from 'jotai';
import { chordParts } from '@/commands/keys';
import { useCommands } from '@/commands/registry';
import type { ICommand } from '@/commands/types';
import { Icon } from '@/ide/icons';
import { useDismissOnEscape } from '@/ide/overlays';
import { zasperVersionAtom } from '@/store/AppState';
import './HelpDialog.scss';

interface ModalProps {
  toggleHelpDialog: () => void;
}

type HelpSection = 'general' | 'keyBindings' | 'support';

function HelpDialog(props: ModalProps) {
  // A section name, not a map of CSS class names: hiding is .is-hidden's job (see
  // styles/_base.scss), and the visible display value belongs to the section's stylesheet.
  const [activeSection, setActiveSection] = useState<HelpSection>('general');

  useDismissOnEscape(props.toggleHelpDialog);

  return (
    // It was `aria-hidden="true"` with Bootstrap's example ids, which said the opposite of what is
    // true: a rendered dialog, and the only thing on screen worth reading.
    <div className="modal" role="dialog" aria-modal="true" aria-labelledby="helpDialogTitle">
      <div className="modal-dialog modal-dialog-centered">
        <div className="modal-content">
          <div className="modal-head" id="helpDialogTitle">
            Help
            <button
              type="button"
              className="z-icon-button on-chrome modal-btn-close"
              aria-label="Close"
              onClick={props.toggleHelpDialog}
            >
              {' '}
              <Icon name="x" />{' '}
            </button>
          </div>
          <div className="modal-body">
            <div className="helpArea">
              <div className="helpNavigation">
                <HelpNavigationPanel
                  activeSection={activeSection}
                  setActiveSection={setActiveSection}
                />
              </div>
              <div className="help-section">
                <AboutSection hidden={activeSection !== 'general'} />
                <KeyBindingsSection hidden={activeSection !== 'keyBindings'} />
                <SupportSection hidden={activeSection !== 'support'} />
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

interface HelpNavigationPanelProps {
  activeSection: HelpSection;
  setActiveSection: (section: HelpSection) => void;
}

const NAV_ITEMS: { name: HelpSection; label: string }[] = [
  { name: 'general', label: 'General' },
  { name: 'support', label: 'Support' },
  { name: 'keyBindings', label: 'Key Bindings' },
];

// Which item is highlighted comes from the parent, which also decides which section is
// shown — one piece of state, so the two cannot disagree.
const HelpNavigationPanel: React.FC<HelpNavigationPanelProps> = ({
  activeSection,
  setActiveSection,
}) => {
  return (
    <div className="help-navigation-list">
      {NAV_ITEMS.map((item) => (
        <button
          key={item.name}
          className={`helpNavButton ${activeSection === item.name ? 'active' : ''}`}
          onClick={() => setActiveSection(item.name)}
        >
          {item.label}
        </button>
      ))}
    </div>
  );
};

function AboutSection({ hidden }: { hidden: boolean }) {
  const [zasperVersion] = useAtom(zasperVersionAtom);
  return (
    <div className={hidden ? 'is-hidden' : undefined}>
      {/* Body text, so <p> rather than a heading element. */}
      <p>Zasper is a supercharged IDE for Data Science.</p>
      <p>Version: {zasperVersion}</p>
      <p>Author: Prasun Anand</p>
      <a href="https://zasper.io/docs" target="_blank" rel="noreferrer">
        Docs
      </a>
    </div>
  );
}

/**
 * Every chord the app answers to right now, read off the command registry rather than written out
 * here — so a binding changed in `notebookCommands.ts` cannot leave this list saying the old one.
 *
 * "Right now" is the one thing worth knowing about it: a tab registers its commands only while it is
 * the active one, so the notebook's chords are here while a notebook is open and gone when it is not.
 * That is the same registry the palette reads, and the note below says so rather than the list
 * pretending to be the whole of the app.
 */
function KeyBindingsSection({ hidden }: { hidden: boolean }) {
  const commands = useCommands();

  // `useCommands` sorts by category then label, so a group is a run and the order inside it is
  // already right.
  const groups = useMemo(() => {
    const byCategory = new Map<string, ICommand[]>();
    for (const command of commands) {
      if (!command.keys?.length) {
        continue;
      }
      const group = byCategory.get(command.category);
      if (group) {
        group.push(command);
      } else {
        byCategory.set(command.category, [command]);
      }
    }
    return [...byCategory];
  }, [commands]);

  return (
    <div className={hidden ? 'is-hidden' : undefined}>
      {groups.length === 0 ? (
        <p>No keyboard shortcuts are registered.</p>
      ) : (
        groups.map(([category, inCategory]) => (
          <section key={category} className="keyBindings-group">
            <h3 className="z-label">{category}</h3>
            <table className="keyBindings">
              <tbody>
                {inCategory.map((command) => (
                  <tr key={command.id}>
                    <td>{command.label}</td>
                    <td className="keyBindings-keys">
                      <Chords keys={command.keys ?? []} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </section>
        ))
      )}
      <p className="keyBindings-note">
        A tab's own shortcuts are listed while that tab is open — the notebook's while a notebook
        is, as in the command palette.
      </p>
    </div>
  );
}

/**
 * One command's chords, each key drawn as a key.
 *
 * Deduplicated on the rendered form, not on the binding: `notebook:save` is bound to both `Mod-s`
 * and `Ctrl-s` so that either spelling works on every platform, and on Windows the two render the
 * same — listing `Ctrl+S Ctrl+S` would read as two different shortcuts.
 */
function Chords({ keys }: { keys: string[] }) {
  const chords = useMemo(() => {
    const seen = new Map<string, string[]>();
    for (const binding of keys) {
      const parts = chordParts(binding);
      const rendered = parts.join('\u0000');
      if (!seen.has(rendered)) {
        seen.set(rendered, parts);
      }
    }
    return [...seen.values()];
  }, [keys]);

  return (
    <>
      {chords.map((parts, index) => (
        <span key={index} className="keyBindings-chord">
          {parts.map((part, position) => (
            <kbd key={position}>{part}</kbd>
          ))}
        </span>
      ))}
    </>
  );
}

function SupportSection({ hidden }: { hidden: boolean }) {
  return (
    <div className={hidden ? 'is-hidden' : undefined}>
      <span>Support </span>
      <p>File an issue on <a href="https://github.com/zasper-io/zasper" target="_blank" rel="noopener noreferrer">GitHub</a></p>
    </div>
  );
}

export default HelpDialog;
