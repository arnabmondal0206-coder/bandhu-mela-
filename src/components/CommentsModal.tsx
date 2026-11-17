import React, { useEffect, useState } from 'react';
import { Send, Trash2, X } from 'lucide-react';
import { addPostComment, deletePostComment, formatRelativeTime, subscribePostComments } from '../lib/socialApi';
import { Post, PostComment, UserProfile } from '../types/social';
import { Avatar } from './Avatar';

interface CommentsModalProps {
  post: Post;
  currentUser: UserProfile;
  onClose: () => void;
  onSelectUser: (uid: string) => void;
}

export const CommentsModal: React.FC<CommentsModalProps> = ({
  post,
  currentUser,
  onClose,
  onSelectUser,
}) => {
  const [comments, setComments] = useState<PostComment[]>([]);
  const [text, setText] = useState('');
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const unsub = subscribePostComments(post.id, setComments);
    return () => unsub();
  }, [post.id]);

  const handleSend = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!text.trim() || sending) return;
    setError(null);
    setSending(true);
    try {
      await addPostComment(post, currentUser, text);
      setText('');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not post comment');
    } finally {
      setSending(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm flex items-end sm:items-center justify-center sm:p-4">
      <div className="w-full sm:max-w-lg bg-white dark:bg-[#171B1E] border border-[#E4DFD5] dark:border-[#262C30] rounded-t-3xl sm:rounded-3xl overflow-hidden flex flex-col max-h-[82vh]">
        <div className="px-5 py-4 border-b border-[#E4DFD5] dark:border-[#262C30] flex items-center justify-between">
          <div>
            <h3 className="font-display text-base font-bold">Comments</h3>
            <p className="text-xs text-zinc-500">@{post.authorUsername}</p>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close comments"
            className="w-10 h-10 rounded-full flex items-center justify-center hover:bg-zinc-100 dark:hover:bg-zinc-800 cursor-pointer"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-5 space-y-4">
          {comments.length === 0 ? (
            <p className="text-sm text-zinc-500 text-center py-8">
              No comments yet. Start the conversation.
            </p>
          ) : (
            comments.map((comment) => (
              <div key={comment.id} className="flex items-start gap-3">
                <button
                  type="button"
                  onClick={() => {
                    onClose();
                    onSelectUser(comment.authorId);
                  }}
                  className="shrink-0 cursor-pointer"
                >
                  <Avatar src={comment.authorPhoto} name={comment.authorName} size="sm" />
                </button>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 text-xs">
                    <button
                      type="button"
                      onClick={() => {
                        onClose();
                        onSelectUser(comment.authorId);
                      }}
                      className="font-semibold text-zinc-950 dark:text-white hover:text-[#0D6E6E] cursor-pointer"
                    >
                      {comment.authorName}
                    </button>
                    <span className="text-zinc-400">·</span>
                    <span className="text-zinc-500">{formatRelativeTime(comment.createdAt)}</span>
                  </div>
                  <p className="text-sm text-zinc-800 dark:text-zinc-200 mt-0.5 break-words">
                    {comment.text}
                  </p>
                </div>
                {comment.authorId === currentUser.uid && (
                  <button
                    type="button"
                    onClick={() => deletePostComment(post.id, comment.id)}
                    aria-label="Delete comment"
                    className="w-9 h-9 rounded-lg flex items-center justify-center text-zinc-400 hover:text-red-600 cursor-pointer"
                  >
                    <Trash2 className="w-4 h-4" />
                  </button>
                )}
              </div>
            ))
          )}
        </div>

        {error && (
          <p className="px-4 py-2 text-xs text-red-600 dark:text-red-400">{error}</p>
        )}

        <form
          onSubmit={handleSend}
          className="p-4 border-t border-[#E4DFD5] dark:border-[#262C30] flex items-center gap-2"
        >
          <Avatar src={currentUser.photoURL} name={currentUser.displayName} size="sm" />
          <input
            type="text"
            value={text}
            maxLength={1000}
            onChange={(e) => setText(e.target.value)}
            placeholder="Write a thoughtful comment..."
            className="flex-1 h-11 px-4 rounded-xl bg-[#F7F5F0] dark:bg-[#0E1113] text-sm focus:outline-none focus:ring-2 focus:ring-[#0D6E6E]/30"
          />
          <button
            type="submit"
            disabled={!text.trim() || sending}
            aria-label="Send comment"
            className="w-11 h-11 rounded-xl bg-[#0D6E6E] text-white flex items-center justify-center hover:bg-[#095454] disabled:opacity-50 cursor-pointer"
          >
            <Send className="w-4 h-4" />
          </button>
        </form>
      </div>
    </div>
  );
};
