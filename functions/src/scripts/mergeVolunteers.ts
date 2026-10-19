/**
 * @file functions/src/scripts/mergeVolunteers.ts
 *
 * Administrator CLI script for listing registered volunteers and merging
 * duplicate or auto-enrolled historical volunteer records across `volunteers`,
 * `sessions`, `analytics`, and `sessions/{sessionId}/repairs`.
 */

import { initializeApp, getApps } from 'firebase-admin/app';
import {
  getFirestore,
  Firestore,
  DocumentReference,
} from 'firebase-admin/firestore';
import {
  removeUndefined,
  type RepairItem,
  type Session,
  type SessionAnalytics,
  type Volunteer,
} from './historicalIngestParser';
import {
  buildVolunteerMergePlan,
  findVolunteerByIdOrName,
  parseMergeVolunteersArgs,
  type MergeVolunteersCliOptions,
  type VolunteerMergePlan,
} from './mergeVolunteersArgs';

/** Maximum operations per Firestore writeBatch (strictly under the 500 hard limit). */
const BATCH_CHUNK_SIZE = 400;

/** Union of queued Firestore write operations for chunked batch execution. */
type QueuedBatchOp =
  | {
      type: 'set';
      ref: DocumentReference;
      data: Record<string, unknown>;
      merge?: boolean;
    }
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
Repair Café Volunteer Management & Merge CLI
Usage:
  # List all registered volunteers (highlighting auto-enrolled records)
  npm run merge-volunteers -- --list [--project <projectId>]

  # Preview or execute merging a duplicate volunteer into a canonical volunteer
  npm run merge-volunteers -- \\
    --from <sourceIdOrName> \\
    --into <targetIdOrName> \\
    [--dry-run | --confirm] \\
    [--project <projectId>]
`);
}

/**
 * Loads all documents from the `volunteers` collection, sorted alphabetically by name.
 */
async function fetchAllVolunteers(db: Firestore): Promise<Volunteer[]> {
  const snap = await db.collection('volunteers').get();
  const volunteers: Volunteer[] = snap.docs.map((docSnap) => {
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
  return volunteers.sort((a, b) => a.name.localeCompare(b.name));
}

/**
 * Loads all sessions, analytics, and per-session repair documents for merge planning.
 */
async function fetchSessionsAnalyticsAndRepairs(db: Firestore): Promise<{
  sessions: Session[];
  analytics: SessionAnalytics[];
  repairsBySession: Record<string, RepairItem[]>;
}> {
  const [sessionsSnap, analyticsSnap] = await Promise.all([
    db.collection('sessions').get(),
    db.collection('analytics').get(),
  ]);

  const sessions: Session[] = sessionsSnap.docs.map((docSnap) => ({
    ...(docSnap.data() as Session),
    id: docSnap.id,
  }));

  const analytics: SessionAnalytics[] = analyticsSnap.docs.map((docSnap) => ({
    ...(docSnap.data() as SessionAnalytics),
    sessionId: docSnap.id,
  }));

  // Discover all session IDs across both collections and existing subcollections
  const sessionRefs = await db.collection('sessions').listDocuments();
  const allSessionIds = new Set<string>([
    ...sessions.map((s) => s.id),
    ...sessionRefs.map((r) => r.id),
  ]);

  const repairsBySession: Record<string, RepairItem[]> = {};
  for (const sessionId of allSessionIds) {
    const repairsSnap = await db
      .collection('sessions')
      .doc(sessionId)
      .collection('repairs')
      .get();
    repairsBySession[sessionId] = repairsSnap.docs.map((rDoc) => ({
      ...(rDoc.data() as RepairItem),
      id: rDoc.id,
      sessionId,
    }));
  }

  return { sessions, analytics, repairsBySession };
}

/**
 * Prints the sorted table of all volunteers for `--list`.
 */
function printVolunteersTable(volunteers: Volunteer[]): void {
  console.log(`\nRegistered Volunteers (${volunteers.length}):`);
  if (volunteers.length === 0) {
    console.log('No volunteer records found.');
    return;
  }

  const rows = volunteers.map((v) => ({
    id: v.id,
    name: v.name,
    isPatTrained: v.isPatTrained,
    isOrganiser: v.isOrganiser,
    inducted: v.inducted,
    email: v.email || '',
    emergencyContactName: v.emergencyContactName,
  }));
  console.table(rows);
}

/**
 * Prints a human-readable summary of the planned volunteer merge.
 */
function printMergePlanSummary(
  source: Volunteer,
  target: Volunteer,
  plan: VolunteerMergePlan
): void {
  console.log('\n=== Volunteer Merge Plan ===');
  console.log(`Source (will be deleted): "${source.name}" [${source.id}]`);
  console.log(`Target (will be updated): "${target.name}" [${target.id}]`);
  console.log('\nConsolidated Target Record:');
  console.table([
    {
      id: plan.updatedTarget.id,
      name: plan.updatedTarget.name,
      email: plan.updatedTarget.email || '',
      phone: plan.updatedTarget.phone || '',
      isOrganiser: plan.updatedTarget.isOrganiser,
      isPatTrained: plan.updatedTarget.isPatTrained,
      inducted: plan.updatedTarget.inducted,
      emergencyContactName: plan.updatedTarget.emergencyContactName,
    },
  ]);

  console.log(`Sessions to update:  ${plan.updatedSessions.length}`);
  if (plan.updatedSessions.length > 0) {
    console.table(
      plan.updatedSessions.map((s) => ({
        sessionId: s.sessionId,
        volunteerCount: s.attendingVolunteers.length,
        attendingVolunteerIds: s.attendingVolunteerIds.join(', '),
      }))
    );
  }

  console.log(`Analytics to update: ${plan.updatedAnalytics.length}`);
  if (plan.updatedAnalytics.length > 0) {
    console.table(plan.updatedAnalytics);
  }

  console.log(`Repairs to update:   ${plan.updatedRepairs.length}`);
  if (plan.updatedRepairs.length > 0) {
    console.table(
      plan.updatedRepairs.map((r) => ({
        sessionId: r.sessionId,
        repairId: r.repairId,
        fixerName: r.updates['repair.fixerName'] || '(unchanged)',
        patInitialTester: r.updates['patInitial.testerName'] || '(unchanged)',
        patFinalTester: r.updates['patFinal.testerName'] || '(unchanged)',
      }))
    );
  }
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
        if (op.merge) {
          batch.set(op.ref, op.data, { merge: true });
        } else {
          batch.set(op.ref, op.data);
        }
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
 * Main CLI entrypoint for listing and merging volunteers.
 */
async function main(): Promise<void> {
  const options: MergeVolunteersCliOptions = parseMergeVolunteersArgs(
    process.argv.slice(2)
  );
  if (options.command === 'help') {
    printUsage();
    return;
  }

  const { db, projectId } = initAdminFirestore(options.projectId);
  console.log(`Connected to Firebase project: ${projectId}`);

  const volunteers = await fetchAllVolunteers(db);

  if (options.command === 'list') {
    printVolunteersTable(volunteers);
    return;
  }

  // Resolve source and target volunteers
  const source = findVolunteerByIdOrName(options.from!, volunteers);
  const target = findVolunteerByIdOrName(options.into!, volunteers);

  const { sessions, analytics, repairsBySession } =
    await fetchSessionsAnalyticsAndRepairs(db);

  const plan = buildVolunteerMergePlan({
    source,
    target,
    sessions,
    analytics,
    repairsBySession,
    now: Date.now(),
  });

  printMergePlanSummary(source, target, plan);

  const isPreviewOnly = options.dryRun || !options.confirm;
  if (isPreviewOnly) {
    console.log(
      '\n[DRY RUN] No changes written to Firestore. Pass "--confirm" (without "--dry-run") to execute.'
    );
    return;
  }

  // Build ordered operations list; delete(volunteers/{source.id}) MUST be the very last operation
  const ops: QueuedBatchOp[] = [];

  // 1. Update target volunteer document
  ops.push({
    type: 'set',
    ref: db.collection('volunteers').doc(plan.updatedTarget.id),
    data: removeUndefined(plan.updatedTarget) as unknown as Record<string, unknown>,
  });

  // 2. If source or target is an organiser, sync settings/system.organizerEmails
  if (source.isOrganiser || target.isOrganiser || plan.updatedTarget.isOrganiser) {
    const remainingVolunteers = volunteers
      .filter((v) => v.id !== source.id && v.id !== target.id)
      .concat([plan.updatedTarget]);
    const organizerEmails = remainingVolunteers
      .filter((v) => v.isOrganiser && v.email && v.email.trim().length > 0)
      .map((v) => v.email!.trim().toLowerCase())
      .sort();

    ops.push({
      type: 'set',
      ref: db.collection('settings').doc('system'),
      data: { organizerEmails },
      merge: true,
    });
  }

  // 3. Update sessions referencing source
  for (const sUpdate of plan.updatedSessions) {
    ops.push({
      type: 'update',
      ref: db.collection('sessions').doc(sUpdate.sessionId),
      data: {
        attendingVolunteerIds: sUpdate.attendingVolunteerIds,
        attendingVolunteers: sUpdate.attendingVolunteers.map((v) => removeUndefined(v)),
      },
    });
  }

  // 4. Update analytics documents where volunteerCount changed
  for (const aUpdate of plan.updatedAnalytics) {
    ops.push({
      type: 'update',
      ref: db.collection('analytics').doc(aUpdate.sessionId),
      data: {
        volunteerCount: aUpdate.volunteerCount,
      },
    });
  }

  // 5. Update repair documents referencing source.name
  for (const rUpdate of plan.updatedRepairs) {
    ops.push({
      type: 'update',
      ref: db
        .collection('sessions')
        .doc(rUpdate.sessionId)
        .collection('repairs')
        .doc(rUpdate.repairId),
      data: rUpdate.updates as Record<string, unknown>,
    });
  }

  // 6. Enqueue deletion of source volunteer as the very last operation of the final batch chunk
  ops.push({
    type: 'delete',
    ref: db.collection('volunteers').doc(plan.deletedSourceId),
  });

  const chunks = await commitBatchOpsInChunks(db, ops);
  console.log(
    `\n[SUCCESS] Merged "${source.name}" [${source.id}] into "${plan.updatedTarget.name}" [${plan.updatedTarget.id}] ` +
      `(${ops.length} operations across ${chunks} batch chunk(s)).`
  );
}

// Run CLI main entrypoint when invoked directly
main().catch((err: unknown) => {
  const message = err instanceof Error ? err.message : String(err);
  console.error(`Error: ${message}`);
  process.exit(1);
});
