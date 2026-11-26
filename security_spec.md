# ChronoSphere Firestore Security Specification

## 1. Data Invariants
1. User profiles (`/users/{userId}`) contain private profile attributes and are strictly readable and writable only by the owning authenticated user (`request.auth.uid == userId`).
2. Personal countdowns (`scope == 'personal'`) are strictly isolated to `ownerId == request.auth.uid` for both `get` and `list`.
3. Collective countdowns (`scope == 'collective'`) are readable by authenticated users (`get` or `list` filtered on `scope == 'collective'` or `ownerId == request.auth.uid`), while structural edits are reserved for `ownerId` and non-owners may only join/leave via `participantIds` on active collective events.
4. Subcollections (`milestones`, `rsvps`, `messages`, `locations`) enforce the Master Gate by inspecting the parent `/countdowns/{countdownId}` document via `get()`. Live `locations` are strictly restricted to active `collective` events and only readable/writable by the event owner or registered `participantIds`, with users only able to write/update their own `locId == request.auth.uid` document.
5. Archived countdowns (`status == 'archived'`) block further edits by non-owners and enforce immutable `ownerId` and `createdAt`.
6. Every string field enforces `.size()` limits, every ID enforces `^[a-zA-Z0-9_\-]+$` (max 128 chars), and every timestamp enforces `request.time`.

## 2. The "Dirty Dozen" Payloads
1. **Unauthenticated read/write**: Missing `request.auth` -> `PERMISSION_DENIED`.
2. **Unverified email write**: `email_verified: false` on create/update -> `PERMISSION_DENIED`.
3. **Owner spoofing on create**: `ownerId: "victim-uid"` != `request.auth.uid` -> `PERMISSION_DENIED`.
4. **Ghost field injection**: Extra `isAdmin: true` key in countdown payload -> `PERMISSION_DENIED` (`hasOnly` rejection).
5. **Oversized ID poisoning**: `countdownId` > 128 chars or containing `/` -> `PERMISSION_DENIED`.
6. **Oversized string DoW**: `title` > 120 chars or `description` > 1200 chars -> `PERMISSION_DENIED`.
7. **Unbounded array injection**: `participantIds` with > 50 elements -> `PERMISSION_DENIED`.
8. **Private countdown scraping**: Non-owner attempting `get` or `list` on `scope: 'personal'` -> `PERMISSION_DENIED`.
9. **Client timestamp forgery**: `createdAt` != `request.time` -> `PERMISSION_DENIED`.
10. **Immutable field mutation**: Non-owner or owner attempting to change `ownerId` or `createdAt` -> `PERMISSION_DENIED`.
11. **RSVP / Location impersonation**: Writing `/rsvps/victimUid` or `/locations/victimUid` as `attackerUid` -> `PERMISSION_DENIED`.
12. **Subcollection orphan/leak**: Reading/writing milestones or locations under an event where the user is not a member or that is `personal` -> `PERMISSION_DENIED`.
