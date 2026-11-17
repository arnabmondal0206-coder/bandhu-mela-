import React from 'react';

interface BandhuLogoProps {
  size?: number;
  className?: string;
  useIconAsset?: boolean;
}

export const BandhuLogo: React.FC<BandhuLogoProps> = ({
  size = 36,
  className = '',
  useIconAsset = false,
}) => {
  if (useIconAsset) {
    return (
      <img
        src="/src/assets/images/bandhu_app_icon_1794819439165.jpg"
        alt="BANDHU MELA App Icon"
        width={size}
        height={size}
        className={`rounded-[26%] object-cover shadow-sm select-none shrink-0 ${className}`}
      />
    );
  }

  const gradId = React.useId();

  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 64 64"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      className={`shrink-0 drop-shadow-sm ${className}`}
      aria-hidden="true"
    >
      <defs>
        <linearGradient id={gradId} x1="6" y1="6" x2="58" y2="58" gradientUnits="userSpaceOnUse">
          <stop offset="0%" stopColor="#7C3AED" />
          <stop offset="52%" stopColor="#EC4899" />
          <stop offset="100%" stopColor="#F97316" />
        </linearGradient>
      </defs>
      <rect width="64" height="64" rx="18" fill={`url(#${gradId})`} />
      {/* Left Friend Arch */}
      <circle cx="22.5" cy="18" r="4.5" stroke="#FFFFFF" strokeWidth="3.2" />
      <path
        d="M12.5 44V33.5C12.5 28.25 16.75 24 22 24C25.8 24 29.1 26.25 30.6 29.5"
        stroke="#FFFFFF"
        strokeWidth="4.2"
        strokeLinecap="round"
      />
      {/* Right Friend Arch */}
      <circle cx="41.5" cy="18" r="4.5" stroke="#FFFFFF" strokeWidth="3.2" />
      <path
        d="M51.5 44V33.5C51.5 28.25 47.25 24 42 24C38.2 24 34.9 26.25 33.4 29.5"
        stroke="#FFFFFF"
        strokeWidth="4.2"
        strokeLinecap="round"
      />
      {/* Central Community Heart Bond */}
      <path
        d="M32 47.5L24.4 40.3C22.2 38.2 22.1 34.7 24.2 32.5C26.3 30.3 29.8 30.3 31.9 32.5L32 32.6L32.1 32.5C34.2 30.3 37.7 30.3 39.8 32.5C41.9 34.7 41.8 38.2 39.6 40.3L32 47.5Z"
        fill="#FFFFFF"
      />
    </svg>
  );
};
