import React, { useState } from 'react';
import { Flag, X } from 'lucide-react';
import { submitReport } from '../lib/socialApi';
import { UserProfile } from '../types/social';

interface ReportModalProps {
  reporter: UserProfile;
  targetType: 'post' | 'user' | 'comment';
  targetId: string;
  targetOwnerId: string;
  targetLabel: string;
  onClose: () => void;
  onSubmitted: () => void;
}

const REASONS = [
  'Spam or misleading content',
  'Harassment or bullying',
  'Inappropriate or explicit media',
  'Impersonation or fake account',
  'Hate speech or violence',
];

export const ReportModal: React.FC<ReportModalProps> = ({
  reporter,
  targetType,
  targetId,
  targetOwnerId,
  targetLabel,
  onClose,
  onSubmitted,
}) => {
  const [reason, setReason] = useState(REASONS[0]);
  const [details, setDetails] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSubmitting(true);
    try {
      await submitReport({
        reporter,
        targetType,
        targetId,
        targetOwnerId,
        reason,
        details,
      });
      onSubmitted();
      onClose();
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm flex items-center justify-center p-4">
      <div className="w-full max-w-md bg-white dark:bg-[#171B1E] border border-[#E4DFD5] dark:border-[#262C30] rounded-3xl overflow-hidden">
        <div className="px-6 py-4 border-b border-[#E4DFD5] dark:border-[#262C30] flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Flag className="w-4 h-4 text-amber-600" />
            <h3 className="font-display text-base font-bold">Report {targetType}</h3>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="w-10 h-10 rounded-full flex items-center justify-center hover:bg-zinc-100 dark:hover:bg-zinc-800 cursor-pointer"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="p-6 space-y-4">
          <p className="text-xs text-zinc-500">
            Reporting <span className="font-semibold text-zinc-800 dark:text-zinc-200">{targetLabel}</span> to BANDHU MELA moderators.
          </p>

          <div className="space-y-2">
            {REASONS.map((item) => (
              <label
                key={item}
                className="flex items-center gap-3 p-3 rounded-xl border border-[#E4DFD5] dark:border-[#262C30] cursor-pointer hover:bg-zinc-50 dark:hover:bg-zinc-900"
              >
                <input
                  type="radio"
                  name="reason"
                  checked={reason === item}
                  onChange={() => setReason(item)}
                  className="accent-[#0D6E6E]"
                />
                <span className="text-sm">{item}</span>
              </label>
            ))}
          </div>

          <textarea
            rows={3}
            maxLength={1000}
            value={details}
            onChange={(e) => setDetails(e.target.value)}
            placeholder="Optional context for moderators..."
            className="w-full p-3 rounded-xl border border-[#E4DFD5] dark:border-[#262C30] bg-[#F7F5F0] dark:bg-[#0E1113] text-sm focus:outline-none focus:ring-2 focus:ring-[#0D6E6E]/30 resize-none"
          />

          <div className="flex justify-end gap-3">
            <button
              type="button"
              onClick={onClose}
              className="h-11 px-4 rounded-xl text-sm font-medium text-zinc-600 dark:text-zinc-400 cursor-pointer"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={submitting}
              className="h-11 px-5 rounded-xl bg-[#0D6E6E] text-white text-sm font-semibold hover:bg-[#095454] cursor-pointer disabled:opacity-60"
            >
              {submitting ? 'Submitting...' : 'Submit Report'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};
