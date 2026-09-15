import React, { useMemo } from 'react';
import { useAtom, useAtomValue } from 'jotai';

import { Icon } from '@/ide/icons';
import { useTooltip } from '@/ide/overlays';
import Tooltip from '@/ide/Tooltip';
import { problemsAtom, problemsOpenAtom, serverStatusAtom } from '@/store/languageServers';

/**
 * How many errors and warnings the language servers have reported, across every file, and the way to
 * the Problems panel under the editor. Absent until a server has been started, since a project that
 * never had one has nothing to count.
 */
export default function ProblemCounts() {
  const problems = useAtomValue(problemsAtom);
  const statuses = useAtomValue(serverStatusAtom);
  const [open, setOpen] = useAtom(problemsOpenAtom);
  const tip = useTooltip();

  const counts = useMemo(() => {
    let errors = 0;
    let warnings = 0;
    Object.values(problems).forEach((list) =>
      list.forEach((problem) => {
        if (problem.severity === 'error') {
          errors += 1;
        } else if (problem.severity === 'warning') {
          warnings += 1;
        }
      })
    );
    return { errors, warnings };
  }, [problems]);

  if (Object.keys(statuses).length === 0) {
    return null;
  }

  const said = `${counts.errors} ${counts.errors === 1 ? 'error' : 'errors'}, ${counts.warnings} ${
    counts.warnings === 1 ? 'warning' : 'warnings'
  }`;
  return (
    <>
      <button
        type="button"
        className="statusItem statusButton problemCounts z-tabular"
        aria-label={`${said}. ${open ? 'Hide' : 'Show'} problems`}
        aria-expanded={open}
        onClick={() => setOpen(!open)}
        {...tip.anchorProps}
      >
        <Icon name="circle-x" size={12} /> {counts.errors}
        <Icon name="triangle-alert" size={12} /> {counts.warnings}
      </button>
      <Tooltip tip={tip} label={`${said} — ${open ? 'hide' : 'show'} problems`} />
    </>
  );
}
