/**
 * @file functions/src/scripts/reconcileWhatsApp.ts
 *
 * Administrator CLI script for reconciling a WhatsApp group participant list
 * against the Firestore `volunteers` collection (Issue #43).
 */

import * as fs from 'node:fs';
import { initializeApp, getApps } from 'firebase-admin/app';
import { getFirestore, Firestore } from 'firebase-admin/firestore';
import { removeUndefined, type Volunteer } from './historicalIngestParser';
import {
  buildWhatsAppReconciliationPlan,
  parseWhatsAppParticipantsText,
  parseWhatsAppReconcileArgs,
  type WhatsAppReconcileCliOptions,
  type WhatsAppReconciliationPlan,
} from './whatsappReconcileArgs';

/** Maximum operations per Firestore writeBatch (strictly under the 500 hard limit). */
const BATCH_CHUNK_SIZE = 400;

/**
 * Resolves the target Firebase project ID from CLI options or environment variables
 * and initialises the Firebase Admin Firestore instance.
 */
function initAdminFirestore(explicitProjectId?: string): {
  db: Firestore;
  projectId: string;
} {
  const projectId =
    explicitProjectId ||
    process.env.FIREBASE_PROJECT_ID ||
    process.env.GCLOUD_PROJECT ||
    process.env.VITE_FIREBASE_PROJECT_ID ||
    'sutton-repair-cafe';

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
Repair Café WhatsApp Group Reconciliation CLI (Issue #43)
Usage:
  # Preview reconciliation against a WhatsApp participant export (dry-run by default)
  npm run whatsapp-reconcile -- --file <path-to-participants.txt> [--project <projectId>]

  # Apply status updates (PENDING_ADD <-> ADDED for opted-in volunteers)
  npm run whatsapp-reconcile -- --file <path-to-participants.txt> --confirm [--project <projectId>]

  # Initial setup: also mark matched active volunteers found in the group as opted-in & ADDED
  npm run whatsapp-reconcile -- --file <path-to-participants.txt> --opt-in-matched --confirm [--project <projectId>]
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
      ...(data as Omit<Volunteer, 'id'>),
      id: docSnap.id,
      name: String(data.name || ''),
      phone: data.phone,
      email: data.email,
      emergencyContactName: String(data.emergencyContactName || ''),
      emergencyContactPhone: String(data.emergencyContactPhone || ''),
      emergencyContactRelationship: data.emergencyContactRelationship,
      isOrganiser: Boolean(data.isOrganiser),
      isPatTrained: Boolean(data.isPatTrained),
      inducted: Boolean(data.inducted),
      inductedAt: data.inductedAt,
      inductedBy: data.inductedBy,
      whatsappOptIn: Boolean(data.whatsappOptIn),
      whatsappStatus:
        data.whatsappStatus ||
        (data.whatsappOptIn ? 'PENDING_ADD' : 'NOT_APPLICABLE'),
      phoneHash: data.phoneHash,
      archived: Boolean(data.archived),
      archivedAt: data.archivedAt,
      createdAt: Number(data.createdAt || 0),
      updatedAt: Number(data.updatedAt || 0),
    };
  });
  return volunteers.sort((a, b) => a.name.localeCompare(b.name));
}

/**
 * Prints the reconciliation summary tables to the terminal.
 */
function printReconciliationReport(
  participantCount: number,
  volunteersCount: number,
  plan: WhatsAppReconciliationPlan
): void {
  console.log('\n=== WhatsApp Group Reconciliation Report ===');
  console.log(`Parsed WhatsApp group participants: ${participantCount}`);
  console.log(`Total volunteer records in Firestore: ${volunteersCount}`);
  console.log(`  - Already in sync (ADDED): ${plan.alreadyInSync.length}`);
  console.log(
    `  - Archived volunteers recognised in group (social members): ${plan.matchedArchivedMembers.length}`
  );

  // 1. Group Members With No Volunteer Record
  console.log(
    `\n1. Group Members With NO Volunteer Record (${plan.unrecognisedGroupMembers.length}):`
  );
  if (plan.unrecognisedGroupMembers.length === 0) {
    console.log(
      '   None — all WhatsApp group participants matched an active or archived volunteer record.'
    );
  } else {
    console.table(
      plan.unrecognisedGroupMembers.map((p) => ({
        rawEntry: p.rawEntry,
        normalizedPhone: p.normalizedPhone || '',
        displayName: p.displayName || '',
      }))
    );
  }

  // 2. Opted-in volunteers confirmed in group (PENDING_ADD -> ADDED)
  console.log(
    `\n2. Opted-In Volunteers Found in Group -> Mark ADDED (${plan.pendingAdditionsConfirmed.length}):`
  );
  if (plan.pendingAdditionsConfirmed.length > 0) {
    console.table(
      plan.pendingAdditionsConfirmed.map((v) => ({
        id: v.id,
        name: v.name,
        phone: v.phone || '',
        newStatus: v.whatsappStatus,
      }))
    );
  }

  // 3. Initial setup --opt-in-matched updates
  if (plan.newlyOptedInMatches.length > 0) {
    console.log(
      `\n3. Matched Active Volunteers Opted-In via --opt-in-matched (${plan.newlyOptedInMatches.length}):`
    );
    console.table(
      plan.newlyOptedInMatches.map((v) => ({
        id: v.id,
        name: v.name,
        phone: v.phone || '',
        newStatus: v.whatsappStatus,
      }))
    );
  }

  // 4. Opted-In Active Volunteers Missing from WhatsApp Group
  console.log(
    `\n4. Opted-In Active Volunteers MISSING from WhatsApp Group (${plan.missingFromGroup.length}):`
  );
  if (plan.missingFromGroup.length > 0) {
    console.table(
      plan.missingFromGroup.map((v) => ({
        id: v.id,
        name: v.name,
        phone: v.phone || '(no phone)',
        status: v.whatsappStatus,
      }))
    );
  }

  // 5. Active Volunteers Not Opted-In (or Pending Removal) Still in Group
  if (plan.optedOutStillInGroup.length > 0) {
    console.log(
      `\n5. Active Volunteers Not Opted-In (or Pending Removal) Still in WhatsApp Group (${plan.optedOutStillInGroup.length}):`
    );
    console.table(
      plan.optedOutStillInGroup.map((v) => ({
        id: v.id,
        name: v.name,
        phone: v.phone || '',
        whatsappOptIn: Boolean(v.whatsappOptIn),
        whatsappStatus: v.whatsappStatus || 'NOT_APPLICABLE',
      }))
    );
  }
}

/**
 * Main CLI entrypoint for WhatsApp group reconciliation.
 */
async function main(): Promise<void> {
  const options: WhatsAppReconcileCliOptions = parseWhatsAppReconcileArgs(
    process.argv.slice(2)
  );
  if (options.command === 'help') {
    printUsage();
    return;
  }

  const rawText = fs.readFileSync(options.filePath!, 'utf8');
  const participants = parseWhatsAppParticipantsText(rawText);

  const { db, projectId } = initAdminFirestore(options.projectId);
  console.log(`Connected to Firebase project: ${projectId}`);

  const volunteers = await fetchAllVolunteers(db);
  const plan = buildWhatsAppReconciliationPlan({
    participants,
    volunteers,
    optInMatched: options.optInMatched,
    now: Date.now(),
  });

  printReconciliationReport(participants.length, volunteers.length, plan);

  if (plan.firestoreUpdates.length === 0) {
    console.log('\nNo Firestore volunteer status updates required.');
    return;
  }

  const isPreviewOnly = options.dryRun || !options.confirm;
  if (isPreviewOnly) {
    console.log(
      `\n[DRY RUN] ${plan.firestoreUpdates.length} volunteer record(s) would be updated. Pass "--confirm" (without "--dry-run") to write changes to Firestore.`
    );
    return;
  }

  let committedChunks = 0;
  for (let i = 0; i < plan.firestoreUpdates.length; i += BATCH_CHUNK_SIZE) {
    const chunk = plan.firestoreUpdates.slice(i, i + BATCH_CHUNK_SIZE);
    const batch = db.batch();
    for (const v of chunk) {
      batch.set(
        db.collection('volunteers').doc(v.id),
        removeUndefined(v) as unknown as Record<string, unknown>,
        { merge: true }
      );
    }
    await batch.commit();
    committedChunks++;
  }

  console.log(
    `\n[SUCCESS] Updated WhatsApp status on ${plan.firestoreUpdates.length} volunteer record(s) across ${committedChunks} batch chunk(s).`
  );
}

main().catch((err: unknown) => {
  const message = err instanceof Error ? err.message : String(err);
  console.error(`Error: ${message}`);
  process.exit(1);
});
