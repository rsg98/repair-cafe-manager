/**
 * @file functions/src/finalizeSession.ts
 *
 * Callable Cloud Function (`finalizeSession`) for Repair Café session archiving,
 * UK GDPR Article 5(1)(e) customer PII redaction, and impact analytics compilation.
 */

import { onCall, HttpsError, CallableRequest } from "firebase-functions/v2/https";
import * as admin from "firebase-admin";
import { defaultOrganizerEmails } from "./config";
import { isAuthorizedOrganizer } from "./authUtils";

// Initialize the default Firebase Admin app if not already initialized
if (!admin.apps.length) {
  admin.initializeApp();
}

const db = admin.firestore();

/** Pair of Firestore document references queued for GDPR PII redaction. */
interface RedactionPair {
  repairRef: admin.firestore.DocumentReference;
  privateRef: admin.firestore.DocumentReference;
}

/** Mutable counters accumulated across repair items during session finalization. */
interface FinalizeMetricsAccumulator {
  totalItems: number;
  repairedCount: number;
  partialCount: number;
  unfixableCount: number;
  adviceCount: number;
  takenHomeCount: number;
  totalRepairTimeMinutes: number;
  totalWeightKg: number;
  mainsCount: number;
  patTestedCount: number;
  patFailedCount: number;
  categoryBreakdown: Record<string, number>;
  redactionPairs: RedactionPair[];
}

/**
 * Verifies that the callable request is from an authenticated organiser with an
 * `admin` claim or an email matching configured organiser accounts/domains.
 */
async function verifyOrganizerCaller(request: CallableRequest): Promise<void> {
  // Reject unauthenticated requests immediately
  if (!request.auth || !request.auth.token) {
    throw new HttpsError(
      "unauthenticated",
      "Only authenticated organizers may finalize a Repair Café session."
    );
  }

  // Extract client-supplied and environment-configured organiser email patterns
  const clientEmails = Array.isArray(request.data?.organizerEmails)
    ? (request.data.organizerEmails as unknown[])
        .filter((e): e is string => typeof e === "string")
        .map((e) => e.trim().toLowerCase())
    : [];
  const envEmails = process.env.ORGANIZER_EMAILS
    ? process.env.ORGANIZER_EMAILS.split(",").map((e) => e.trim()).filter(Boolean)
    : [];

  // Read dynamically configured organiser emails from Firestore settings/system
  let firestoreAllowed: string[] = [];
  try {
    const settingsSnap = await db.collection("settings").doc("system").get();
    const data = settingsSnap.data();
    if (settingsSnap.exists && Array.isArray(data?.organizerEmails)) {
      firestoreAllowed = data.organizerEmails;
    }
  } catch (err) {
    console.warn("Could not read organizerEmails from settings/system:", err);
  }

  // Combine configured email patterns or fall back to static defaultOrganizerEmails
  const explicitlyConfigured = [...firestoreAllowed, ...clientEmails, ...envEmails];
  const allowedPatterns =
    explicitlyConfigured.length > 0 ? explicitlyConfigured : defaultOrganizerEmails;
  const callerEmail = request.auth.token.email;
  const isAuthorized =
    Boolean(request.auth.token.admin) ||
    (callerEmail != null && isAuthorizedOrganizer(callerEmail, allowedPatterns));

  // Reject callers lacking an admin claim or authorised organiser email
  if (!isAuthorized) {
    throw new HttpsError(
      "permission-denied",
      "Only authenticated organizers may finalize a Repair Café session."
    );
  }
}

/**
 * Tallies a single repair document into {@link FinalizeMetricsAccumulator} and
 * queues its document references for GDPR redaction.
 */
function tallyRepairDoc(
  acc: FinalizeMetricsAccumulator,
  docSnap: admin.firestore.QueryDocumentSnapshot
): void {
  // Increment total item counter and category breakdown
  acc.totalItems++;
  const data = docSnap.data();
  const cat = data.item?.category || "OTHER";
  acc.categoryBreakdown[cat] = (acc.categoryBreakdown[cat] || 0) + 1;

  // Tally 240V mains power type and diverted weight in kilograms
  if (data.item?.powerType === "MAINS_240V") {
    acc.mainsCount++;
  }
  if (data.item?.weightKg && typeof data.item.weightKg === "number") {
    acc.totalWeightKg += data.item.weightKg;
  }

  // Accumulate fixer repair duration and classify repair outcomes
  if (data.repair) {
    if (data.repair.repairTimeMinutes && typeof data.repair.repairTimeMinutes === "number") {
      acc.totalRepairTimeMinutes += data.repair.repairTimeMinutes;
    }
    // Increment outcome counter matching the fixer's disposition
    if (data.repair.outcome === "FIXED") acc.repairedCount++;
    else if (data.repair.outcome === "PARTIAL") acc.partialCount++;
    else if (data.repair.outcome === "UNFIXABLE") acc.unfixableCount++;
    else if (data.repair.outcome === "ADVICE_GIVEN") acc.adviceCount++;
    else if (data.repair.outcome === "TAKEN_HOME") acc.takenHomeCount++;
  } else if (data.status === "UNFIXABLE") {
    acc.unfixableCount++;
  }

  // Tally PAT electrical safety tests (PAT 1 and/or PAT 2) and safety failures
  if (data.patInitial || data.patFinal) {
    acc.patTestedCount++;
    if (
      data.patInitial?.outcome === "FAIL_REPAIRABLE_CORD" ||
      data.patInitial?.outcome === "DANGER_DO_NOT_ENERGIZE" ||
      data.patFinal?.outcome === "FAIL"
    ) {
      acc.patFailedCount++;
    }
  }

  // Queue repair doc and private/customer doc for chunked GDPR PII redaction
  acc.redactionPairs.push({
    repairRef: docSnap.ref,
    privateRef: docSnap.ref.collection("private").doc("customer"),
  });
}

/**
 * Commits GDPR PII redaction across all repair items in chunks of 200 pairs
 * (400 operations per Firestore batch).
 */
async function commitRedactionPairsInChunks(pairs: RedactionPair[]): Promise<void> {
  // Process 200 repair items (400 writes) per Firestore batch
  const CHUNK_SIZE = 200;
  for (let i = 0; i < pairs.length; i += CHUNK_SIZE) {
    const chunk = pairs.slice(i, i + CHUNK_SIZE);
    const batch = db.batch();
    // Redact visitor name on repair doc and scrub private/customer subcollection
    for (const pair of chunk) {
      batch.update(pair.repairRef, { customerName: "[REDACTED]" });
      batch.update(pair.privateRef, {
        firstName: "[REDACTED]",
        contactPhone: admin.firestore.FieldValue.delete(),
        redactedAt: admin.firestore.FieldValue.serverTimestamp(),
      });
    }
    await batch.commit();
  }
}

/**
 * Builds the `analytics/{sessionId}` document payload from accumulated repair metrics
 * and session metadata (including `isTest`).
 */
function buildAnalyticsSummaryDoc(
  sessionId: string,
  sessionData: admin.firestore.DocumentData,
  acc: FinalizeMetricsAccumulator
): Record<string, unknown> {
  // Compute success rate, mean repair time, and PAT failure rate percentages
  const successRatePercent =
    acc.totalItems > 0 ? Math.round(((acc.repairedCount + acc.partialCount) / acc.totalItems) * 100) : 0;
  const assessedCount =
    acc.repairedCount + acc.partialCount + acc.unfixableCount + acc.adviceCount;
  const averageRepairTimeMinutes =
    assessedCount > 0 ? Math.round(acc.totalRepairTimeMinutes / assessedCount) : 0;
  const patFailureRatePercent =
    acc.patTestedCount > 0 ? Math.round((acc.patFailedCount / acc.patTestedCount) * 100) : 0;

  // Count attending volunteers recorded on the session document
  const volunteerCount = Array.isArray(sessionData.attendingVolunteers)
    ? sessionData.attendingVolunteers.length
    : Array.isArray(sessionData.attendingVolunteerIds)
      ? sessionData.attendingVolunteerIds.length
      : 0;

  // Return the structured session analytics summary payload
  return {
    sessionId,
    sessionName: sessionData.name,
    date: sessionData.date,
    isTest: Boolean(sessionData.isTest),
    totalItems: acc.totalItems,
    repairedCount: acc.repairedCount,
    partialCount: acc.partialCount,
    unfixableCount: acc.unfixableCount,
    // Populate remaining outcome counts, repair durations, diversion weight, and category breakdown
    adviceCount: acc.adviceCount,
    takenHomeCount: acc.takenHomeCount,
    totalRepairTimeMinutes: acc.totalRepairTimeMinutes,
    averageRepairTimeMinutes,
    successRatePercent,
    totalWeightDivertedKg: Math.round(acc.totalWeightKg * 10) / 10,
    categoryBreakdown: acc.categoryBreakdown,
    // Populate electrical PAT safety counters, volunteer count, and server finalization timestamp
    mainsItemsCount: acc.mainsCount,
    patTestedCount: acc.patTestedCount,
    patFailureRatePercent,
    volunteerCount,
    finalizedAt: admin.firestore.FieldValue.serverTimestamp(),
  };
}

/**
 * Callable Cloud Function: `finalizeSession`
 * Verifies organiser authorization, tallies session repairs, scrubs visitor PII in chunks,
 * writes `analytics/{sessionId}`, and marks `sessions/{sessionId}` as `FINALIZED`.
 */
export const finalizeSession = onCall(async (request) => {
  // 1. Verify caller has organiser/admin authorization and validate sessionId
  await verifyOrganizerCaller(request);
  const sessionId = request.data?.sessionId;
  if (!sessionId || typeof sessionId !== "string") {
    throw new HttpsError("invalid-argument", "Valid sessionId must be supplied.");
  }

  // 2. Load the target session document and its repairs subcollection
  const sessionRef = db.collection("sessions").doc(sessionId);
  const sessionSnap = await sessionRef.get();
  if (!sessionSnap.exists) {
    throw new HttpsError("not-found", `Session ${sessionId} was not found.`);
  }
  const sessionData = sessionSnap.data() ?? {};
  const repairsSnap = await sessionRef.collection("repairs").get();

  // 3. Accumulate repair metrics and collect GDPR redaction pairs
  const acc: FinalizeMetricsAccumulator = {
    totalItems: 0,
    repairedCount: 0,
    partialCount: 0,
    unfixableCount: 0,
    adviceCount: 0,
    takenHomeCount: 0,
    // Initialize repair time, weight, electrical PAT counters, and redaction queue
    totalRepairTimeMinutes: 0,
    totalWeightKg: 0,
    mainsCount: 0,
    patTestedCount: 0,
    patFailedCount: 0,
    categoryBreakdown: {},
    redactionPairs: [],
  };
  for (const docSnap of repairsSnap.docs) {
    tallyRepairDoc(acc, docSnap);
  }

  // 4. Commit chunked GDPR redaction and write final analytics + session status
  await commitRedactionPairsInChunks(acc.redactionPairs);
  const analyticsDoc = buildAnalyticsSummaryDoc(sessionId, sessionData, acc);
  const batch = db.batch();
  batch.set(db.collection("analytics").doc(sessionId), analyticsDoc);
  batch.update(sessionRef, {
    status: "FINALIZED",
    finalizedAt: admin.firestore.FieldValue.serverTimestamp(),
  });
  // Clear active session pointer and disable public registration in settings/system
  batch.update(db.collection("settings").doc("system"), {
    activeSessionId: null,
    allowRegistration: false,
  });
  await batch.commit();

  return { success: true, analyticsId: sessionId };
});
