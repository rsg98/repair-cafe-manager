# Volunteer Directory & Merge CLI (`merge-volunteers`)

This guide explains how to use the **`merge-volunteers`** command-line utility (`functions/src/scripts/mergeVolunteers.ts`) to inspect the Repair Café Volunteer Register from your terminal and merge duplicate or auto-enrolled historical volunteer records across all Firestore collections.

> **Companion Documentation:** For details on how legacy Google Forms CSV ingestion auto-enrolls historical volunteers, see **[`docs/HISTORICAL_INGEST_CLI.md`](HISTORICAL_INGEST_CLI.md)**.

---

## 1. How Permissions & Authentication Work (Important)

Unlike the browser-based Front Desk (`/frontdesk`)—which signs in via **Firebase Authentication (Google Sign-In)** and evaluates [`firestore.rules`](../firestore.rules) (`isAdmin()`) and `cafeConfig.organizerEmails`—all four administrator CLI tools (`merge-volunteers`, `manage-sessions`, `ingest-history`, `whatsapp-reconcile`) run locally in Node.js using the **Firebase Admin SDK (`firebase-admin/firestore`)**.

### Key Permission Rules for Admin CLI Scripts:
1. **`firestore.rules` and `firebase login` are NOT used by the Admin SDK:**
   - Running `firebase login` only authenticates the `firebase-tools` deployment CLI (`firebase deploy`).
   - The `firebase-admin` Node SDK bypasses `firestore.rules` completely and authenticates directly against **Google Cloud IAM** using **Application Default Credentials (ADC)**.
2. **You must provide Google Cloud ADC via Option A or Option B:**

#### Option A: Service Account Private Key JSON (Simplest — No `gcloud` Required)
1. Open the **[Firebase Console](https://console.firebase.google.com/)** $\rightarrow$ select your project $\rightarrow$ click the **Gear icon ⚙️ (Project settings)** $\rightarrow$ **Service accounts** tab.
2. Click **Generate new private key** and download the `.json` file to a secure location outside the repository (e.g. `~/.credentials/repair-cafe-admin.json`).
3. In your terminal session before running `npm run merge-volunteers`, export `GOOGLE_APPLICATION_CREDENTIALS`:
   ```bash
   export GOOGLE_APPLICATION_CREDENTIALS="$HOME/.credentials/repair-cafe-admin.json"
   ```

#### Option B: Google Cloud CLI Application Default Credentials (`gcloud`)
If you have the Google Cloud SDK installed, sign in with the Google account that has **Owner**, **Editor**, **Firebase Admin** (`roles/firebase.admin`), or **Cloud Datastore User** (`roles/datastore.user`) IAM permissions on your Firebase project, and set your ADC quota project:
```bash
gcloud auth application-default login
gcloud auth application-default set-quota-project <your-firebase-project-id>
```

---

## 2. How the Target Firebase Project ID Is Resolved

When you run `npm run merge-volunteers`, [`initAdminFirestore()`](../functions/src/scripts/adminFirestore.ts) resolves the target Firebase project ID in the following priority order and prints both the project ID and its source:
`Connected to Firebase project: <projectId> (via <source>)`

1. Explicit `--project <projectId>` CLI flag.
2. Shell environment variables: `FIREBASE_PROJECT_ID`, `GCLOUD_PROJECT`, `GOOGLE_CLOUD_PROJECT`, or `VITE_FIREBASE_PROJECT_ID`.
3. `projects.default` inside the repository's `.firebaserc` file (created by `firebase use --add`).
4. `VITE_FIREBASE_PROJECT_ID` (or `FIREBASE_PROJECT_ID`) inside `.env.local` or `.env` in the repository root.
5. Default fallback: `'sutton-repair-cafe'`.

---

## 3. Why `Error 7: PERMISSION_DENIED` Happens & How to Fix It

If running `npm run merge-volunteers -- --list` fails with **`Error: 7 PERMISSION_DENIED: Missing or insufficient permissions`**, check the line printed immediately above the error (`Connected to Firebase project: <projectId> (via <source>)`):

1. **Cause 1 — Targeting the Wrong Project ID (Default Fallback):**
   - If neither `.firebaserc` nor `.env` is configured and you did not pass `--project`, the script falls back to `'sutton-repair-cafe'`. If your actual Firebase project ID is different (for example, has a numeric suffix like `sutton-repair-cafe-12345`), Google Cloud IAM denies access to `'sutton-repair-cafe'`.
   - **Fix:** Pass `--project <your-project-id>` or set `VITE_FIREBASE_PROJECT_ID=<your-project-id>` in `.env`.
2. **Cause 2 — User ADC Missing or Mismatched Quota Project:**
   - When using `gcloud auth application-default login`, Google Cloud's Firestore API requires a valid quota project on which the Cloud Firestore API is enabled and your user has `serviceusage.services.use`.
   - **Fix:** `initAdminFirestore()` now automatically sets `GOOGLE_CLOUD_QUOTA_PROJECT` to the resolved `projectId`. You can also persist it in your ADC file via:
     ```bash
     gcloud auth application-default set-quota-project <your-firebase-project-id>
     ```
3. **Cause 3 — Wrong Google Account or Missing IAM Role on ADC:**
   - Your active ADC credentials belong to a Google account or service account that is not an IAM `Owner`, `Editor`, `Firebase Admin`, or `Cloud Datastore User` on the target project.
   - **Fix:** Re-run `gcloud auth application-default login` with the Google account that owns the Firebase project, or use a Service Account JSON key via `export GOOGLE_APPLICATION_CREDENTIALS="/path/to/key.json"`.

---

## 4. Command Reference

> **Important (`--` separator):** Always include `--` after `npm run merge-volunteers` so `npm` forwards flags (`--list`, `--from`, `--into`, `--confirm`) to the script.

### 4.1 List All Registered Volunteers (`--list`)

```bash
npm run merge-volunteers -- --list
```

Prints a table of all documents in `volunteers/{volunteerId}` sorted alphabetically by name:
- `id`: Firestore document ID
- `name`: Full display name
- `email`: Email address (or `(none — auto-enrolled)` if created automatically during historical CSV ingestion)
- `isOrganiser`, `isPatTrained`, `inducted`: Role and H&S induction flags
- `whatsappOptIn`, `whatsappStatus`: WhatsApp group consent and sync status

### 4.2 Preview a Volunteer Merge (`--from` / `--into` Dry Run)

By default, running `--from ... --into ...` without `--confirm` performs a **safe read-only dry run**:

```bash
npm run merge-volunteers -- \
  --from "Dave" \
  --into "David Smith" \
  --dry-run
```

Both `--from` and `--into` accept either an **exact Firestore document ID** or a **case-insensitive volunteer display name** (returning a clear disambiguation error if multiple volunteers share the same name).

### 4.3 Execute a Volunteer Merge (`--confirm`)

```bash
npm run merge-volunteers -- \
  --from <sourceIdOrName> \
  --into <targetIdOrName> \
  --confirm
```

### 4.4 What Merging Consolidates Across Firestore

1. **Target Volunteer Profile (`volunteers/{target.id}`):**
   - Preserves `target.id` and `target.name`.
   - Applies logical OR to boolean flags (`isOrganiser`, `isPatTrained`, `inducted`, `whatsappOptIn`) and resolves the highest-priority `whatsappStatus`.
   - Backfills missing optional contact/induction fields (`phone`, `phoneHash`, `email`, `emergencyContactName`, `emergencyContactPhone`, `emergencyContactRelationship`, `inductedAt`, `inductedBy`) from `source` only where `target` is blank.
   - Sets `createdAt = Math.min(target.createdAt, source.createdAt)` and updates `updatedAt`.
2. **Organiser Email Sync (`settings/system`):**
   - Re-synchronises `settings/system.organizerEmails` if `source` or `target` has `isOrganiser: true`.
3. **Session Attendance (`sessions/{sessionId}` & `analytics/{sessionId}`):**
   - Replaces `source.id` with `target.id` (deduplicating if both attended the same session) and updates `analytics/{sessionId}.volunteerCount` if deduplication reduced the session headcount.
4. **Historical Repair & PAT Records (`sessions/{sessionId}/repairs/{repairId}`):**
   - Rewrites `repair.fixerName`, `patInitial.testerName`, and `patFinal.testerName` from `source.name` to `target.name` (supporting comma-separated multi-fixer strings).
5. **Source Deletion (`volunteers/{source.id}`):**
   - Deletes `volunteers/{source.id}` as the final operation of the last batch chunk.
