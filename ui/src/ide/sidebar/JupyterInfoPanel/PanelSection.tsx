import { ReactNode, useState } from 'react';

interface PanelSectionProps {
  title: string;
  count: number;
  /**
   * Whether the section starts open. What is running does; a list of what could be run is reference
   * material, and three panels' worth of it unfolded is a panel nobody can find their place in.
   */
  defaultOpen?: boolean;
  children: ReactNode;
}

/**
 * A foldable group of rows inside a panel, with a count in its heading.
 *
 * Kept here rather than in `sidebar/` because this is the only panel with several groups in it so far;
 * the styles it uses are already shared (`.panel-section-*` in styles/_panel.scss), so moving it up is
 * a file move when a second panel wants one.
 */
export default function PanelSection(props: PanelSectionProps) {
  const { title, count, defaultOpen = true, children } = props;
  const [open, setOpen] = useState<boolean>(defaultOpen);

  return (
    <>
      <h2 className="z-subheading panel-section-head">
        <button
          type="button"
          className="panel-section-toggle"
          aria-expanded={open}
          onClick={() => setOpen((shown) => !shown)}
        >
          <i className={open ? 'fas fa-chevron-down' : 'fas fa-chevron-right'} aria-hidden="true" />
          <span>
            {title} <span className="panel-section-count">{count}</span>
          </span>
        </button>
      </h2>
      {open && children}
    </>
  );
}
