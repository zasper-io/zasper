import React, { RefObject, useEffect, useRef } from 'react';

import { AgentCommand } from './chatLog';
import { usePickerKeys } from './usePickerKeys';

/**
 * The agent's commands whose names hold what was typed after the `/`: the one typed in full first, then
 * those that start with it.
 */
export function matchCommands(commands: AgentCommand[], query: string): AgentCommand[] {
  const typed = query.toLowerCase();
  const holding = commands.filter((command) => command.name.toLowerCase().includes(typed));
  const rank = (command: AgentCommand) => {
    const name = command.name.toLowerCase();
    return name === typed ? 0 : name.startsWith(typed) ? 1 : 2;
  };
  return [0, 1, 2].flatMap((place) => holding.filter((command) => rank(command) === place));
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
  // Typed in full, Enter sends it as it is; Tab still completes it, to type what it takes after.
  const chosen = usePickerKeys(
    props.field,
    matches.length,
    (index) => onPick(matches[index]),
    props.query,
    (index) => matches[index].name.toLowerCase() === props.query.toLowerCase()
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
