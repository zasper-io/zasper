import React, { RefObject, useEffect, useRef } from 'react';

import { AgentCommand } from './chatLog';
import { usePickerKeys } from './usePickerKeys';

/** The agent's commands whose names hold what was typed after the `/`, those that start with it first. */
export function matchCommands(commands: AgentCommand[], query: string): AgentCommand[] {
  const typed = query.toLowerCase();
  const holding = commands.filter((command) => command.name.toLowerCase().includes(typed));
  const starting = (command: AgentCommand) => command.name.toLowerCase().startsWith(typed);
  return [...holding.filter(starting), ...holding.filter((command) => !starting(command))];
}

/** The agent's commands, opened by a `/` at the start of a message, in the list `@` opens. */
export default function CommandPicker(props: {
  commands: AgentCommand[];
  query: string;
  onPick: (command: AgentCommand) => void;
  field: RefObject<HTMLTextAreaElement | null>;
}) {
  const matches = matchCommands(props.commands, props.query);
  const { onPick } = props;
  const chosen = usePickerKeys(
    props.field,
    matches.length,
    (index) => onPick(matches[index]),
    props.query
  );
  const list = useRef<HTMLDivElement>(null);

  // An agent can list dozens: the one chosen by the keys is kept in view.
  useEffect(() => {
    list.current?.querySelector('[aria-selected="true"]')?.scrollIntoView?.({ block: 'nearest' });
  }, [chosen, matches.length]);

  return (
    <div className="agentPicker" role="listbox" aria-label="Commands" ref={list}>
      {matches.length === 0 ? (
        <p className="agentPicker-hint">No command is called that</p>
      ) : (
        matches.map((command, index) => (
          <button
            type="button"
            role="option"
            key={command.name}
            aria-selected={index === chosen}
            className="panel-row"
            title={command.description}
            // Before the field's blur, which would close the list under the pointer.
            onMouseDown={(event) => {
              event.preventDefault();
              onPick(command);
            }}
          >
            <span className="agentCommand">/{command.name}</span>
            <span className="panel-row-meta">{command.description}</span>
          </button>
        ))
      )}
    </div>
  );
}
