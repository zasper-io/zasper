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
      {/* The label stays: it is what names the trail to a screen reader, and it is the one thing
          here that was never Bootstrap's. The two class names were — see Editor.scss. */}
      <nav aria-label="breadcrumb">
        <ol>
          {crumbs.map((item, index) => (
            <li key={index}>{item}</li>
          ))}
        </ol>
      </nav>
    </div>
  );
}
