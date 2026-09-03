import { Fragment, useEffect, useRef } from 'react';
import { useAtomValue } from 'jotai';

import { baseName } from '@/paths';
import { projectNameAtom } from '@/store/AppState';
import { useTreeRoot } from './useTreeRoot';

interface CrumbProps {
  label: string;
  /** Where clicking it roots the tree; ignored while it is the folder in view. */
  path: string;
  isCurrent: boolean;
  onOpen: (path: string) => void;
}

function Crumb({ label, path, isCurrent, onOpen }: CrumbProps) {
  // The trail is scrolled to its end and the names on it are cut to fit, so each one says in full
  // where it is.
  const title = path === '' ? 'Project root' : path;
  if (isCurrent) {
    return (
      <span className="crumb is-current" title={title} aria-current="location">
        {label}
      </span>
    );
  }
  return (
    <button type="button" className="crumb" title={title} onClick={() => onOpen(path)}>
      {label}
    </button>
  );
}

/**
 * The trail from the project down to the folder the tree is rooted at, and the way back out of it.
 *
 * The project's own name is the first crumb rather than a label beside the trail: it is the project
 * root, so the two would otherwise say the same thing twice, and it is what a click needs to reach to
 * get all the way back.
 */
export default function Breadcrumb() {
  const projectName = useAtomValue(projectNameAtom);
  const { root, trail, openAsRoot } = useTreeRoot();
  const strip = useRef<HTMLElement | null>(null);

  // The folder in view is the end of the trail, and the panel is not wide enough to hold a deep one.
  useEffect(() => {
    if (strip.current !== null) {
      strip.current.scrollLeft = strip.current.scrollWidth;
    }
  }, [root]);

  return (
    <nav className="pathTrail" aria-label="Folder in view" ref={strip}>
      <Crumb label={projectName} path="" isCurrent={trail.length === 0} onOpen={openAsRoot} />
      {trail.map((path, index) => (
        <Fragment key={path}>
          <span className="crumbSeparator" aria-hidden="true">
            /
          </span>
          <Crumb
            label={baseName(path)}
            path={path}
            isCurrent={index === trail.length - 1}
            onOpen={openAsRoot}
          />
        </Fragment>
      ))}
    </nav>
  );
}
