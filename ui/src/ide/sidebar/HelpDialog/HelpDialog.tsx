import React, { useState } from 'react';
import { useAtom } from 'jotai';
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

  return (
    <div className="modal" id="exampleModal" aria-labelledby="exampleModalLabel" aria-hidden="true">
      <div className="modal-dialog modal-dialog-centered">
        <div className="modal-content">
          <div className="modal-head">
            Help
            <button
              type="button"
              className="modal-btn-close"
              aria-label="Close"
              onClick={props.toggleHelpDialog}
            >
              {' '}
              <i className="fas fa-times-circle"></i>{' '}
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

function KeyBindingsSection({ hidden }: { hidden: boolean }) {
  return (
    <div className={hidden ? 'is-hidden' : undefined}>
      <span>Key Bindings </span>
    </div>
  );
}

function SupportSection({ hidden }: { hidden: boolean }) {
  return (
    <div className={hidden ? 'is-hidden' : undefined}>
      <span>Support </span>
    </div>
  );
}

export default HelpDialog;
