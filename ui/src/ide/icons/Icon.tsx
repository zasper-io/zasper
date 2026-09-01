import React from 'react';

/**
 * `default` follows --z-fg-svg; `contrast` follows --z-fg-svg-contrast, for
 * icons that sit on a coloured tile and need to read at full strength.
 */
export type IconTone = 'default' | 'contrast';

export interface IconProps {
  viewBox: string;
  width?: string | number;
  height?: string | number;
  tone?: IconTone;
  className?: string;
  children: React.ReactNode;
}

/**
 * An inline SVG whose fill comes from the token layer.
 *
 * The fill is a class, not a style attribute, so it resolves in CSS against the
 * `data-theme` on <html>. That means no icon has to subscribe to the theme atom,
 * and a new theme recolours every icon by declaring two custom properties.
 */
export default function Icon({
  viewBox,
  width,
  height,
  tone = 'default',
  className,
  children,
}: IconProps) {
  const classNames = ['z-icon'];
  if (tone === 'contrast') {
    classNames.push('z-icon-contrast');
  }
  if (className !== undefined) {
    classNames.push(className);
  }

  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox={viewBox}
      width={width}
      height={height}
      className={classNames.join(' ')}
    >
      {children}
    </svg>
  );
}
