import type { ComponentType } from 'react';

interface SocialButtonProps {
  id: string;
  enabled: boolean;
  serverDomain?: string;
  oauthPath?: string;
  href?: string;
  Icon?: ComponentType;
  label: string;
}

const SocialButton = ({
  id,
  enabled,
  serverDomain,
  oauthPath,
  href,
  Icon,
  label,
}: SocialButtonProps) => {
  if (!enabled) {
    return null;
  }

  const destination = href ?? `${serverDomain}/oauth/${oauthPath}`;

  return (
    <div className="mt-2 flex gap-x-2">
      <a
        aria-label={`${label}`}
        className="flex w-full items-center space-x-3 rounded-2xl border border-border-light bg-surface-primary px-5 py-3 text-text-primary transition-colors duration-200 hover:bg-surface-tertiary"
        href={destination}
        data-testid={id}
      >
        {Icon && <Icon />}
        <p>{label}</p>
      </a>
    </div>
  );
};

export default SocialButton;
