import React, { useState } from 'react';
import { useAtom } from 'jotai';
import { zasperVersionAtom } from '../../../store/AppState';
import './HelpDialog.scss';

interface ModalProps {
  toggleHelpDialog: any;
}

interface INav {
  name: string;
  display: string;
}

interface INavDict {
  [id: string]: INav;
}

function HelpDialog(props: ModalProps) {
  const defaultNavState: INavDict = {
    general: { name: 'general', display: 'd-block' },
    keyBindings: { name: 'keyBindings', display: 'd-none' },
    support: { name: 'support', display: 'd-none' },
  };
  const [navState, setNavState] = useState<INavDict>(defaultNavState);

  const handleNavigationPanel = (name: string) => {
    const updatedNavState = Object.fromEntries(
      Object.keys(navState).map((key) => [
        key,
        { ...navState[key], display: key === name ? 'd-block' : 'd-none' },
      ])
    );
    setNavState(updatedNavState);
  };

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
                <HelpNavigationPanel handleNavigationPanel={handleNavigationPanel} />
              </div>
              <div className="help-section">
                <AboutSection display={navState.general.display} />
                <KeyBindingsSection display={navState.keyBindings.display} />
                <SupportSection display={navState.support.display} />
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

interface HelpNavigationPanelProps {
  handleNavigationPanel: (panelName: string) => void;
}

const HelpNavigationPanel: React.FC<HelpNavigationPanelProps> = ({ handleNavigationPanel }) => {
  // State to track the active navigation item
  const [activeNavItem, setActiveNavItem] = useState<string>('general'); // Default active item

  // Handle navigation item click (set active class)
  const handleNavItemClick = (panelName: string) => {
    setActiveNavItem(panelName); // Update the active item
    handleNavigationPanel(panelName); // Call the parent handler
  };

  // Render navigation buttons
  const renderNavButtons = () => {
    const navItems = [
      { name: 'general', display: 'General' },
      { name: 'support', display: 'Support' },
      { name: 'keyBindings', display: 'Key Bindings' },
    ];

    return navItems.map((item) => (
      <button
        key={item.name}
        className={`helpNavButton ${activeNavItem === item.name ? 'active' : ''}`}
        onClick={() => handleNavItemClick(item.name)} // Set active item and navigate
      >
        {item.display}
      </button>
    ));
  };

  return (
    <div className="help-navigation-list">
      {/* Render navigation buttons */}
      {renderNavButtons()}
    </div>
  );
};

function AboutSection({ display }: { display: string }) {
  const [zasperVersion] = useAtom(zasperVersionAtom);
  return (
    <div className={display}>
      <h6>Zasper is a supercharged IDE for Data Science.</h6>
      <h6>Version: {zasperVersion}</h6>
      <h6>Author: Prasun Anand</h6>
      <a href="https://zasper.io/docs" target="_blank" rel="noreferrer">
        Docs
      </a>
    </div>
  );
}

function KeyBindingsSection({ display }: { display: string }) {
  return (
    <div className={display}>
      <span>Key Bindings </span>
    </div>
  );
}

function SupportSection({ display }: { display: string }) {
  return (
    <div className={display}>
      <span>Support </span>
    </div>
  );
}

export default HelpDialog;
