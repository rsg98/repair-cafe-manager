# Historical Data Ingestion & Volunteer Merge CLI (`ingest-history` & `merge-volunteers`)

**Script Locations:**
* `functions/src/scripts/ingestHistoricalData.ts` (`npm run ingest-history -- <flags>`)
* `functions/src/scripts/mergeVolunteers.ts` (`npm run merge-volunteers -- <flags>`)

**Design Specification:** [`docs/design/historical_data_ingestion.md`](design/historical_data_ingestion.md)

---

## 1. Overview

Before transitioning to the unified Repair Café Session Management PWA, historical sessions were recorded across three separate Google Forms exported as CSV spreadsheets:
1. **`Registration Responses`:** Visitor check-in form outputs.
2. **`Repair Outcomes`:** Volunteer fixer workbench form outputs.
3. **`PAT Tests`:** Electrical safety inspection form outputs.

This administrative CLI suite provides two deterministic, dry-run-safe tools using the **Firebase Admin SDK**:
* **`ingest-history`:** Parses the three local CSV files, snaps late post-event submissions to their official Saturday session date, matches rows by `(sessionDate, cardNumber)`, normalises brand and volunteer names, auto-enrolls missing volunteers into `volunteers/{volunteerId}`, scrubs all visitor PII (`[REDACTED]`), and writes finalized sessions (`sessions/YYYYMMDD-yourspace`, `repairs/*`, `private/customer`, and `analytics/YYYYMMDD-yourspace`).
* **`merge-volunteers`:** Lists registered volunteers (`--list`) and merges duplicate or auto-enrolled historical volunteer records (`--from <sourceIdOrName> --into <targetIdOrName>`) across `volunteers/`, `sessions/`, `analytics/`, and `repairs/`.

---

## 2. Prerequisites & Authentication

Both CLI utilities use `firebase-admin` and require **Google Application Default Credentials (ADC)** with Firestore read/write access to your Firebase project.

### Step 1: Authenticate Your Terminal Environment
Provide credentials using **either** of the following methods:

* **Option A — Service Account Key File:**
  Download a Service Account JSON key from **Firebase Console $\rightarrow$ Project Settings $\rightarrow$ Service Accounts** (keep this file outside the git repository) and export its path:
  ```bash
  export GOOGLE_APPLICATION_CREDENTIALS="/path/to/your-service-account-key.json"
  ```
* **Option B — Google Cloud SDK Application Default Login:**
  Authenticate your user account via the Google Cloud CLI:
  ```bash
  gcloud auth application-default login
  ```

### Step 2: Target Project Resolution
Both scripts automatically resolve your Firebase Project ID in the following priority order:
1. Explicit `--project <projectId>` CLI flag.
2. `GCLOUD_PROJECT` or `GOOGLE_CLOUD_PROJECT` environment variable.
3. `projects.default` inside the repository's `.firebaserc` file.

---

## 3. Tool 1: Historical CSV Ingestion (`ingest-history`)

### 3.1 Command & Flag Reference

Always include `--` after `npm run ingest-history` so `npm` forwards the flags to the script:

```bash
npm run ingest-history -- \
  --registrations <path/to/registrations.csv> \
  --outcomes <path/to/outcomes.csv> \
  --pat <path/to/pat.csv> \
  [options]
```

| Flag | Arguments | Description |
| :--- | :--- | :--- |
| `--registrations` | `<path>` | **Required.** Path to the local `Registration Responses` CSV export. |
| `--outcomes` | `<path>` | **Required.** Path to the local `Repair Outcomes` CSV export. |
| `--pat` | `<path>` | **Required.** Path to the local `PAT Tests` CSV export. |
| `--dry-run` | *(none)* | Parses all CSVs, checks existing Firestore volunteers, and prints the per-session ingestion summary, duplicate card warnings, and volunteer auto-enrollment list without writing to Firestore (default when `--confirm` is omitted). |
| `--confirm` | *(none)* | Executes Firestore batch writes for volunteers, sessions, repairs, redacted customer records, and analytics. |
| `--force` | *(none)* | Resolves duplicate `(sessionDate, cardNumber)` collisions in `Registration Responses` or `Repair Outcomes` by keeping the first chronological submission and dropping subsequent duplicates. Without `--force`, duplicate cards halt `--confirm` so you can review them first. |
| `--overwrite` | *(none)* | Re-ingests and overwrites sessions whose `sessions/YYYYMMDD-yourspace` document already exists in Firestore (by default, existing sessions are skipped). |
| `--project` | `<projectId>` | Overrides the target Firebase Project ID for this invocation. |
| `--help`, `-h` | *(none)* | Prints CLI usage instructions. |

### 3.2 Key Transformation & Safety Rules

1. **Deterministic Session IDs & Late-Submission Date Snapping:**
   * Sessions are created with ID `YYYYMMDD-yourspace` (e.g. `20241109-yourspace`) and display name `<Month> <YYYY> - YourSpace` (e.g. `November 2024 - YourSpace`).
   * Late form submissions entered days after the Saturday event (`2025-10-12` $\rightarrow$ `2025-10-11`, `2026-01-13` $\rightarrow$ `2026-01-10`, `2026-02-15` $\rightarrow$ `2026-02-14`, `2026-03-15` $\rightarrow$ `2026-03-14`) are automatically snapped to their canonical Saturday session date.
2. **Orphan Record Recovery:**
   * Many historical rows exist in `Registration Responses`, `Repair Outcomes`, or `PAT Tests` without corresponding rows in the other sheets.
   * All orphan records are preserved and ingested. Any item without a `Repair Outcomes` row defaults to `outcome: 'FIXED'` (`repairTimeMinutes: 0`, `fixerName: 'Volunteer Team'` or the PAT tester's name) and `status: 'COMPLETED'`.
3. **Chronological PAT 1 & PAT 2 Assignment:**
   * All PAT rows matching `(sessionDate, cardNumber)` are sorted by timestamp. The earliest record populates `patInitial` (`PAT 1`); when two or more PAT records exist for the same card on the same date, the latest record populates `patFinal` (`PAT 2`).
4. **Brand & Volunteer Name Canonicalization:**
   * Brand names are normalised to canonical casing (e.g. `Russel Hobbs` / `RUSSELL HOBBS` $\rightarrow$ `Russell Hobbs`, `GTech` $\rightarrow$ `Gtech`, `Karcher` $\rightarrow$ `Kärcher`) and combined with the item description into `item.brandModel` without duplicating the brand prefix.
   * Compound volunteer entries (`"Luke & Rae"`, `"Rich/Dave"`) are split to track individual session attendance while preserving a clean credit string (`"Luke Colbert & Rae Martin"`).
   * Missing volunteers are auto-registered in `volunteers/vol-hist-<slug>` with `inducted: true` and `isPatTrained: true` (if observed in `PAT Tests`).
5. **Immediate UK GDPR Redaction:**
   * Visitor names from `Registration Responses` are never written to Firestore. Every historical repair item is created directly with `customerName: "[REDACTED]"` and `private/customer.firstName: "[REDACTED]"`.

### 3.3 Operational Recipes (`ingest-history`)

```bash
# 1. Dry-run preview (inspect session counts, orphan counts, duplicate card warnings, and new volunteers)
npm run ingest-history -- \
  --registrations ./exports/registrations.csv \
  --outcomes ./exports/outcomes.csv \
  --pat ./exports/pat.csv \
  --dry-run

# 2. Execute ingestion (resolving duplicate card collisions with --force)
npm run ingest-history -- \
  --registrations ./exports/registrations.csv \
  --outcomes ./exports/outcomes.csv \
  --pat ./exports/pat.csv \
  --force \
  --confirm
```

---

## 4. Tool 2: Volunteer Directory & Merge CLI (`merge-volunteers`)

When historical CSVs contain nickname or single-first-name credits (e.g. `"Dave"`, `"Chris"`, `"Rae Martin"`) that may correspond to an already-enrolled volunteer under a different full name, use `merge-volunteers` to consolidate the duplicate record cleanly across every Firestore collection.

### 4.1 Command & Flag Reference

```bash
npm run merge-volunteers -- <command> [options]
```

| Flag | Arguments | Description |
| :--- | :--- | :--- |
| `--list` | *(none)* | Lists all documents in `volunteers/` sorted by name, showing ID, display name, email, `isOrganiser`, `isPatTrained`, `inducted`, and whether the record was auto-enrolled during historical import (`[HISTORICAL-IMPORT]`). |
| `--from` | `<sourceIdOrName>` | Source volunteer ID (e.g. `vol-hist-dave`) or case-insensitive display name to merge **from** (this volunteer document will be deleted after its references are migrated). |
| `--into` | `<targetIdOrName>` | Target volunteer ID or case-insensitive display name to merge **into** (this volunteer document is retained and enriched). |
| `--dry-run` | *(none)* | Prints the complete merge plan (profile field consolidation, affected sessions, updated `volunteerCount` analytics, and rewritten repair/PAT credits) without modifying Firestore (default when `--confirm` is omitted). |
| `--confirm` | *(none)* | Executes the volunteer merge across `volunteers/`, `sessions/`, `analytics/`, and `repairs/` in chunked Firestore batches. |
| `--project` | `<projectId>` | Overrides the target Firebase Project ID for this invocation. |
| `--help`, `-h` | *(none)* | Prints CLI usage instructions. |

### 4.2 What `merge-volunteers` Updates

1. **Profile Consolidation (`volunteers/{targetId}`):**
   * Preserves all non-empty contact details on `target`, filling any blank `email`, `phone`, or real emergency contact fields from `source` (preferring real emergency contacts over `"Pending (Historical Import)"`).
   * Combines capability booleans via logical OR: `isPatTrained`, `inducted`, and `isOrganiser` (when a valid email is present).
   * Deletes `volunteers/{sourceId}` after all references are updated.
2. **Session Attendance Deduplication (`sessions/{sessionId}`):**
   * Replaces `source.id` with `target.id` in `attendingVolunteerIds` and `attendingVolunteers`, deduplicating if both `source` and `target` were listed in the same session.
3. **Analytics Recount (`analytics/{sessionId}`):**
   * Updates `volunteerCount` whenever deduplicating `source` and `target` changes the number of unique volunteers attending that session.
4. **Token-Safe Credit Rewriting (`sessions/{sessionId}/repairs/{repairId}`):**
   * Splits `repair.fixerName`, `patInitial.testerName`, and `patFinal.testerName` on `&`, `/`, `,`, or `and`, replaces tokens matching `source.name` with `target.name`, deduplicates co-credits (e.g. `"Rae Martin & Rachel Martin"` $\rightarrow$ `"Rachel Martin"`), and rejoins with `" & "`.

### 4.3 Operational Recipes (`merge-volunteers`)

```bash
# 1. List all registered and auto-enrolled volunteers
npm run merge-volunteers -- --list

# 2. Preview merging an auto-enrolled volunteer into an existing volunteer (dry-run)
npm run merge-volunteers -- \
  --from "vol-hist-dave" \
  --into "Dave Smith" \
  --dry-run

# 3. Execute the volunteer merge
npm run merge-volunteers -- \
  --from "vol-hist-dave" \
  --into "Dave Smith" \
  --confirm
```
