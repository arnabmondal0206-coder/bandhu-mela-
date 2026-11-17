# BANDHU MELA — Security Specification & Payload TDD

## 1. Data Invariants

1. **PII Isolation**: `email`, `phoneNumber`, and `role` MUST reside exclusively under `/users/{userId}/private/{docId}` and NEVER in `/users/{userId}`. Only the owner (`request.auth.uid == userId`) or a verified admin may read `/users/{userId}/private/{docId}`.
2. **Identity Integrity**: Every user-authored entity (`Post`, `PostComment`, `Follow`, `FriendRequest`, `ChatMessage`, `Notification`, `Block`, `Report`) MUST enforce `incoming().authorId == request.auth.uid` (or `senderId`, `followerId`, `blockerId`, `reporterId`, `actorId`) on create, and keep ownership fields immutable on update.
3. **Verified Authentication**: All client write operations require `request.auth != null && request.auth.token.email_verified == true`.
4. **Privilege Escalation Prevention**: Users cannot create `/admins/{userId}` documents, cannot set `role: 'admin'` in `/users/{userId}/private/info`, and cannot set `isSuspended: true` or arbitrary counters on profile creation.
5. **Private Messaging & Block Enforcement**: Only the two participants (`participantA`, `participantB`) of a `/conversations/{conversationId}` room may read or send messages in `/conversations/{conversationId}/messages/{messageId}`, and creating a message is denied if either participant has blocked the other in `/blocks/{blockerId}_{blockedId}`.
6. **Atomic Interaction Counters**: Liking/unliking a post requires an atomic batch modifying both `/posts/{postId}/likes/{uid}` and `likesCount` (`+1` or `-1`), enforced via `existsAfter()`.
7. **Terminal State Locking**: A `FriendRequest` with status `accepted` or `declined`, or a `Report` with status `resolved` or `dismissed`, cannot be mutated by non-admin users.
8. **Temporal Integrity & Path Hardening**: All `createdAt` and `updatedAt` timestamps must match `request.time`, all document IDs must match `^[a-zA-Z0-9_\-]+$` with length `<= 260`, and every string field enforces explicit `size()` limits.

## 2. The "Dirty Dozen" Adversarial Payloads

1. **P1 — Unverified Email Spoof**: User with `email: "arnabmondal0206@gmail.com"` and `email_verified: false` tries to update a moderation report or write a post. Expected: `PERMISSION_DENIED`.
2. **P2 — Cross-Owner PII Read**: Authenticated User B performs `get` on `/users/userA/private/info`. Expected: `PERMISSION_DENIED`.
3. **P3 — Self-Assigned Admin Role**: User A attempts to create `/users/userA/private/info` with `role: "admin"` or create `/admins/userA`. Expected: `PERMISSION_DENIED`.
4. **P4 — Shadow Field / Ghost Key Injection**: User A creates `/posts/post1` with an extra shadow field `isFeatured: true` or `isVerified: true`. Expected: `PERMISSION_DENIED`.
5. **P5 — Author Identity Spoofing**: User A tries to create `/posts/post2` with `authorId: "userB"`. Expected: `PERMISSION_DENIED`.
6. **P6 — Post Counter Manipulation**: User A updates `/posts/post1` to set `likesCount: 999999` without a matching atomic `/likes/userA` creation. Expected: `PERMISSION_DENIED`.
7. **P7 — Orphaned Subcollection Write**: User A tries to create `/posts/nonexistent_post/comments/c1`. Expected: `PERMISSION_DENIED`.
8. **P8 — Chat Eavesdropping / Outsider List**: User C (not in `participants`) tries to read or list `/conversations/userA_userB/messages`. Expected: `PERMISSION_DENIED`.
9. **P9 — Blocked User Chat Bypass**: User A has blocked User B (`/blocks/userA_userB` exists); User B tries to create a message in `/conversations/userA_userB/messages/m1`. Expected: `PERMISSION_DENIED`.
10. **P10 — Friend Request State Shortcutting / Tampering**: Sender User A tries to update `/friendRequests/userA_userB` directly to `status: "accepted"` instead of receiver User B. Expected: `PERMISSION_DENIED`.
11. **P11 — Terminal Report Re-open**: Non-admin reporter tries to update `/reports/rep1` from `status: "resolved"` back to `"open"`. Expected: `PERMISSION_DENIED`.
12. **P12 — ID Poisoning / Resource Exhaustion**: User A attempts to create `/posts/` with a 500-character document ID containing invalid characters (`../../admin`) or a 10,000-character `caption`. Expected: `PERMISSION_DENIED`.
