import React, { useRef, useState } from 'react';

import { useDismissOnEscape, useDismissOnPressOutside } from '@/ide/overlays';
import { NEARLY_FULL } from '@/ide/resources/memory';
import { ContextUsage } from './chatLog';

/** A count of tokens as a person reads one: 76k, 1.2M. */
export function tokens(count: number): string {
  if (count >= 1_000_000) {
    return `${Number((count / 1_000_000).toFixed(1))}M`;
  }
  if (count >= 1_000) {
    return `${Math.round(count / 1_000)}k`;
  }
  return String(count);
}

function money({ amount, currency }: { amount: number; currency: string }): string {
  try {
    return new Intl.NumberFormat(undefined, { style: 'currency', currency }).format(amount);
  } catch {
    return `${amount.toFixed(2)} ${currency}`;
  }
}

/**
 * How full the conversation's context window is, in the panel's head: a meter and its figure, which
 * open what the agent has said about it. From 90% both turn the warning colour.
 */
export default function ContextMeter({ usage, model }: { usage: ContextUsage; model?: string }) {
  const [open, setOpen] = useState(false);
  const within = useRef<HTMLSpanElement>(null);
  const close = () => setOpen(false);
  useDismissOnEscape(close, open);
  useDismissOnPressOutside(within, close, open);

  const fraction = usage.size > 0 ? Math.min(usage.used / usage.size, 1) : 0;
  const percent = Math.round(fraction * 100);
  const high = fraction >= NEARLY_FULL;
  const said = `${percent}% of the context window: ${tokens(usage.used)} of ${tokens(usage.size)} tokens`;

  return (
    <span className="agentUsage-anchor" ref={within}>
      <button
        type="button"
        className={['agentUsage', high && 'is-high', open && 'is-open'].filter(Boolean).join(' ')}
        title={`${said}. Show the breakdown`}
        aria-label={`Context: ${percent}% full`}
        aria-haspopup="dialog"
        aria-expanded={open}
        onClick={() => setOpen(!open)}
      >
        <span className={high ? 'z-meter is-high' : 'z-meter'} aria-hidden="true">
          <span style={{ width: `${percent}%` }} />
        </span>
        {percent}%
      </button>
      {open && (
        <div
          className="z-overlay agentUsage-menu"
          role="dialog"
          aria-label={usage.cost ? 'Context and cost' : 'Context'}
        >
          <dl className="agentUsage-detail">
            <dt>Context</dt>
            <dd>
              {tokens(usage.used)} of {tokens(usage.size)} tokens
            </dd>
            {usage.cost && (
              <>
                <dt>Cost of this chat</dt>
                <dd>{money(usage.cost)}</dd>
              </>
            )}
            {model && (
              <>
                <dt>Model</dt>
                <dd>{model}</dd>
              </>
            )}
          </dl>
          {usage.cost && (
            <p className="agentMenu-help">
              The cost is the agent&rsquo;s own count. On a subscription it is not billed.
            </p>
          )}
        </div>
      )}
    </span>
  );
}
