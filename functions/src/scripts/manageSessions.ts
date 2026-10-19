/**
 * @file functions/src/scripts/manageSessions.ts
 *
 * Administrator CLI script for inspecting, classifying (`--mark-test` / `--unmark-test`),
 * and cascading-purging (`--purge` / `--purge-all-test`) Repair Café sessions.
 * Uses the Firebase Admin SDK to detect phantom documents and clean up nested subcollections.
 */

import { initializeApp, getApps } from 'firebase-admin/app';
import {
  getFirestore,
  Firestore,
  DocumentReference,
  DocumentSnapshot,
} from 'firebase-admin/firestore';
import { parseManageSessionsArgs, ManageSessionsCliOptions } from './manageSessionsArgs';

/** Maximum operations per Firestore writeBatch (strictly under the 500 hard limit). */
const PURGE_BATCH_CHUNK_SIZE = 400;

/** Summary of discovered documents for a single session across Firestore collections. */
interface DiscoveredSessionRecord {
  sessionId: string;
  name: string;
  date: string;
  state: 'ACTIVE' | 'FINALIZED' | 'PHANTOM_REPAIRS' | 'ANALYTICS_ONLY';
  isTest: boolean;
  repairsCount: number;
  hasSessionDoc: boolean;
  hasAnalyticsDoc: boolean;
}

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
  // Output supported CLI flags and examples
  console.log(`
Repair Café Session Manager CLI (Issue #24)
Usage:
  npm run manage-sessions -- --list [--project <projectId>]
  npm run manage-sessions -- --mark-test <sessionId> [--project <projectId>]
  npm run manage-sessions -- --unmark-test <sessionId> [--project <projectId>]
  npm run manage-sessions -- --purge <sessionId> [--dry-run | --confirm] [--force]
  npm run manage-sessions -- --purge-all-test [--dry-run | --confirm]
`);
}

/**
 * Discovers all session IDs across live `sessions` docs, phantom `sessions` refs
 * (`listDocuments()`), and `analytics` docs.
 */
async function discoverSessions(db: Firestore): Promise<DiscoveredSessionRecord[]> {
  // Fetch live sessions, phantom session document refs, and analytics snapshots in parallel
  const [sessionRefs, sessionsSnap, analyticsSnap] = await Promise.all([
    db.collection('sessions').listDocuments(),
    db.collection('sessions').get(),
    db.collection('analytics').get(),
  ]);

  // Index live session and analytics documents by ID for fast lookup
  const sessionMap = new Map<string, DocumentSnapshot>(sessionsSnap.docs.map((d) => [d.id, d]));
  const analyticsMap = new Map<string, DocumentSnapshot>(analyticsSnap.docs.map((d) => [d.id, d]));
  const allIds = new Set<string>([
    ...sessionRefs.map((r) => r.id),
    ...sessionMap.keys(),
    ...analyticsMap.keys(),
  ]);

  // Build metadata records for every discovered session ID
  const records: DiscoveredSessionRecord[] = [];
  for (const sessionId of Array.from(allIds).sort()) {
    const sDoc = sessionMap.get(sessionId);
    const aDoc = analyticsMap.get(sessionId);
    const repairRefs = await db
      .collection('sessions')
      .doc(sessionId)
      .collection('repairs')
      .listDocuments();
    records.push(buildDiscoveredRecord(sessionId, sDoc, aDoc, repairRefs.length));
  }
  return records;
}

/**
 * Constructs a single {@link DiscoveredSessionRecord} from optional session and
 * analytics snapshots plus the repair subcollection count.
 */
function buildDiscoveredRecord(
  sessionId: string,
  sDoc: DocumentSnapshot | undefined,
  aDoc: DocumentSnapshot | undefined,
  repairsCount: number
): DiscoveredSessionRecord {
  // Extract fields from session or analytics snapshot with safe fallbacks
  const sData = sDoc?.data();
  const aData = aDoc?.data();
  const hasSessionDoc = Boolean(sDoc?.exists);
  const hasAnalyticsDoc = Boolean(aDoc?.exists);
  const isTest = Boolean(sData?.isTest || aData?.isTest);

  // Determine structural state of the session across collections
  const state: DiscoveredSessionRecord['state'] = hasSessionDoc
    ? sData?.status === 'ACTIVE'
      ? 'ACTIVE'
      : 'FINALIZED'
    : hasAnalyticsDoc
      ? 'ANALYTICS_ONLY'
      : 'PHANTOM_REPAIRS';

  // Return normalized discovery record with the exact subcollection document count
  return {
    sessionId,
    name: String(sData?.name || aData?.sessionName || '(Orphaned / Phantom Session)'),
    date: String(sData?.date || aData?.date || 'N/A'),
    state,
    isTest,
    repairsCount,
    hasSessionDoc,
    hasAnalyticsDoc,
  };
}

/**
 * Prints a formatted table of all discovered sessions in the database.
 */
async function runListCommand(db: Firestore): Promise<void> {
  // Discover all live, analytics-only, and phantom sessions
  const records = await discoverSessions(db);
  if (records.length === 0) {
    console.log('No sessions found in sessions/ or analytics/.');
    return;
  }

  // Format each record into a readable summary row for console.table
  const rows = records.map((r) => ({
    sessionId: r.sessionId,
    date: r.date,
    type: r.isTest ? 'TEST' : 'OFFICIAL',
    state: r.state,
    repairs: r.repairsCount,
    sessionDoc: r.hasSessionDoc ? 'yes' : 'NO',
    analyticsDoc: r.hasAnalyticsDoc ? 'yes' : 'NO',
    name: r.name,
  }));
  console.table(rows);
}

/**
 * Sets or clears `isTest` on an existing session in `sessions/{id}` and/or `analytics/{id}`.
 */
async function runSetTestStatusCommand(
  db: Firestore,
  sessionId: string,
  isTest: boolean
): Promise<void> {
  // Inspect both root documents before attempting an update
  const sessionRef = db.collection('sessions').doc(sessionId);
  const analyticsRef = db.collection('analytics').doc(sessionId);
  const [sessionSnap, analyticsSnap] = await Promise.all([sessionRef.get(), analyticsRef.get()]);

  // Exit with an error if neither document exists in Firestore
  if (!sessionSnap.exists && !analyticsSnap.exists) {
    throw new Error(`Session "${sessionId}" not found in sessions/ or analytics/.`);
  }

  // Update only existing documents in a single atomic batch
  const batch = db.batch();
  if (sessionSnap.exists) {
    batch.update(sessionRef, { isTest });
  }
  if (analyticsSnap.exists) {
    batch.update(analyticsRef, { isTest });
  }
  await batch.commit();
  console.log(`Updated session "${sessionId}" -> isTest: ${isTest}.`);
}

/**
 * Collects all Level 3 leaf refs (`photos` and `private/customer`) and Level 2
 * `repairs` refs under `sessions/{sessionId}` in bottom-up deletion order.
 */
async function collectSubcollectionRefs(
  db: Firestore,
  sessionId: string
): Promise<{ queue: DocumentReference[]; repairsCount: number; photosCount: number }> {
  // Query live or phantom repair document references under the session
  const repairsCol = db.collection('sessions').doc(sessionId).collection('repairs');
  const repairRefs = await repairsCol.listDocuments();
  const leafRefs: DocumentReference[] = [];
  let photosCount = 0;

  // Gather Level 3 photos and private/customer leaf refs for every repair item
  for (const repairRef of repairRefs) {
    const photoSnap = await repairRef.collection('photos').get();
    photosCount += photoSnap.size;
    photoSnap.docs.forEach((pDoc) => leafRefs.push(pDoc.ref));
    leafRefs.push(repairRef.collection('private').doc('customer'));
  }

  // Enqueue Level 3 leaves strictly before Level 2 repair documents
  return {
    queue: [...leafRefs, ...repairRefs],
    repairsCount: repairRefs.length,
    photosCount,
  };
}

/**
 * Commits an ordered list of `DocumentReference` deletions in chunks of
 * {@link PURGE_BATCH_CHUNK_SIZE} operations.
 */
async function commitDeleteQueueInChunks(
  db: Firestore,
  queue: DocumentReference[]
): Promise<void> {
  // Slice the deletion queue into batches of <= 400 operations
  for (let i = 0; i < queue.length; i += PURGE_BATCH_CHUNK_SIZE) {
    const chunk = queue.slice(i, i + PURGE_BATCH_CHUNK_SIZE);
    const batch = db.batch();
    chunk.forEach((ref) => batch.delete(ref));
    await batch.commit();
  }
}

/**
 * Purges a single session bottom-up (or previews the purge in dry-run mode).
 */
async function purgeSingleSession(
  db: Firestore,
  sessionId: string,
  options: { dryRun: boolean; confirm: boolean; force: boolean }
): Promise<void> {
  // Read root documents and active session pointer to validate safety constraints
  const sessionRef = db.collection('sessions').doc(sessionId);
  const analyticsRef = db.collection('analytics').doc(sessionId);
  const settingsRef = db.collection('settings').doc('system');
  const [sessionSnap, analyticsSnap, settingsSnap] = await Promise.all([
    sessionRef.get(),
    analyticsRef.get(),
    settingsRef.get(),
  ]);

  // Guard against accidentally purging an official non-test session without --force
  const hasRootDoc = sessionSnap.exists || analyticsSnap.exists;
  const isTest = Boolean(sessionSnap.data()?.isTest || analyticsSnap.data()?.isTest);
  if (hasRootDoc && !isTest && !options.force) {
    throw new Error(
      `Session "${sessionId}" is not marked as a test session. Run "--mark-test ${sessionId}" first or pass "--force".`
    );
  }

  // Collect all nested Level 3 and Level 2 subcollection references
  const { queue, repairsCount, photosCount } = await collectSubcollectionRefs(db, sessionId);
  if (!hasRootDoc && repairsCount === 0) {
    throw new Error(
      `Session "${sessionId}" not found in sessions/, analytics/, or repairs subcollections.`
    );
  }
  const isActive = settingsSnap.data()?.activeSessionId === sessionId;

  // Report dry-run preview if --dry-run is set or --confirm was omitted
  if (options.dryRun || !options.confirm) {
    console.log(
      `[DRY RUN] Would purge "${sessionId}": ${repairsCount} repairs, ${photosCount} photos, ` +
        `sessionDoc=${sessionSnap.exists}, analyticsDoc=${analyticsSnap.exists}, resetActive=${isActive}. ` +
        `Pass --confirm to execute.`
    );
    return;
  }

  // Commit Level 3 and Level 2 subcollection deletions first, then Level 1 root documents
  await commitDeleteQueueInChunks(db, queue);
  const rootBatch = db.batch();
  rootBatch.delete(analyticsRef);
  rootBatch.delete(sessionRef);
  if (isActive) {
    rootBatch.set(settingsRef, { activeSessionId: null, allowRegistration: false }, { merge: true });
  }
  await rootBatch.commit();
  console.log(`Purged session "${sessionId}" (${repairsCount} repairs, ${photosCount} photos deleted).`);
}

/**
 * Purges all sessions discovered in the database that are flagged with `isTest: true`.
 */
async function runPurgeAllTestCommand(
  db: Firestore,
  options: { dryRun: boolean; confirm: boolean; force: boolean }
): Promise<void> {
  // Discover all sessions and filter down to those marked isTest === true
  const records = await discoverSessions(db);
  const testSessions = records.filter((r) => r.isTest);
  if (testSessions.length === 0) {
    console.log('No test sessions (isTest === true) found to purge.');
    return;
  }

  // Execute or preview cascading purge for each discovered test session sequentially
  for (const record of testSessions) {
    await purgeSingleSession(db, record.sessionId, options);
  }
}

/**
 * Main CLI entrypoint dispatching parsed commands to their Firestore Admin handlers.
 */
async function main(): Promise<void> {
  // Parse command-line arguments passed after the script name
  const options: ManageSessionsCliOptions = parseManageSessionsArgs(process.argv.slice(2));
  if (options.command === 'help') {
    printUsage();
    return;
  }

  // Initialize Firestore Admin SDK for the target project
  const { db, projectId } = initAdminFirestore(options.projectId);
  console.log(`Connected to Firebase project: ${projectId}`);

  // Dispatch to the requested command handler
  if (options.command === 'list') {
    await runListCommand(db);
  } else if (options.command === 'mark-test' && options.sessionId) {
    await runSetTestStatusCommand(db, options.sessionId, true);
  } else if (options.command === 'unmark-test' && options.sessionId) {
    await runSetTestStatusCommand(db, options.sessionId, false);
  } else if (options.command === 'purge' && options.sessionId) {
    await purgeSingleSession(db, options.sessionId, options);
  } else if (options.command === 'purge-all-test') {
    await runPurgeAllTestCommand(db, options);
  }
}

// Run CLI main entrypoint when invoked directly
main().catch((err: unknown) => {
  const message = err instanceof Error ? err.message : String(err);
  console.error(`Error: ${message}`);
  process.exit(1);
});
