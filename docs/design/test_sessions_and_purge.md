# Design Specification: Test Session Flagging, Front Desk Discard, and CLI Purge (Issue #24)

**Status:** Goldfish-Validated Specification (Ready for Approval — Phase 3 Complete)  
**Author:** Antigravity & Human Co-Design  
**Related Issue:** [Issue #24 — Test sessions in the database pollute the reporting data](https://github.com/rsg98/repair-cafe-manager/issues/24)

---

## 1. Problem Statement & Objectives

Organisers and volunteers frequently create sessions in the Repair Café Session Management System for software testing, pre-event rehearsals, and volunteer training. Currently:
1. Every session looks identical to a live public event (`isTest` does not exist).
2. Closing a test session at the Front Desk requires running `finalizeSession`, which writes an immutable `analytics/{sessionId}` summary document.
3. `ReportsView` (`/reports`) and `exportAnalyticsToCsv()` aggregate **all** `analytics/{sessionId}` documents unconditionally, polluting cumulative waste-diversion metrics, repair success rates, volunteer hours, and local council / grant funding CSV exports.
4. Deleting a `sessions/{sessionId}` document manually in the Firebase Console leaves orphaned subcollections (`repairs/{repairId}`, `repairs/{repairId}/private/customer`, and `repairs/{repairId}/photos/{photoId}` up to ~140 KB per item) as well as the top-level `analytics/{sessionId}` document.

### Key Objectives
1. **Test Session Flagging (`isTest`):**
   - Allow organisers to mark a session as a **Test / Training Session** (`isTest: true`) when launching a session on the Front Desk (`/frontdesk`), or retroactively toggle `isTest` on finalized sessions in `/reports` (when signed in as an authorised organiser) or via the CLI.
   - Display a clear **`TEST` / `TEST SESSION`** badge in the global `Header` (including mobile/tablet viewports) and `FrontDeskView` whenever a test session is active.
   - Propagate `isTest` to `analytics/{sessionId}` if a test session is finalized.
   - Exclude `isTest === true` sessions by default from all KPI cards, category breakdowns, the Monthly Session Archive table, and the grant CSV export on `/reports` (with an organiser toggle to view/reclassify test sessions).
2. **Active Session "Discard & Purge" Action on Front Desk (`/frontdesk`):**
   - When an active session is marked `isTest: true`, provide a **"Discard & Purge Test Session"** action on the Front Desk that performs a full bottom-up cascading deletion of all nested session data (`photos`, `private/customer`, `repairs`, `analytics`, and `sessions`), resets `settings/system.activeSessionId = null`, clears volunteer PIN `sessionStorage` keys and local IndexedDB cache, and reloads `/frontdesk` without polluting `/reports`.
3. **Administrator Command-Line (CLI) Script (`manageSessions`):**
   - Provide a standalone CLI utility (`functions/src/scripts/manageSessions.ts`, invoked via `npm run manage-sessions -- ...`) using `firebase-admin` that enables an administrator to:
     - `--list`: Inspect all sessions across `sessions/` (including phantom documents with orphaned subcollections via `listDocuments()`) and `analytics/` with their `isTest` status, item counts, and state.
     - `--mark-test <sessionId>` / `--unmark-test <sessionId>`: Flag or unflag existing sessions in the database.
     - `--purge <sessionId>` / `--purge-all-test`: Perform a complete cascading deletion of one or all test sessions (with `--dry-run`, `--confirm`, and `--force` safeguards).

---

## 2. Architecture & Lifecycle Flows

### 2.1 Test Session Lifecycle Diagram

```
[ Front Desk: Start Today's Repair Café ]
  │  [x] Test / Training Session (isTest: true, sessionId suffixed with "-test")
  ▼
sessions/{sessionId} (status: 'ACTIVE', isTest: true)
  │  (Header & Front Desk display amber "TEST SESSION" badge)
  │
  ├──────────────────────────────────────────────────────────────┐
  │ Option A: Discard & Purge (Preferred at end of rehearsal)    │ Option B: Finalize & Redact (To rehearse finalization)
  ▼                                                              ▼
Cascading Delete (Chunked <= 400 ops/batch):                  finalizeSession / finalizeSessionDirectly
  1. sessions/{id}/repairs/{rId}/photos/{pId}                   1. Scrubs PII in repairs & private/customer
  2. sessions/{id}/repairs/{rId}/private/customer               2. Writes analytics/{id} with isTest: true
  3. sessions/{id}/repairs/{rId}                                3. Marks sessions/{id} status: 'FINALIZED'
  4. analytics/{id} (if any)                                    4. ReportsView excludes isTest === true from
  5. sessions/{id}                                                 KPIs, charts, archive table & CSV export
  6. settings/system.activeSessionId = null                        (Can be purged later via CLI --purge-all-test)
  7. Clear client IndexedDB + sessionStorage & reload /frontdesk
```

### 2.2 Cascading Purge Order (Preventing Orphaned Subcollections)

Firestore does not automatically delete subcollections when a parent document is deleted. Both the client-side `purgeSessionCascading` service and the CLI `manageSessions` script MUST enqueue and delete documents bottom-up:

```
Level 3 (Leaves): sessions/{sessionId}/repairs/{repairId}/photos/{photoId}
                  sessions/{sessionId}/repairs/{repairId}/private/customer
                                    │
                                    ▼
Level 2:          sessions/{sessionId}/repairs/{repairId}
                                    │
                                    ▼
Level 1 (Roots):  analytics/{sessionId}
                  sessions/{sessionId}
                  settings/system (if activeSessionId == sessionId -> set null)
```

All Level 3 leaf `DocumentReference`s across all repairs are pushed into the deletion queue **before** Level 2 `repairs/{repairId}` `DocumentReference`s, and committed sequentially in batches of `PURGE_BATCH_CHUNK_SIZE = 400` operations. Level 1 root documents (`analytics/{sessionId}` and `sessions/{sessionId}`) are deleted only after all subcollection batches have committed.

---

## 3. Data Model Changes (`src/types/index.ts`)

Both `Session` and `SessionAnalytics` gain an optional `isTest?: boolean` property. Omitting `isTest` (or setting `isTest: false`) represents a standard official Repair Café session, preserving 100% backward compatibility with existing Firestore documents.

```ts
export interface Session {
  id: string; // e.g., "2026-10-seears" or "2026-10-seears-test"
  name: string; // "October 2026 - Seears Park"
  date: string; // ISO 8601 YYYY-MM-DD
  status: 'ACTIVE' | 'FINALIZED';
  // Optional flag indicating a rehearsal/training session excluded from public impact reports (Issue #24)
  isTest?: boolean;
  // SHA-256 hash of daily 4-digit volunteer PIN and physical card range
  volunteerPinHash: string;
  cardRangeStart: number;
  cardRangeEnd: number;
  // Roster of volunteer IDs and non-PII summaries attending today's session
  attendingVolunteerIds?: string[];
  attendingVolunteers?: SessionVolunteerSummary[];
  createdAt: number;
  finalizedAt?: number;
}

export interface SessionAnalytics {
  sessionId: string;
  sessionName: string;
  date: string;
  // Optional flag indicating a rehearsal/training session excluded from public impact reports (Issue #24)
  isTest?: boolean;
  totalItems: number;
  // ... existing fields unchanged ...
}
```

---

## 4. Service & Backend Specifications

### 4.1 `src/services/sessionService.ts`

1. **`createSession(params)`:**
   - Extend `params` with `isTest?: boolean`.
   - Persist `isTest: Boolean(params.isTest)` on the `Session` document in `sessions/{sessionId}`.
2. **`calculateSessionAnalytics(...)`:**
   - Extend parameters with optional 7th parameter `isTest: boolean = false`:
     ```ts
     export function calculateSessionAnalytics(
       sessionId: string,
       sessionName: string,
       sessionDate: string,
       repairs: RepairItem[],
       now: number = Date.now(),
       volunteerCount: number = 0,
       isTest: boolean = false
     ): SessionAnalytics
     ```
   - Include `isTest: Boolean(isTest)` in the returned `SessionAnalytics` object.
3. **`finalizeSessionDirectly(sessionId: string)`:**
   - Tighten organiser authorization check to require a signed-in email user:
     ```ts
     if (!currentUser?.email || !isAuthorizedOrganizer(currentUser.email, effectiveEmails)) {
       throw new Error('Only authenticated organizers may finalize a Repair Café session.');
     }
     ```
   - Pass `Boolean(sessionData.isTest)` into `calculateSessionAnalytics(...)` so client-side finalization preserves the session's `isTest` flag on `analytics/{sessionId}`.
4. **`setSessionTestStatus(sessionId: string, isTest: boolean): Promise<void>`:**
   - Verifies the current user has a non-empty email and is an authorised organiser (`if (!currentUser?.email || !isAuthorizedOrganizer(currentUser.email, effectiveEmails)) throw new Error(...)`).
   - Reads `[sessionSnap, analyticsSnap] = await Promise.all([getDoc(sessionRef), getDoc(analyticsRef)])`.
   - If neither `sessionSnap.exists()` nor `analyticsSnap.exists()`, throws `new Error(\`Session "\${sessionId}" not found.\`)`.
   - Uses a `writeBatch(db)` and calls `batch.update(ref, { isTest: Boolean(isTest) })` **only** on the document(s) where `snap.exists() === true` (preventing creation of malformed stub documents when updating an active session without an analytics doc or a finalized analytics doc whose session doc was deleted).
5. **`purgeSessionCascading(sessionId: string, options?: { forceNonTest?: boolean }): Promise<{ deletedRepairs: number; deletedPhotos: number }>`:**
   - Rejects execution if offline (`if (typeof navigator !== 'undefined' && !navigator.onLine) throw new Error('Cannot purge a session while offline. Please reconnect to the internet first.')`), ensuring no unsynced offline items are missed.
   - Verifies the current user is an authorised organiser (`if (!currentUser?.email || !isAuthorizedOrganizer(currentUser.email, effectiveEmails))`).
   - Reads `[sessionSnap, analyticsSnap]` via `Promise.all([getDoc(sessionRef), getDoc(analyticsRef)])`.
   - Verifies that the target session is flagged `isTest === true` (`Boolean(sessionSnap.data()?.isTest || analyticsSnap.data()?.isTest)`) unless `options?.forceNonTest === true` is explicitly passed, protecting official sessions from accidental UI deletion.
   - Fetches `sessions/{sessionId}/repairs`.
   - Fetches `photos` subcollections across all repair docs in parallel via `Promise.all(repairsSnap.docs.map((rDoc) => getDocs(collection(db, 'sessions', sessionId, 'repairs', rDoc.id, 'photos'))))`.
   - Builds the ordered deletion queue:
     - First, all Level 3 leaf refs: every `photos/{photoId}` ref and `private/customer` ref across all repairs.
     - Second, all Level 2 `repairs/{rDoc.id}` refs.
   - Commits the deletion queue in chunks of `const PURGE_BATCH_CHUNK_SIZE = 400` operations per `writeBatch(db)`.
   - In a final `writeBatch(db)`:
     - Deletes `analytics/{sessionId}` and `sessions/{sessionId}`.
     - Checks `settings/system`; if `settings?.activeSessionId === sessionId`, calls `batch.set(doc(db, 'settings', 'system'), { activeSessionId: null, allowRegistration: false, organizerEmails: effectiveEmails }, { merge: true })`.
   - Clears any `sessionStorage` keys for the purged session (`volunteer_unlocked_${sessionId}`, `volunteer_token_${sessionId}`).
   - If the purged session was the active session, calls `terminate(db)` and `clearIndexedDbPersistence(db)` (wrapped in `try/catch`) to scrub local IndexedDB cache on the device.

### 4.2 `functions/src/finalizeSession.ts`

- In `finalizeSession`, read `Boolean(sessionData.isTest)` and include `isTest: Boolean(sessionData.isTest)` in `analyticsDoc` when writing `analytics/{sessionId}`.

### 4.3 `src/services/analyticsService.ts`

- Add a pure filtering helper for reporting and CSV export:
  ```ts
  /**
   * Filters session analytics records, excluding test sessions (`isTest === true`)
   * unless `includeTestSessions` is explicitly true.
   */
  export function filterAnalyticsForReporting(
    analyticsList: SessionAnalytics[],
    includeTestSessions = false
  ): SessionAnalytics[] {
    if (includeTestSessions) {
      return analyticsList;
    }
    return analyticsList.filter((a) => !a.isTest);
  }
  ```

### 4.4 `firestore.rules`

- Existing `firestore.rules` already grant `isAdmin()` full `create, update, delete` permissions on `sessions/{sessionId}`, `repairs/{repairId}`, `private/customer`, `photos/{photoId}`, `analytics/{sessionId}`, and `settings/system` without restricting schema keys on `sessions` or `analytics`. No rule changes are required.

---

## 5. UI Changes

### 5.1 Global `Header.tsx` & `FrontDeskView.tsx` Active Test Banner
- **`src/components/layout/Header.tsx`:**
  - When `session?.isTest` is `true`:
    - Render an amber pill badge `TEST` inside the desktop session status pill (`hidden md:flex`).
    - Render a compact mobile `TEST` badge (`md:hidden`) in the header bar so mobile and small portrait tablets at any station immediately see that a test session is active.
- **`src/views/FrontDeskView.tsx`:**
  1. **"Start Today's Repair Café" Modal:**
     - Add checkbox state `const [isTestSession, setIsTestSession] = useState(false);`.
     - Reset `setIsTestSession(false)` whenever opening the modal (at both *"Start Today's Session"* buttons) and on modal close/submit.
     - Render a styled checkbox card inside the form:
       - Label: **"Test / Training Session"**
       - Description: *"Exclude this session from official community impact reports and allow discarding/purging all test data when finished."*
     - When generating `sessionId` in `handleCreateSession`, if `isTestSession` is `true` and `sessionId` does not already end with `-test`, append `-test` (e.g. `20261018-october2026seearspark-test`) so a pre-event test run never collides with or overwrites the official session's deterministic ID on the same day.
     - Pass `isTest: isTestSession` to `createSession(...)`.
  2. **Top Session Management Bar (When `session` is active):**
     - Add state `const [isDiscardingSession, setIsDiscardingSession] = useState(false);` and include `isDiscardingSession` in `isFrontDeskDirty` (passed to `useRegisterUnsavedWork`) alongside `isFinalizing`.
     - If `session.isTest` is `true`, display an amber `TEST SESSION` badge next to `session.name`.
     - When `session.isTest` is `true`, display a **"Discard & Purge Test Session"** button (`bg-rose-700 hover:bg-rose-800 text-white`) alongside *"Finalize & Redact Session"*. Both buttons are disabled while `isFinalizing || isDiscardingSession`.
     - Clicking **"Discard & Purge Test Session"** prompts the organiser with a confirmation dialog explaining that the test session and all its registered test items and photos will be permanently deleted without creating an impact report. On confirm, calls `await purgeSessionCascading(session.id)`, displays a completion alert with the count of deleted test items, and navigates via `window.location.href = '/frontdesk'` so the terminated Firestore client re-initializes cleanly.

### 5.2 `src/views/ReportsView.tsx`
- Import `useAuth` (`const { isAdmin } = useAuth();`), `filterAnalyticsForReporting`, and `setSessionTestStatus`.
- Add state:
  - `const [showTestSessions, setShowTestSessions] = useState(false);`
  - `const [updatingSessionId, setUpdatingSessionId] = useState<string | null>(null);`
- Compute derived lists:
  - `const officialAnalytics = filterAnalyticsForReporting(analyticsList, false);`
  - `const visibleAnalytics = filterAnalyticsForReporting(analyticsList, showTestSessions);`
  - `const testSessionCount = analyticsList.filter((a) => Boolean(a.isTest)).length;`
- **Headline KPIs, Category Breakdown, & CSV Export:**
  - Always compute `totals` from `officialAnalytics`.
  - `"Export CSV for Grants"` button: `disabled={officialAnalytics.length === 0}` and calls `exportAnalyticsToCsv(officialAnalytics)`.
  - `"Volunteer Effort"` card subtitle: `Dedicated by volunteer fixers across {officialAnalytics.length} sessions`.
- **Monthly Session Archive Card Header & Table:**
  - In the card header (always rendered even if `visibleAnalytics.length === 0`), if `isAdmin && testSessionCount > 0`, render a **"Show Test Sessions (`testSessionCount`)"** toggle checkbox/button.
  - Check `visibleAnalytics.length === 0` for the empty-state message (displaying a helpful note if `testSessionCount > 0 && !showTestSessions`).
  - Rows with `a.isTest === true` display an amber `TEST` badge next to `a.sessionName` and subtle muted styling (`bg-amber-50/40 text-slate-500`).
  - When `isAdmin` is `true`, render an **"Actions"** column with a button (`"Mark as Test"` when `!a.isTest`, `"Mark as Official"` when `a.isTest`, disabled while `updatingSessionId === a.sessionId`).
  - Clicking the action button confirms with the organiser, calls `await setSessionTestStatus(a.sessionId, nextIsTest)`, updates `analyticsList` in local React state (`setAnalyticsList((prev) => prev.map((item) => item.sessionId === a.sessionId ? { ...item, isTest: nextIsTest } : item))`), and if `nextIsTest === true`, sets `setShowTestSessions(true)` so the reclassified row remains visible in the table.

---

## 6. Command-Line (CLI) Purge & Management Script

### 6.1 Pure Argument Parser & Root `tsconfig.json` Boundary
- Because root `tsconfig.json` includes `["src", "tests"]` and root `package.json` does not install `firebase-admin` or `@types/node`, tests in `tests/` must **not** import files that depend on `firebase-admin` or Node globals.
- Define the pure CLI argument parser and types in `src/utils/manageSessionsArgs.ts` (and mirror in `functions/src/scripts/manageSessionsArgs.ts`, matching the existing `src/utils/authUtils.ts` + `functions/src/authUtils.ts` pattern):
  ```ts
  export type ManageSessionsCommand =
    | 'list'
    | 'mark-test'
    | 'unmark-test'
    | 'purge'
    | 'purge-all-test'
    | 'help';

  export interface ManageSessionsCliOptions {
    command: ManageSessionsCommand;
    sessionId?: string;
    dryRun: boolean;
    confirm: boolean;
    force: boolean;
    projectId?: string;
  }

  export function parseManageSessionsArgs(argv: string[]): ManageSessionsCliOptions;
  ```
- `parseManageSessionsArgs` validates:
  - Missing or flag-prefixed `<sessionId>` after `--mark-test`, `--unmark-test`, or `--purge` throws a descriptive `Error`.
  - Passing multiple conflicting commands (e.g. both `--list` and `--purge`) throws a descriptive `Error`.

### 6.2 CLI Script Location & Execution
- **Files:**
  - `src/utils/manageSessionsArgs.ts` (pure parser imported by Vitest)
  - `functions/src/scripts/manageSessionsArgs.ts` (pure parser imported by `manageSessions.ts`)
  - `functions/src/scripts/manageSessions.ts` (Admin SDK execution script)
- **Package Scripts (`package.json` & `functions/package.json`):**
  - Root `package.json`: `"manage-sessions": "npm --prefix functions run build && node functions/lib/scripts/manageSessions.js"`
  - `functions/package.json`: `"manage-sessions": "npm run build && node lib/scripts/manageSessions.js"`
- **Project ID Resolution:** Checks `--project <projectId>`, then `process.env.FIREBASE_PROJECT_ID || process.env.GCLOUD_PROJECT || process.env.VITE_FIREBASE_PROJECT_ID || 'sutton-repair-cafe'`.

### 6.3 Supported CLI Flags
```bash
# 1. List all sessions (across sessions/, phantom session docs, and analytics/)
npm run manage-sessions -- --list

# 2. Mark or unmark an existing session as a Test session
npm run manage-sessions -- --mark-test <sessionId>
npm run manage-sessions -- --unmark-test <sessionId>

# 3. Preview purging a specific session or all test sessions (Dry Run)
npm run manage-sessions -- --purge <sessionId> --dry-run
npm run manage-sessions -- --purge-all-test --dry-run

# 4. Execute cascading purge of a specific test session or all test sessions
npm run manage-sessions -- --purge <sessionId> --confirm
npm run manage-sessions -- --purge-all-test --confirm

# 5. Force-purge an official session (if not marked isTest)
npm run manage-sessions -- --purge <sessionId> --force --confirm
```

### 6.4 CLI Implementation Details (`functions/src/scripts/manageSessions.ts`)
- **Phantom Document & Subcollection Discovery:**
  - Uses `await db.collection('sessions').listDocuments()` in addition to `db.collection('sessions').get()` and `db.collection('analytics').get()`.
  - Because `listDocuments()` in `firebase-admin` returns phantom document references (where `sessions/{id}` was manually deleted in the Firebase Console but still has `repairs` subcollections), `--list` and `--purge <id>` can detect and clean up orphaned subcollections left behind by manual console deletions!
- **`--mark-test` / `--unmark-test`:**
  - Checks `.exists` on both `sessions/{sessionId}` and `analytics/{sessionId}` before updating; exits with code `1` if neither document exists.
- **`--purge` & `--purge-all-test`:**
  - If `--purge <sessionId>` is called on a non-test session that has a live `sessions/{id}` or `analytics/{id}` doc without `isTest: true`, requires `--force` (or instructs the operator to run `--mark-test <sessionId>` first).
  - Performs bottom-up cascading deletion in batches of `400` operations (`photos` + `private/customer` $\rightarrow$ `repairs` $\rightarrow$ `analytics` + `sessions` + `settings/system` active pointer reset).

---

## 7. Unit Test Plan (`tests/sessionService.test.ts`)

1. **`calculateSessionAnalytics`:**
   - Defaults `isTest` to `false` when the 7th parameter is omitted.
   - Sets `isTest: true` when the 7th parameter is `true`.
2. **`filterAnalyticsForReporting`:**
   - Excludes records with `isTest: true` by default (`includeTestSessions = false`).
   - Retains records with `isTest: false` or `isTest: undefined` (legacy backward compatibility).
   - Returns all records (including `isTest: true`) when `includeTestSessions = true`.
3. **`exportAnalyticsToCsv` with `filterAnalyticsForReporting`:**
   - Verifies that passing `filterAnalyticsForReporting(records, false)` into `exportAnalyticsToCsv` excludes test sessions from the generated CSV output.
4. **`parseManageSessionsArgs`:**
   - Correctly parses `--list`, `--mark-test <id>`, `--unmark-test <id>`, `--purge <id> --dry-run`, `--purge <id> --confirm`, `--purge <id> --force --confirm`, `--purge-all-test --dry-run`, `--purge-all-test --confirm`, and `--project <id>`.
   - Throws clear errors when `<sessionId>` is missing after `--mark-test`, `--unmark-test`, or `--purge`, or when conflicting commands are passed.
