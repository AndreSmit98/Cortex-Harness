import type { IconMapProps } from '~/common';
import { cn } from '~/utils';

const CortexIcon = ({ className = '', size = 30 }: IconMapProps) => (
  <img
    src="/assets/cortex-avatar.png"
    alt="Cortex"
    width={size}
    height={size}
    className={cn('h-full w-full rounded-[inherit] object-cover', className)}
  />
);

export default CortexIcon;
