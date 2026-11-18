import React, { useState } from 'react';

import { SignInMethod } from '@/api';
import IconButton from '@/ide/IconButton';
import { Icon } from '@/ide/icons';

export interface SignInProps {
  /** The agent's name, as the panel shows it. */
  name: string;
  methods: SignInMethod[];
  /** The terminal way being finished; none while one is chosen. */
  method?: SignInMethod;
  /** A word above the ways: signed out, still not signed in. */
  notice?: { text: string; failed: boolean };
  /** With the key the reader typed, for a way that takes one. */
  onSignIn: (method: SignInMethod, key?: string) => void;
  onShowTerminal: () => void;
  onTryAgain: () => void;
  onChooseAnother: () => void;
  onBack: () => void;
}

/**
 * An agent that will not go on until someone signs in: the ways it offers, in its own words and order.
 * A terminal way is the agent's own program, run in a Zasper terminal with the command typed in so what
 * runs is in front of the reader, and then this says where to finish; a way the agent carries out itself
 * starts the chat with it. The sign-in is the agent's; Zasper keeps none of it.
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
            <Way key={way.id} way={way} primary={index === 0} onSignIn={props.onSignIn} />
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

/**
 * One way of signing in, as a card. A way that takes a key asks for it in the card first, rather than
 * starting at once.
 */
function Way(props: {
  way: SignInMethod;
  primary: boolean;
  onSignIn: (method: SignInMethod, key?: string) => void;
}) {
  const { way } = props;
  const [asking, setAsking] = useState(false);
  const [key, setKey] = useState('');
  const named = (
    <div className="agentCard-name">
      <strong>{way.name}</strong>
      {way.description && <span>{way.description}</span>}
    </div>
  );

  if (asking) {
    return (
      <form
        className="agentCard"
        onSubmit={(event) => {
          event.preventDefault();
          if (key.trim()) props.onSignIn(way, key.trim());
        }}
      >
        {named}
        <div className="z-form-field">
          <label className="z-form-label" htmlFor={`agent-key-${way.id}`}>
            Key
          </label>
          <input
            id={`agent-key-${way.id}`}
            className="z-field"
            type="password"
            autoComplete="off"
            spellCheck={false}
            autoFocus
            value={key}
            onChange={(event) => setKey(event.target.value)}
          />
          <p className="z-form-help">Stored in the machine&rsquo;s keychain, where there is one.</p>
        </div>
        <div className="agentSignIn-actions">
          <button
            type="submit"
            className="z-button"
            aria-label={`Sign in with ${way.name}`}
            disabled={!key.trim()}
          >
            Sign in
          </button>
          <button
            type="button"
            className="z-button z-button-secondary"
            onClick={() => {
              setAsking(false);
              setKey('');
            }}
          >
            Cancel
          </button>
        </div>
      </form>
    );
  }

  return (
    <div className="agentCard">
      <div className="agentCard-head">
        {named}
        <button
          type="button"
          className={props.primary ? 'z-button' : 'z-button z-button-secondary'}
          aria-label={`Sign in with ${way.name}`}
          onClick={() => (way.takes_key ? setAsking(true) : props.onSignIn(way))}
        >
          Sign in
        </button>
      </div>
    </div>
  );
}
