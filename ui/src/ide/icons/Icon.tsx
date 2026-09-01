import React from 'react';
import { useAtom } from 'jotai';

import { themeAtom } from '../../store/Settings';

const defaultDarkFill = '#d2d2d2';
const defaultLightFill = '#272727';

/** Resolves an icon fill for the active theme. */
export function useIconFill(darkFill = defaultDarkFill, lightFill = defaultLightFill): string {
  const [theme] = useAtom(themeAtom);
  return theme === 'dark' ? darkFill : lightFill;
}

export interface IconProps {
  viewBox: string;
  width?: string | number;
  height?: string | number;
  /** Overrides for icons that need more contrast than the default palette. */
  darkFill?: string;
  lightFill?: string;
  className?: string;
  children: React.ReactNode;
}

/**
 * An inline SVG whose fill follows the editor theme, so icons do not each have to
 * read the theme atom themselves.
 */
export default function Icon({
  viewBox,
  width,
  height,
  darkFill,
  lightFill,
  className,
  children,
}: IconProps) {
  const fill = useIconFill(darkFill, lightFill);

  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox={viewBox}
      width={width}
      height={height}
      className={className}
      style={{ fill }}
    >
      {children}
    </svg>
  );
}
