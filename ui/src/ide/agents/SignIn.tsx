import React from 'react';

import { SignInMethod } from '@/api';
import IconButton from '@/ide/IconButton';
import { Icon } from '@/ide/icons';

export interface SignInProps {
  /** The agent's name, as the panel shows it. */
  name: string;
  methods: SignInMethod[];
  /** The way being finished in the terminal; none while one is chosen. */
  method?: SignInMethod;
  /** A word above the ways: signed out, still not signed in. */
  notice?: { text: string; failed: boolean };
  onSignIn: (method: SignInMethod) => void;
  onShowTerminal: () => void;
  onTryAgain: () => void;
  onChooseAnother: () => void;
  onBack: () => void;
}

/**
 * An agent that will not go on until someone signs in: the ways it offers, in its own words and order,
 * and then where to finish. Each way is the agent's own program, run in a Zasper terminal with the
 * command typed in, so what runs is in front of the reader. The sign-in is the agent's; Zasper keeps none
 * of it.
 */
export default function SignIn(props: SignInProps) {
  const { name, method, notice } = props;
  const said = notice && (
    <div className={notice.failed ? 'z-notice z-notice-error' : 'z-notice'} role="status">
      <Icon name={notice.failed ? 'circle-alert' : 'info'} size={14} />
      <p>{notice.text}</p>
    </div>
  );

  if (method) {
    return (
      <div className="agentStart">
        <div className="agentStart-intro">
          <h3 className="z-subheading">Finish signing in in the terminal</h3>
          <p>
            {method.name} runs in the terminal below the editor. Finish there, and come back here
            when it is done.
          </p>
        </div>
        {said}
        <div className="agentCard">
          <div className="agentCard-install">
            <code>{method.command}</code>
            <IconButton icon="terminal" label="Show the terminal" onClick={props.onShowTerminal} />
          </div>
        </div>
        <div className="agentSignIn-actions">
          <button type="button" className="z-button" onClick={props.onTryAgain}>
            Try again
          </button>
          <button
            type="button"
            className="z-button z-button-secondary"
            onClick={props.onChooseAnother}
          >
            Choose another way
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="agentStart">
      {said}
      <div className="agentStart-intro">
        <h3 className="z-subheading">Sign in to {name}</h3>
        <p>
          {name} is installed, and not signed in on this computer.
          {props.methods.length > 0 ? ' Choose how it signs in.' : ''}
        </p>
      </div>
      {props.methods.length === 0 ? (
        <p className="z-form-help">
          It offers no way to sign in from here. Sign in to it in a terminal, then start it again.
        </p>
      ) : (
        <section className="agentStart-section" aria-label="Ways to sign in">
          {props.methods.map((way, index) => (
            <div key={way.id} className="agentCard">
              <div className="agentCard-head">
                <div className="agentCard-name">
                  <strong>{way.name}</strong>
                  {way.description && <span>{way.description}</span>}
                </div>
                <button
                  type="button"
                  className={index === 0 ? 'z-button' : 'z-button z-button-secondary'}
                  aria-label={`Sign in with ${way.name}`}
                  onClick={() => props.onSignIn(way)}
                >
                  Sign in
                </button>
              </div>
            </div>
          ))}
        </section>
      )}
      <button
        type="button"
        className="z-button z-button-secondary agentSignIn-back"
        onClick={props.onBack}
      >
        Back
      </button>
      <p className="agentStart-foot">
        The sign-in is {name}&rsquo;s own, kept where it keeps it. Zasper stores none of it.
      </p>
    </div>
  );
}
