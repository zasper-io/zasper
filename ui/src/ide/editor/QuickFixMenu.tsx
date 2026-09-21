import React, { useRef } from 'react';

import { Icon } from '@/ide/icons';
import { useDismissOnEscape, useDismissOnPressOutside } from '@/ide/overlays';
import { CodeAction } from '@/lsp/codeActions';

interface QuickFixMenuProps {
  actions: CodeAction[];
  /** Where the cursor is, in the editor area's own pixels. */
  at: { left: number; top: number };
  onRun: (action: CodeAction) => void;
  onClose: () => void;
}

/** A fix is a quick fix, anything else is a refactor — which is the only grouping the drawing shows. */
function isFix(action: CodeAction): boolean {
  return action.kind === undefined || action.kind.startsWith('quickfix');
}

/**
 * The fixes and refactors a server offers where the cursor is, opened by the lamp in the
 * gutter or by `⌘.`. Grouped, because a fix answers a problem and a refactor answers a wish.
 */
export default function QuickFixMenu(props: QuickFixMenuProps) {
  const menu = useRef<HTMLDivElement>(null);
  useDismissOnEscape(props.onClose);
  useDismissOnPressOutside(menu, props.onClose);

  const fixes = props.actions.filter(isFix);
  const refactors = props.actions.filter((action) => !isFix(action));
  const groups = [
    { label: 'Quick fix', actions: fixes },
    { label: 'Refactor', actions: refactors },
  ].filter((group) => group.actions.length > 0);

  return (
    <div
      className="z-overlay z-menu quick-fix-menu"
      ref={menu}
      style={{ left: props.at.left, top: props.at.top }}
      role="menu"
      aria-label="Quick fix"
    >
      <div className="z-overlay-list">
        {groups.map((group) => (
          <React.Fragment key={group.label}>
            <div className="z-overlay-group z-label">
              <span>{group.label}</span>
            </div>
            {group.actions.map((action, index) => (
              <button
                key={`${group.label}:${index}`}
                type="button"
                role="menuitem"
                className="panel-row"
                onClick={() => props.onRun(action)}
                title={action.title}
              >
                <Icon name={isFix(action) ? 'lightbulb' : 'pencil'} size={12} />
                <span className="panel-row-name">
                  <span className="panel-row-label">{action.title}</span>
                </span>
              </button>
            ))}
          </React.Fragment>
        ))}
      </div>
    </div>
  );
}
