import React, { useState } from 'react';

interface AvatarProps {
  src?: string;
  name: string;
  size?: 'xs' | 'sm' | 'md' | 'lg' | 'xl';
  isVip?: boolean;
  className?: string;
}

const SIZE_MAP = {
  xs: 'w-7 h-7 text-[11px]',
  sm: 'w-9 h-9 text-xs',
  md: 'w-11 h-11 text-sm',
  lg: 'w-16 h-16 text-lg',
  xl: 'w-24 h-24 text-2xl',
};

export const Avatar: React.FC<AvatarProps> = ({
  src,
  name,
  size = 'md',
  isVip = false,
  className = '',
}) => {
  const [failed, setFailed] = useState(false);
  const initials = (name || 'BM')
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((p) => p[0]?.toUpperCase() || '')
    .join('');

  const vipRing = isVip
    ? 'ring-2 ring-orange-400 ring-offset-2 ring-offset-[#F8F7FB] dark:ring-offset-[#14131D] shadow-[0_0_14px_rgba(249,115,22,0.45)]'
    : 'border border-[#E7E3F0] dark:border-[#252336]';

  if (!src || failed) {
    return (
      <div
        className={`${SIZE_MAP[size]} rounded-full bg-gradient-to-br from-violet-600 via-fuchsia-500 to-orange-500 text-white font-semibold flex items-center justify-center shrink-0 select-none ${vipRing} ${className}`}
        aria-label={name}
      >
        {initials || 'BM'}
      </div>
    );
  }

  return (
    <img
      src={src}
      alt={name}
      loading="lazy"
      decoding="async"
      referrerPolicy="no-referrer"
      onError={() => setFailed(true)}
      className={`${SIZE_MAP[size]} rounded-full object-cover shrink-0 bg-zinc-100 dark:bg-[#1B1928] ${vipRing} ${className}`}
    />
  );
};
