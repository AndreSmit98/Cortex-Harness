import { memo } from 'react';
import { useRecoilValue } from 'recoil';
import type { IconProps } from '~/common';
import MessageEndpointIcon from './MessageEndpointIcon';
import { useLocalize } from '~/hooks';
import { cn } from '~/utils';
import store from '~/store';

function getInitials(username: string) {
  const words = username.trim().split(/\s+/).filter(Boolean);
  if (words.length === 0) {
    return 'U';
  }
  if (words.length === 1) {
    return words[0].slice(0, 2).toUpperCase();
  }
  return `${words[0][0]}${words[words.length - 1][0]}`.toUpperCase();
}

const Icon: React.FC<IconProps> = memo((props) => {
  /** Same reason as SteerPart: this renders on the unauthenticated share route,
   *  where `useAuthContext` throws. The atom is the same value in the app. */
  const user = useRecoilValue(store.user);
  const { size = 30, isCreatedByUser } = props;

  const localize = useLocalize();

  if (isCreatedByUser) {
    const username = user?.name ?? user?.username ?? localize('com_nav_user');
    return (
      <div
        title={username}
        aria-label={username}
        style={{ width: size, height: size }}
        className={cn(
          'cortex-user-message-badge relative flex items-center justify-center',
          props.className ?? '',
        )}
      >
        {getInitials(username)}
      </div>
    );
  }
  return <MessageEndpointIcon {...props} />;
});

Icon.displayName = 'Icon';

export default Icon;
