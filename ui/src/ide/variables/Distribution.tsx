import { ColumnProfile } from '@/api';
import { cellText, formatNumber } from './filters';

const WIDTH = 100;
const HEIGHT = 20;

/**
 * A column's shape, small enough for its header: bars over the range of a number or date column, or a
 * text column's commonest values as one bar split by share, with the commonest named under it.
 */
export default function Distribution({ profile }: { profile: ColumnProfile | undefined }) {
  if (profile === undefined) {
    return <span className="dataGrid-distribution" />;
  }

  const counts = profile.histogram?.counts;
  if (counts !== undefined && counts.length > 0) {
    const tallest = Math.max(...counts, 1);
    const step = WIDTH / counts.length;
    const range =
      profile.min === undefined
        ? ''
        : `${formatNumber(profile.min)} to ${formatNumber(profile.max)}`;
    return (
      <span className="dataGrid-distribution">
        <svg
          viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
          preserveAspectRatio="none"
          role="img"
          aria-label={`Distribution, ${range}`}
        >
          {counts.map((count, index) => {
            const height = count === 0 ? 0 : Math.max(1, (count / tallest) * HEIGHT);
            return (
              <rect
                key={index}
                x={index * step + 0.5}
                y={HEIGHT - height}
                width={Math.max(step - 1, 0.5)}
                height={height}
              />
            );
          })}
        </svg>
      </span>
    );
  }

  const top = profile.top ?? [];
  const present = profile.count - profile.missing;
  if (top.length === 0 || present <= 0) {
    return <span className="dataGrid-distribution" />;
  }
  const shown = top.slice(0, 3);
  const rest = present - shown.reduce((sum, each) => sum + each.count, 0);
  const share = Math.round((top[0].count / present) * 100);
  const distinct = profile.distinct === null ? '' : `${formatNumber(profile.distinct)} distinct · `;

  return (
    <span className="dataGrid-distribution is-text">
      <span className="dataGrid-shares" aria-hidden="true">
        {shown.map((each, index) => (
          <span key={index} style={{ flex: each.count }} />
        ))}
        {rest > 0 && <span className="is-rest" style={{ flex: rest }} />}
      </span>
      <span className="dataGrid-commonest">
        {distinct}
        {cellText(top[0].value)} {share}%
      </span>
    </span>
  );
}
