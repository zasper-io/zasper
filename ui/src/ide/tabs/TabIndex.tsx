import { useAtomValue } from 'jotai';
import React from 'react';
import { fileTabsAtom, IfileTab } from '@/store/TabState';
import { useTabActions } from '@/store/TabActions';
import { unsavedTabsAtom } from '@/store/UnsavedState';
import './TabIndex.scss';
import { apiErrorMessage } from '@/api';
import { FileMark, Icon } from '@/ide/icons';
import { useTooltip } from '@/ide/overlays';
import Tooltip from '@/ide/Tooltip';
import UnsavedChangesDialog from './UnsavedChangesDialog';

/**
 * What a tab wears in front of its name.
 *
 * Only a file gets a file-type mark; the other two kinds of tab are not files, and a launcher
 * keeps the product logo because that is what it is.
 */
function TabMark({ tab }: { tab: IfileTab }) {
  if (tab.type === 'launcher') {
    return <img className="tabIcon" src="./images/logo-icon.svg" alt="" />;
  }
  if (tab.type === 'terminal') {
    return <Icon name="terminal" className="tabIcon" />;
  }
  // The file's own name for a diff: its tab is named `notes.txt (diff)`, whose extension is
  // `txt (diff)` and which would therefore get the mark for an unknown type.
  return <FileMark name={tab.diff?.path ?? tab.name} className="tabIcon" />;
}

export default function TabIndex() {
  const fileTabsState = useAtomValue(fileTabsAtom);
  const { activateTab, closeTab } = useTabActions();
  const unsavedTabs = useAtomValue(unsavedTabsAtom);
  /** The tab waiting on an answer to the save prompt, if one is open. */
  const [pendingClose, setPendingClose] = React.useState<string | null>(null);
  const [saving, setSaving] = React.useState(false);
  const [saveError, setSaveError] = React.useState('');

  const handleTabClose = (e: React.MouseEvent, key: string) => {
    e.stopPropagation();

    // An unsaved tab is asked about rather than closed: discarding the work has to be an answer,
    // not a side effect of the click.
    if (unsavedTabs[key]) {
      setPendingClose(key);
      setSaveError('');
      return;
    }
    closeTab(key);
  };

  const saveAndClose = async () => {
    if (!pendingClose) {
      return;
    }
    const key = pendingClose;
    setSaving(true);
    setSaveError('');
    try {
      await unsavedTabs[key]();
    } catch (error: unknown) {
      // Left open on the reason the server gave: the editor is holding the only copy of the work.
      setSaveError(apiErrorMessage(error));
      setSaving(false);
      return;
    }
    setSaving(false);
    setPendingClose(null);
    closeTab(key);
  };

  const discardAndClose = () => {
    if (!pendingClose) {
      return;
    }
    const key = pendingClose;
    setPendingClose(null);
    closeTab(key);
  };

  return (
    <div className="tabHeader">
      <ul className="tabList">
        {Object.keys(fileTabsState).map((key) => (
          // Keyed by path, as the tab content is: by index, closing a tab moves every tab after it
          // into the DOM node of its neighbour.
          <Tab
            key={key}
            tab={fileTabsState[key]}
            isDirty={unsavedTabs[key] !== undefined}
            onActivate={() => activateTab(key)}
            onClose={async (event) => await handleTabClose(event, key)}
          />
        ))}
      </ul>
      {pendingClose && (
        <UnsavedChangesDialog
          name={fileTabsState[pendingClose]?.name ?? pendingClose}
          saving={saving}
          error={saveError}
          onSave={saveAndClose}
          onDiscard={discardAndClose}
          onCancel={() => setPendingClose(null)}
        />
      )}
    </div>
  );
}

interface TabProps {
  tab: IfileTab;
  isDirty: boolean;
  onActivate: () => void;
  onClose: (event: React.MouseEvent) => Promise<void>;
}

/**
 * One tab on the strip.
 *
 * The tooltip is the whole of what the tab cannot show: `.tabName` truncates with an ellipsis, so two
 * notebooks with a long shared prefix were the same tab, and the path rather than the name is what
 * tells two `main.py` apart. Whether it is unsaved goes on a second line rather than on the dot: the
 * dot is inside the tab, so a tooltip of its own would open on top of this one.
 */
function Tab({ tab, isDirty, onActivate, onClose }: TabProps) {
  const tip = useTooltip();
  const label = [tab.type === 'launcher' ? tab.name : tab.path];
  if (isDirty) {
    label.push('Unsaved changes');
  }

  return (
    <li className="tab-item" role="presentation">
      <button
        type="button"
        className={tab.active ? 'tab is-active' : 'tab'}
        onClick={onActivate}
        {...tip.anchorProps}
      >
        <TabMark tab={tab} />
        {/* The name is an element of its own so that the mark's lettering is not part of it:
            a bare text node makes the tab read as `txtnotes.txt` to anything matching on
            text, and `.panel-row-name` in the sidebar's rows is the same idea. */}
        <span className="tabName">{tab.name}</span>
        {/* Unsaved, said as a dot rather than in the name: the name is already fighting an
            ellipsis for room, and until now nothing on the strip said it at all — the first a
            tab told anyone was the dialog that opens when it is closed. */}
        {isDirty && <span className="tab-dirty" role="img" aria-label="Unsaved changes" />}
        {tab.name !== 'Launcher' && (
          // The handler is on the span rather than on the icon: an <Icon> is a glyph and
          // takes no events, and a <button> cannot be nested in the tab's own button. Its name is
          // `aria-label` and not a tooltip for the same reason the dot's is.
          <span
            className="z-icon-button tab-close"
            role="button"
            aria-label="Close"
            onClick={onClose}
          >
            <Icon name="x" size={12} />
          </span>
        )}
      </button>
      <Tooltip tip={tip} label={label} />
    </li>
  );
}
