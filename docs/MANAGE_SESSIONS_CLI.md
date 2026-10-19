# Session Maintenance & Purge CLI (`manage-sessions`)

**Script Location:** `functions/src/scripts/manageSessions.ts`  
**NPM Wrapper:** `npm run manage-sessions -- <flags>`  
**Design Specification:** [`docs/design/test_sessions_and_purge.md`](design/test_sessions_and_purge.md)

---

## 1. Overview

The `manage-sessions` command-line utility enables Repair Café administrators to audit, reclassify, and permanently purge historical sessions directly in Cloud Firestore using the **Firebase Admin SDK**.

While Front Desk organisers can flag sessions as **Test / Training** in the web UI (`/frontdesk` and `/reports`) and can discard an *active* test session from the Front Desk banner, historical database cleanup is intentionally isolated to this CLI tool so that finalised sessions cannot be accidentally deleted from a shared reception tablet.

### Key Capabilities
1. **Full Session & Orphan Discovery (`--list`):** Scans `sessions/`, `analytics/`, and phantom `sessions/{id}` document references (via `listDocuments()`) to reveal every session in Firestore—including orphaned `repairs` subcollections left behind if a parent document was manually deleted in the Firebase Console.
2. **Retroactive Classification (`--mark-test` / `--unmark-test`):** Atomically sets `isTest: true` or `isTest: false` across both `sessions/{sessionId}` and `analytics/{sessionId}` so test sessions are immediately excluded from (or restored to) `/reports` KPIs and grant CSV exports.
3. **Bottom-Up Cascading Purge (`--purge` / `--purge-all-test`):** Permanently deletes a session and every nested document in strict bottom-up order:
   * `sessions/{sessionId}/repairs/{repairId}/private/customer` (GDPR PII subcollection)
   * `sessions/{sessionId}/repairs/{repairId}` (repair items)
   * `analytics/{sessionId}` (aggregated reporting snapshot)
   * `sessions/{sessionId}` (session metadata document)
   * Resets `settings/system.activeSessionId` to `null` if the purged session was currently active.

---

## 2. Prerequisites & Authentication

Because `manage-sessions` uses `firebase-admin` to bypass client security rules and inspect orphaned subcollections, it requires **Google Application Default Credentials (ADC)** with Firestore read/write access to your Firebase project.

### Step 1: Authenticate Your Terminal Environment
Provide credentials using **either** of the following methods:

* **Option A — Service Account Key File:**
  Download a Service Account JSON key from **Firebase Console $\rightarrow$ Project Settings $\rightarrow$ Service Accounts** (keep this file outside the git repository) and export its path:
  ```bash
  export GOOGLE_APPLICATION_CREDENTIALS="/path/to/your-service-account-key.json"
  ```
* **Option B — Google Cloud SDK Application Default Login:**
  If you have the Google Cloud SDK installed locally, authenticate your user account:
  ```bash
  gcloud auth application-default login
  ```

### Step 2: Target Project Resolution
The script automatically resolves your Firebase Project ID in the following priority order:
1. Explicit `--project <projectId>` CLI flag.
2. `GCLOUD_PROJECT` or `GOOGLE_CLOUD_PROJECT` environment variable.
3. `projects.default` inside the repository's `.firebaserc` file.

---

## 3. Command & Flag Reference

Always include `--` after `npm run manage-sessions` so `npm` forwards the flags to the script:

```bash
npm run manage-sessions -- <command> [options]
```

| Flag | Arguments | Description |
| :--- | :--- | :--- |
| `--list` | *(none)* | Lists all sessions discovered across `sessions/`, `analytics/`, and orphaned `repairs/` subcollections, showing status, `isTest` classification, total items, repair doc count, and storage presence. |
| `--mark-test` | `<sessionId>` | Marks `<sessionId>` as a test session (`isTest: true`) across any existing `sessions/{sessionId}` and `analytics/{sessionId}` documents. |
| `--unmark-test` | `<sessionId>` | Marks `<sessionId>` as an official session (`isTest: false`) across any existing `sessions/{sessionId}` and `analytics/{sessionId}` documents. |
| `--purge` | `<sessionId>` | Cascades deletion of all `private/customer` docs, `repairs` docs, `analytics/{sessionId}`, and `sessions/{sessionId}` for the specified session. **Defaults to dry-run preview unless `--confirm` is passed.** |
| `--purge-all-test` | *(none)* | Cascades deletion of **every** session currently flagged with `isTest: true`. **Defaults to dry-run preview unless `--confirm` is passed.** |
| `--dry-run` | *(none)* | Explicitly prints the count of documents that *would* be deleted without modifying Firestore (this is the default behavior when `--confirm` is omitted). |
| `--confirm` | *(none)* | Executes destructive writes during `--purge` or `--purge-all-test`. |
| `--force` | *(none)* | Required alongside `--purge <sessionId> --confirm` if the target session is **not** currently flagged with `isTest: true` (for example, an unflagged test session or an orphaned subcollection whose parent docs were already deleted). |
| `--project` | `<projectId>` | Overrides the target Firebase Project ID for this invocation. |

---

## 4. Built-In Safety Guardrails

1. **Read-Only by Default:** Running `--purge` or `--purge-all-test` without `--confirm` never deletes data; it performs a dry run and prints the exact count of `sessions/`, `analytics/`, `repairs/`, and `private/customer` documents that would be removed.
2. **Official Session Protection:** `--purge <sessionId> --confirm` will refuse to delete a session whose `isTest` flag is `false` or `undefined` unless you first run `--mark-test <sessionId>` **or** explicitly pass `--force`.
3. **Path-Traversal Validation:** `<sessionId>` is strictly validated as a single Firestore document ID segment (rejecting `/`, `.`, `..`, or flag strings starting with `--`).
4. **Firestore Batch Chunking:** Repair item and `private/customer` deletions are committed in batches of **200 repair items (400 operations per `WriteBatch`)**, staying safely below Firestore's 500-operation batch limit.

---

## 5. Step-by-Step Operational Recipes

### Recipe 1: Audit All Sessions in Firestore (`--list`)
Run `--list` to inspect every session ID, date, status, test flag, and document location:

```bash
npm run manage-sessions -- --list
```

Example output:
```text
ID                         DATE         STATUS      TEST   ITEMS  REPAIRS  DOCS (S/A)
----------------------------------------------------------------------------------------
2026-10-18-seears          2026-10-18   FINALIZED   no     42     42       S+A
2026-10-15-training        2026-10-15   FINALIZED   YES    6      6        S+A
2026-09-01-orphan          -            ORPHANED    no     3      3        repairs-only
```
* `S+A` indicates both `sessions/{id}` and `analytics/{id}` exist.
* `repairs-only` (`ORPHANED`) indicates that `sessions/{id}` and `analytics/{id}` were deleted manually, but 3 repair documents still exist in `sessions/{id}/repairs`.

---

### Recipe 2: Flag a Historical Session as a Test Session (`--mark-test`)
If a rehearsal or training session was finalized without ticking the **Test / Training Session** checkbox, you can hide it from `/reports` KPIs and CSV exports without deleting its records:

```bash
npm run manage-sessions -- --mark-test 2026-10-15-training
```

To restore a session back to official reporting:
```bash
npm run manage-sessions -- --unmark-test 2026-10-15-training
```

---

### Recipe 3: Permanently Purge a Single Test Session (`--purge`)
Always preview the deletion counts first using `--dry-run`, then execute with `--confirm`:

```bash
# 1. Preview what will be deleted (no changes made)
npm run manage-sessions -- --purge 2026-10-15-training --dry-run

# 2. Permanently delete the test session and all nested subcollections
npm run manage-sessions -- --purge 2026-10-15-training --confirm
```

---

### Recipe 4: Permanently Purge All Test Sessions at Once (`--purge-all-test`)
To clean up every session flagged with `isTest: true` across the database:

```bash
# 1. Preview all test sessions and document counts
npm run manage-sessions -- --purge-all-test --dry-run

# 2. Execute cascading purge across all test sessions
npm run manage-sessions -- --purge-all-test --confirm
```

---

### Recipe 5: Purge an Orphaned or Unflagged Session (`--force`)
If `--list` shows an `ORPHANED` session (`repairs-only`) where the parent `sessions/{id}` and `analytics/{id}` documents no longer exist to hold `isTest: true`, pass `--force` alongside `--confirm`:

```bash
# 1. Preview the orphaned subcollection documents
npm run manage-sessions -- --purge 2026-09-01-orphan --force --dry-run

# 2. Permanently delete the orphaned repairs and private/customer documents
npm run manage-sessions -- --purge 2026-09-01-orphan --force --confirm
```
