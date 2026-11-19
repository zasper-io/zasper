import React, { ReactNode, useRef } from 'react';

import { AgentAccount, AgentMode, SignInMethod } from '@/api';
import { Icon } from '@/ide/icons';
import { useDismissOnEscape, useDismissOnPressOutside, useMenuKeys } from '@/ide/overlays';
import { MenuAction, MenuChoice, MenuGroup, MenuSeparator } from '@/ide/statusBar/StatusMenu';
import { AgentChoiceValue, AgentSetting } from './chatLog';

// The settings that get a chip of their own, in this order. Every other one is under More.
const CHIPS = ['model', 'thought_level', 'mode'];

const ZASPER_MODES: { value: AgentMode; name: string; help: string }[] = [
  { value: 'ask', name: 'Ask every time', help: 'Every question the agent asks is put to you.' },
  {
    value: 'edits',
    name: 'Allow edits',
    help: 'Edits, moves and deletes go ahead without asking.',
  },
  {
    value: 'all',
    name: 'Allow edits and commands',
    help: 'Edits and commands go ahead without asking.',
  },
];

interface Props {
  agent: string;
  settings: AgentSetting[];
  mode: AgentMode;
  disabled: boolean;
  open: string | null;
  onOpen: (id: string | null) => void;
  onSet: (id: string, value: string | boolean) => void;
  onSetMode: (mode: AgentMode) => void;
  /** The agent's name, as the panel shows it. */
  agentName?: string;
  /** Who the agent says it is signed in as. */
  account?: AgentAccount;
  canSignOut?: boolean;
  onSignOut?: () => void;
  /** The agent's terminal ways of signing in, for one that names no account and has no Sign out. */
  signInWays?: SignInMethod[];
  onSignInWith?: (way: SignInMethod) => void;
}

/**
 * The agent's settings for the session, under the composer: a chip for its model, effort and mode, and
 * the rest under More, all as the agent words them. An agent with no mode of its own gets Zasper's,
 * which answers the agent's questions for the reader.
 */
export default function AgentSettings(props: Props) {
  const { settings, open, onOpen } = props;
  const chips = CHIPS.flatMap((category) =>
    settings.filter((setting) => setting.category === category)
  );
  const rest = settings.filter((setting) => !CHIPS.includes(setting.category));
  const signedInAs = props.account?.signed_in ? props.account.label : undefined;
  // An agent that opens a session without signing in never asks for it, so it is offered here.
  const ways =
    signedInAs === undefined && !props.canSignOut
      ? (props.signInWays ?? []).filter((way) => way.kind === 'terminal' && way.command)
      : [];
  const close = () => onOpen(null);

  return (
    <span className="agentComposer-settings">
      {chips.map((setting) =>
        setting.kind === 'choice' ? (
          <Chip
            key={setting.id}
            label={setting.name}
            value={nameOf(setting)}
            plan={setting.category === 'mode' && setting.value === 'plan'}
            open={open === setting.id}
            disabled={props.disabled}
            onToggle={() => onOpen(open === setting.id ? null : setting.id)}
            onClose={close}
            help={setting.category === 'model' ? undefined : helpOf(setting)}
          >
            {grouped(setting.values, (value) => (
              <MenuChoice
                key={value.value}
                label={value.name}
                meta={setting.category === 'model' ? (value.description ?? undefined) : undefined}
                checked={value.value === setting.value}
                onSelect={() => {
                  close();
                  if (value.value !== setting.value) props.onSet(setting.id, value.value);
                }}
              />
            ))}
          </Chip>
        ) : null
      )}
      {!settings.some((setting) => setting.category === 'mode') && (
        <Chip
          label="What the agent may do without asking"
          value={ZASPER_MODES.find((mode) => mode.value === props.mode)?.name ?? props.mode}
          open={open === ':mode'}
          disabled={props.disabled}
          onToggle={() => onOpen(open === ':mode' ? null : ':mode')}
          onClose={close}
          help={ZASPER_MODES.find((mode) => mode.value === props.mode)?.help}
        >
          {ZASPER_MODES.map((mode) => (
            <MenuChoice
              key={mode.value}
              label={mode.name}
              checked={mode.value === props.mode}
              onSelect={() => {
                close();
                props.onSetMode(mode.value);
              }}
            />
          ))}
        </Chip>
      )}
      {(rest.length > 0 || signedInAs !== undefined || props.canSignOut || ways.length > 0) && (
        <More
          agent={props.agentName ?? props.agent}
          settings={rest}
          open={open === ':more'}
          disabled={props.disabled}
          onToggle={() => onOpen(open === ':more' ? null : ':more')}
          onClose={close}
          onSet={props.onSet}
          account={signedInAs}
          signOutLabel={
            props.canSignOut ? `Sign out of ${props.agentName ?? props.agent}` : undefined
          }
          onSignOut={props.onSignOut}
          signInWays={ways}
          onSignInWith={props.onSignInWith}
        />
      )}
    </span>
  );
}

/** A choice's values, under a heading for each group once there is more than one. */
function grouped(
  values: AgentChoiceValue[],
  draw: (value: AgentChoiceValue) => ReactNode
): ReactNode {
  const groups = new Set(values.map((value) => value.group));
  if (groups.size < 2) return values.map(draw);
  return values.map((value, index) => {
    const starts = index === 0 || values[index - 1].group !== value.group;
    return (
      <React.Fragment key={value.value}>
        {starts && index > 0 && <MenuSeparator />}
        {starts && <MenuGroup label={value.group ?? ''} />}
        {draw(value)}
      </React.Fragment>
    );
  });
}

function nameOf(setting: AgentSetting & { kind: 'choice' }): string {
  return setting.values.find((value) => value.value === setting.value)?.name ?? setting.value;
}

// What the selected value does, in the agent's words, or else what the setting is.
function helpOf(setting: AgentSetting & { kind: 'choice' }): string | undefined {
  const selected = setting.values.find((value) => value.value === setting.value);
  return selected?.description ?? setting.description;
}

function Chip(props: {
  label: string;
  value: string;
  plan?: boolean;
  open: boolean;
  disabled: boolean;
  help?: string;
  onToggle: () => void;
  onClose: () => void;
  children: ReactNode;
}) {
  const within = useRef<HTMLSpanElement>(null);
  useDismissOnEscape(props.onClose, props.open);
  useDismissOnPressOutside(within, props.onClose, props.open);
  const menuKeys = useMenuKeys(props.onClose);
  const classes = ['agentSetting', props.plan && 'is-plan', props.open && 'is-open'];

  return (
    <span className="agentSetting-anchor" ref={within}>
      <button
        type="button"
        className={classes.filter(Boolean).join(' ')}
        title={`${props.label}: ${props.value}`}
        aria-label={`${props.label}: ${props.value}`}
        aria-haspopup="menu"
        aria-expanded={props.open}
        disabled={props.disabled}
        onClick={props.onToggle}
      >
        <span className="agentSetting-value">{props.value}</span>
        <Icon name="chevron-down" size={12} />
      </button>
      {props.open && (
        <div className="z-overlay z-menu agentMenu">
          <ul className="z-overlay-list" role="menu" aria-label={props.label} {...menuKeys}>
            {props.children}
          </ul>
          {props.help && <p className="agentMenu-help">{props.help}</p>}
        </div>
      )}
    </span>
  );
}

function More(props: {
  /** The agent's name, as the panel shows it. */
  agent: string;
  settings: AgentSetting[];
  open: boolean;
  disabled: boolean;
  onToggle: () => void;
  onClose: () => void;
  onSet: (id: string, value: string | boolean) => void;
  /** Who the agent is signed in as, and how to sign it out: the menu's last group. */
  account?: string;
  signOutLabel?: string;
  onSignOut?: () => void;
  signInWays: SignInMethod[];
  onSignInWith?: (way: SignInMethod) => void;
}) {
  const within = useRef<HTMLSpanElement>(null);
  useDismissOnEscape(props.onClose, props.open);
  useDismissOnPressOutside(within, props.onClose, props.open);
  const menuKeys = useMenuKeys(props.onClose);
  const label = `More settings for ${props.agent}`;

  return (
    <span className="agentSetting-anchor" ref={within}>
      <button
        type="button"
        className="z-icon-button"
        title={label}
        aria-label={label}
        aria-haspopup="menu"
        aria-expanded={props.open}
        aria-pressed={props.open}
        disabled={props.disabled}
        onClick={props.onToggle}
      >
        <Icon name="sliders-horizontal" />
      </button>
      {props.open && (
        <div className="z-overlay z-menu agentMenu is-right">
          <ul className="z-overlay-list" role="menu" aria-label={label} {...menuKeys}>
            {props.settings.map((setting, index) => (
              <React.Fragment key={setting.id}>
                {index > 0 && <MenuSeparator />}
                {setting.kind === 'switch' ? (
                  <li className="panel-row" role="none">
                    <button
                      type="button"
                      className="panel-row-name"
                      role="menuitemcheckbox"
                      aria-checked={setting.value}
                      title={setting.description}
                      onClick={() => {
                        props.onClose();
                        props.onSet(setting.id, !setting.value);
                      }}
                    >
                      <span className="menuTick">
                        {setting.value && <Icon name="check" size={12} />}
                      </span>
                      <span className="panel-row-label">{setting.name}</span>
                    </button>
                  </li>
                ) : (
                  <>
                    <MenuGroup label={setting.name} />
                    {setting.values.map((value) => (
                      <MenuChoice
                        key={value.value}
                        label={value.name}
                        checked={value.value === setting.value}
                        onSelect={() => {
                          props.onClose();
                          if (value.value !== setting.value) props.onSet(setting.id, value.value);
                        }}
                      />
                    ))}
                  </>
                )}
              </React.Fragment>
            ))}
            {(props.account !== undefined ||
              props.signOutLabel !== undefined ||
              props.signInWays.length > 0) && (
              <>
                {props.settings.length > 0 && <MenuSeparator />}
                <MenuGroup label="Account" />
                {props.account !== undefined && (
                  // Says rather than does, so not an item: a reader moving through the menu skips it.
                  <li className="panel-row agentAccount" role="presentation">
                    <span className="panel-row-name">
                      <span className="menuTick">
                        <Icon name="circle-check" size={12} />
                      </span>
                      <span className="panel-row-label">{props.account}</span>
                      <span className="panel-row-meta">signed in</span>
                    </span>
                  </li>
                )}
                {props.signInWays.map((way) => (
                  <MenuAction
                    key={way.id}
                    label={`${way.name} in a terminal`}
                    icon="terminal"
                    onSelect={() => {
                      props.onClose();
                      props.onSignInWith?.(way);
                    }}
                  />
                ))}
                {props.signOutLabel !== undefined && (
                  <MenuAction
                    label={props.signOutLabel}
                    icon="log-out"
                    onSelect={() => {
                      props.onClose();
                      props.onSignOut?.();
                    }}
                  />
                )}
              </>
            )}
          </ul>
        </div>
      )}
    </span>
  );
}
