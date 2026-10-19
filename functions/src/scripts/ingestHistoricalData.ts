/**
 * @file functions/src/scripts/ingestHistoricalData.ts
 *
 * Administrator CLI script for ingesting historical Sutton Repair Café Google Forms
 * CSV exports (`Registration Responses`, `Repair Outcomes`, `PAT Tests`) into
 * finalized, GDPR-redacted `YYYYMMDD-yourspace` sessions in Cloud Firestore.
 */

import * as fs from 'fs';
import * as path from 'path';
import { initializeApp, getApps } from 'firebase-admin/app';
import {
  getFirestore,
  Firestore,
  DocumentReference,
} from 'firebase-admin/firestore';
import {
  buildHistoricalIngestionPlan,
  parseIngestHistoricalArgs,
  removeUndefined,
  type HistoricalIngestionPlan,
  type IngestHistoricalCliOptions,
  type PlannedHistoricalSession,
  type Volunteer,
} from './historicalIngestParser';

/** Maximum operations per Firestore writeBatch (strictly under the 500 hard limit). */
const BATCH_CHUNK_SIZE = 400;

/** Union of queued Firestore write operations for chunked batch execution. */
type QueuedBatchOp =
  | { type: 'set'; ref: DocumentReference; data: Record<string, unknown> }
  | { type: 'update'; ref: DocumentReference; data: Record<string, unknown> }
  | { type: 'delete'; ref: DocumentReference };

/**
 * Resolves the target Firebase project ID from CLI options or environment variables
 * and initializes the Firebase Admin Firestore instance.
 */
function initAdminFirestore(explicitProjectId?: string): { db: Firestore; projectId: string } {
  // Prioritize --project flag, then standard Firebase/Google Cloud environment variables
  const projectId =
    explicitProjectId ||
    process.env.FIREBASE_PROJECT_ID ||
    process.env.GCLOUD_PROJECT ||
    process.env.VITE_FIREBASE_PROJECT_ID ||
    'sutton-repair-cafe';

  // Initialize the default Admin app once for the resolved project ID
  if (getApps().length === 0) {
    initializeApp({ projectId });
  }
  return { db: getFirestore(), projectId };
}

/**
 * Prints CLI usage instructions for administrators.
 */
function printUsage(): void {
  console.log(`
Repair Café Historical Data Ingestion CLI
Usage:
  npm run ingest-history -- \\
    --registrations <path/to/Registration_Responses.csv> \\
    --outcomes <path/to/Repair_Outcomes.csv> \\
    --pat <path/to/PAT_Tests.csv> \\
    [--dry-run | --confirm] \\
    [--force] \\
    [--overwrite] \\
    [--project <projectId>]
`);
}

/**
 * Reads a UTF-8 CSV file from disk and throws a clear error if missing.
 */
function readCsvFile(filePath: string, label: string): string {
  const resolved = path.resolve(process.cwd(), filePath);
  if (!fs.existsSync(resolved)) {
    throw new Error(`${label} CSV file not found at "${resolved}".`);
  }
  return fs.readFileSync(resolved, 'utf8');
}

/**
 * Loads existing `volunteers` records and existing `sessions` document IDs from Firestore.
 */
async function loadFirestoreBaseline(
  db: Firestore,
  allowOfflineDryRunFallback: boolean
): Promise<{ existingVolunteers: Volunteer[]; existingSessionIds: Set<string> }> {
  try {
    const [volunteersSnap, sessionRefs, analyticsSnap] = await Promise.all([
      db.collection('volunteers').get(),
      db.collection('sessions').listDocuments(),
      db.collection('analytics').get(),
    ]);

    const existingVolunteers: Volunteer[] = volunteersSnap.docs.map((docSnap) => {
      const data = docSnap.data() as Partial<Volunteer>;
      return {
        id: docSnap.id,
        name: String(data.name || ''),
        phone: data.phone,
        email: data.email,
        emergencyContactName: String(data.emergencyContactName || 'Pending'),
        emergencyContactPhone: String(data.emergencyContactPhone || '00000000000'),
        emergencyContactRelationship: data.emergencyContactRelationship,
        isOrganiser: Boolean(data.isOrganiser),
        isPatTrained: Boolean(data.isPatTrained),
        inducted: Boolean(data.inducted),
        inductedAt: data.inductedAt,
        inductedBy: data.inductedBy,
        createdAt: Number(data.createdAt || 0),
        updatedAt: Number(data.updatedAt || 0),
      };
    });

    const existingSessionIds = new Set<string>([
      ...sessionRefs.map((ref) => ref.id),
      ...analyticsSnap.docs.map((d) => d.id),
    ]);

    return { existingVolunteers, existingSessionIds };
  } catch (err: unknown) {
    if (allowOfflineDryRunFallback) {
      const reason = err instanceof Error ? err.message : String(err);
      console.warn(
        `[DRY RUN WARNING] Could not read live Firestore baseline (${reason}). Proceeding with empty baseline.`
      );
      return { existingVolunteers: [], existingSessionIds: new Set<string>() };
    }
    throw err;
  }
}

/**
 * Collects bottom-up deletion ops (`photos/*`, `private/customer`, `repairs/*`)
 * for an existing session when `--overwrite` is enabled.
 */
async function collectOverwriteCleanupOps(
  db: Firestore,
  sessionId: string
): Promise<QueuedBatchOp[]> {
  const repairsCol = db.collection('sessions').doc(sessionId).collection('repairs');
  const repairRefs = await repairsCol.listDocuments();
  const leafOps: QueuedBatchOp[] = [];
  const repairOps: QueuedBatchOp[] = [];

  for (const repairRef of repairRefs) {
    const photoSnap = await repairRef.collection('photos').get();
    photoSnap.docs.forEach((pDoc) => {
      leafOps.push({ type: 'delete', ref: pDoc.ref });
    });
    leafOps.push({
      type: 'delete',
      ref: repairRef.collection('private').doc('customer'),
    });
    repairOps.push({ type: 'delete', ref: repairRef });
  }

  return [...leafOps, ...repairOps];
}

/**
 * Commits an ordered array of {@link QueuedBatchOp} items in chunks of `<= 400`.
 */
async function commitBatchOpsInChunks(
  db: Firestore,
  ops: QueuedBatchOp[]
): Promise<number> {
  let committedChunks = 0;
  for (let i = 0; i < ops.length; i += BATCH_CHUNK_SIZE) {
    const chunk = ops.slice(i, i + BATCH_CHUNK_SIZE);
    const batch = db.batch();
    for (const op of chunk) {
      if (op.type === 'set') {
        batch.set(op.ref, op.data);
      } else if (op.type === 'update') {
        batch.update(op.ref, op.data);
      } else {
        batch.delete(op.ref);
      }
    }
    await batch.commit();
    committedChunks++;
  }
  return committedChunks;
}

/**
 * Prints the per-session summary table, volunteer enrollment summary, and duplicate warnings.
 */
function printIngestionSummary(
  plan: HistoricalIngestionPlan,
  sessionsToWrite: PlannedHistoricalSession[],
  skippedSessionIds: string[]
): void {
  console.log('\n=== Historical Sessions Summary ===');
  const rows = plan.sessions.map((s) => ({
    sessionId: s.session.id,
    date: s.session.date,
    action: skippedSessionIds.includes(s.session.id) ? 'SKIP (exists)' : 'WRITE',
    totalItems: s.analytics.totalItems,
    fixed: s.analytics.repairedCount,
    partial: s.analytics.partialCount,
    unfixable: s.analytics.unfixableCount,
    advice: s.analytics.adviceCount,
    takenHome: s.analytics.takenHomeCount,
    patTested: s.analytics.patTestedCount,
    weightKg: s.analytics.totalWeightDivertedKg,
    volunteers: s.analytics.volunteerCount || 0,
  }));
  console.table(rows);

  if (plan.droppedDuplicates.length > 0) {
    console.log(
      `\n=== Dropped Same-Session Duplicate Cards (--force: ${plan.droppedDuplicates.length}) ===`
    );
    console.table(plan.droppedDuplicates);
  }

  console.log(
    `\nSessions to write: ${sessionsToWrite.length} (skipped existing: ${skippedSessionIds.length})`
  );
  console.log(
    `Auto-enrolled new volunteers: ${plan.newVolunteers.length}` +
      (plan.newVolunteers.length > 0
        ? ` (${plan.newVolunteers.map((v) => `${v.name} [${v.id}]`).join(', ')})`
        : '')
  );
  console.log(
    `Existing volunteers upgraded to isPatTrained=true: ${plan.upgradedPatVolunteerIds.length}` +
      (plan.upgradedPatVolunteerIds.length > 0
        ? ` (${plan.upgradedPatVolunteerIds.join(', ')})`
        : '')
  );
}

/**
 * Executes the historical CSV ingestion workflow.
 */
async function main(): Promise<void> {
  const options: IngestHistoricalCliOptions = parseIngestHistoricalArgs(
    process.argv.slice(2)
  );
  if (options.command === 'help') {
    printUsage();
    return;
  }

  // 1. Read the three local CSV exports
  const registrationsCsv = readCsvFile(options.registrationsPath!, 'Registration Responses');
  const outcomesCsv = readCsvFile(options.outcomesPath!, 'Repair Outcomes');
  const patCsv = readCsvFile(options.patPath!, 'PAT Tests');

  // 2. Connect to Firestore and load existing volunteers and session IDs
  const { db, projectId } = initAdminFirestore(options.projectId);
  console.log(`Connected to Firebase project: ${projectId}`);
  const isPreviewOnly = options.dryRun || !options.confirm;
  const { existingVolunteers, existingSessionIds } = await loadFirestoreBaseline(
    db,
    isPreviewOnly
  );

  // 3. Build deterministic ingestion plan
  const now = Date.now();
  const plan = buildHistoricalIngestionPlan({
    registrationsCsv,
    outcomesCsv,
    patCsv,
    existingVolunteers,
    force: options.force,
    now,
  });

  // Abort with non-zero exit code if same-session card collisions exist and --force is omitted
  if (plan.collisions.length > 0 && !options.force) {
    console.error(
      `\n[COLLISION ERROR] Found ${plan.collisions.length} same-session duplicate card number collision(s).`
    );
    console.table(plan.collisions);
    console.error(
      'Re-run with "--force" to keep the first record for each colliding card and drop the duplicate row(s).'
    );
    process.exit(1);
  }

  // 4. Filter sessions based on existing session IDs and --overwrite flag
  const sessionsToWrite: PlannedHistoricalSession[] = [];
  const skippedSessionIds: string[] = [];
  for (const planned of plan.sessions) {
    if (existingSessionIds.has(planned.session.id) && !options.overwrite) {
      console.log(
        `[SKIP] Session ${planned.session.id} already exists (pass --overwrite to replace)`
      );
      skippedSessionIds.push(planned.session.id);
    } else {
      sessionsToWrite.push(planned);
    }
  }

  // 5. Print summary and exit if in dry-run mode or --confirm was omitted
  printIngestionSummary(plan, sessionsToWrite, skippedSessionIds);
  if (isPreviewOnly) {
    console.log(
      '\n[DRY RUN] No changes written to Firestore. Pass "--confirm" (without "--dry-run") to execute.'
    );
    return;
  }

  // 6. Commit in 3 ordered batch queues (<= 400 operations per batch)
  const volunteerOps: QueuedBatchOp[] = [];
  for (const vol of plan.newVolunteers) {
    volunteerOps.push({
      type: 'set',
      ref: db.collection('volunteers').doc(vol.id),
      data: removeUndefined(vol) as unknown as Record<string, unknown>,
    });
  }
  for (const volId of plan.upgradedPatVolunteerIds) {
    volunteerOps.push({
      type: 'update',
      ref: db.collection('volunteers').doc(volId),
      data: { isPatTrained: true, updatedAt: now },
    });
  }

  const repairOps: QueuedBatchOp[] = [];
  const rootSessionOps: QueuedBatchOp[] = [];

  for (const planned of sessionsToWrite) {
    const sessionId = planned.session.id;
    if (options.overwrite && existingSessionIds.has(sessionId)) {
      const cleanupOps = await collectOverwriteCleanupOps(db, sessionId);
      repairOps.push(...cleanupOps);
    }

    const repairsCol = db.collection('sessions').doc(sessionId).collection('repairs');
    for (const { repairItem, privateCustomer } of planned.repairs) {
      const repairRef = repairsCol.doc(repairItem.id);
      const privateRef = repairRef.collection('private').doc('customer');
      repairOps.push({
        type: 'set',
        ref: repairRef,
        data: removeUndefined(repairItem) as unknown as Record<string, unknown>,
      });
      repairOps.push({
        type: 'set',
        ref: privateRef,
        data: removeUndefined(privateCustomer) as unknown as Record<string, unknown>,
      });
    }

    rootSessionOps.push({
      type: 'set',
      ref: db.collection('sessions').doc(sessionId),
      data: removeUndefined(planned.session) as unknown as Record<string, unknown>,
    });
    rootSessionOps.push({
      type: 'set',
      ref: db.collection('analytics').doc(sessionId),
      data: removeUndefined(planned.analytics) as unknown as Record<string, unknown>,
    });
  }

  const q1Chunks = await commitBatchOpsInChunks(db, volunteerOps);
  const q2Chunks = await commitBatchOpsInChunks(db, repairOps);
  const q3Chunks = await commitBatchOpsInChunks(db, rootSessionOps);

  console.log(
    `\n[SUCCESS] Historical ingestion complete: ` +
      `${sessionsToWrite.length} sessions, ` +
      `${volunteerOps.length} volunteer ops (${q1Chunks} batches), ` +
      `${repairOps.length} repair/redaction ops (${q2Chunks} batches), ` +
      `${rootSessionOps.length} session/analytics ops (${q3Chunks} batches).`
  );
}

// Run CLI main entrypoint when invoked directly
main().catch((err: unknown) => {
  const message = err instanceof Error ? err.message : String(err);
  console.error(`Error: ${message}`);
  process.exit(1);
});
