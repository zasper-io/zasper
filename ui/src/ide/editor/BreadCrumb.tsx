import React from 'react';
import './Editor.scss';

interface BreadCrumbProps {
  path: string;
}

export default function BreadCrumb(props: BreadCrumbProps) {
  // Paths are relative to the project root, and a top-level file splits to a single segment
  // while a nested one splits to an empty leading segment. Lead with `root` in both cases.
  const crumbs = ['Project Root', ...props.path.split('/').filter((segment) => segment !== '')];

  return (
    <div className="breadcrumbArea">
      <nav aria-label="breadcrumb">
        <ol className="breadcrumb">
          {crumbs.map((item, index) => (
            <li key={index} className="breadcrumb-item">
              {item}
            </li>
          ))}
        </ol>
      </nav>
    </div>
  );
}
