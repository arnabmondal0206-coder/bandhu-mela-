import React from 'react';
import { BadgeCheck } from 'lucide-react';

interface VerifiedBadgeProps {
  className?: string;
  label?: string;
}

export const VerifiedBadge: React.FC<VerifiedBadgeProps> = ({
  className = 'w-4 h-4',
  label = 'Verified account',
}) => {
  return (
    <span title={label} aria-label={label} className="inline-flex items-center shrink-0 text-violet-600 dark:text-violet-400">
      <BadgeCheck className={className} />
    </span>
  );
};
