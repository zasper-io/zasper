import React, { ReactNode, useId } from 'react';

import { Icon } from '@/ide/icons';
import { useDismissOnEscape } from '@/ide/overlays';

/** Names them, up to a point: a list can be long, and a dialog taller than the window is no use. */
export function summariseNames(names: string[]): string {
  const shown = names.slice(0, 8);
  const rest = names.length - shown.length;
  return rest === 0 ? shown.join(', ') : `${shown.join(', ')} and ${rest} more`;
}

interface ConfirmDialogProps {
  title: ReactNode;
  /** The question, and anything else it needs, such as a checkbox. */
  children: ReactNode;
  /** The destructive answer's label. */
  confirmLabel?: string;
  /** What that label reads while the answer is in flight. */
  busyLabel?: string;
  /** True while the answer is in flight, so nothing can be pressed twice. */
  busy?: boolean;
  onConfirm?: () => void;
  onCancel: () => void;
  /** Answers to offer instead of Cancel and the destructive one. */
  actions?: ReactNode;
}

/**
 * The modal every confirmation shares. Escape and the close button cancel. The default answers are
 * Cancel, which takes the focus so that the destructive answer is not one Enter away, and a danger
 * button.
 */
export default function ConfirmDialog(props: ConfirmDialogProps) {
  const { title, children, busy = false, onCancel } = props;
  const titleId = useId();

  useDismissOnEscape(onCancel, !busy);

  return (
    <div className="modal" role="dialog" aria-modal="true" aria-labelledby={titleId}>
      <div className="modal-dialog modal-dialog-centered">
        <div className="modal-content">
          <div className="modal-head" id={titleId}>
            {title}
            <button
              type="button"
              className="z-icon-button on-chrome modal-btn-close"
              aria-label="Close"
              disabled={busy}
              onClick={onCancel}
            >
              <Icon name="x" />
            </button>
          </div>
          <div className="modal-body">
            {children}
            <div className="modal-actions">
              {props.actions ?? (
                <>
                  <button
                    className="z-button z-button-secondary"
                    autoFocus
                    disabled={busy}
                    onClick={onCancel}
                  >
                    Cancel
                  </button>
                  <button
                    className="z-button z-button-danger"
                    disabled={busy}
                    onClick={props.onConfirm}
                  >
                    {busy && props.busyLabel ? props.busyLabel : props.confirmLabel}
                  </button>
                </>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
