import { Icon } from '@/ide/icons';
import { useTooltip } from '@/ide/overlays';
import Tooltip from '@/ide/Tooltip';
import { useAskTrust, useRestricted } from '@/store/trust';

/**
 * The status bar's first item while the folder is not trusted. In the bar's own ink: a warning colour on
 * the bar fails contrast in some themes, and the shield and the word say it.
 */
export default function RestrictedStatus() {
  const restricted = useRestricted();
  const ask = useAskTrust();
  const tip = useTooltip();
  if (!restricted) {
    return null;
  }
  return (
    <>
      <button
        type="button"
        className="statusItem statusButton"
        onClick={() => ask({ reason: 'open' })}
        {...tip.anchorProps}
      >
        <Icon name="shield" size={12} /> Restricted
      </button>
      <Tooltip
        tip={tip}
        label="Restricted mode: this folder's code does not run until you trust it"
      />
    </>
  );
}
