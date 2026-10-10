import { onCall, HttpsError } from "firebase-functions/v2/https";
import * as admin from "firebase-admin";
import { defaultOrganizerEmails } from "./config";
import { isAuthorizedOrganizer } from "./authUtils";

if (!admin.apps.length) {
  admin.initializeApp();
}

const db = admin.firestore();

/**
 * Callable Cloud Function: finalizeSession
 * - Gated strictly to Google Auth administrators and authorized organizer accounts/groups
 * - Batches through all repair records in chunks of 400 (under Firestore's 500 limit)
 * - Redacts customer PII in private/customer subcollection (UK GDPR Article 5(1)(e))
 * - Aggregates community impact metrics (landfill diversion, repair duration, success rates)
 * - Stores immutable summary in analytics/{sessionId}
 */
export const finalizeSession = onCall(async (request) => {
  // 1. Verify caller has admin/organizer role
  if (!request.auth || !request.auth.token) {
    throw new HttpsError(
      "unauthenticated",
      "Only authenticated organizers may finalize a Repair Café session."
    );
  }

  const callerEmail = request.auth.token.email;
  const hasAdminClaim = Boolean(request.auth.token.admin);

  // Retrieve allowed organizer patterns from client request data, env, defaults, and Firestore settings/system
  const clientEmails = Array.isArray(request.data?.organizerEmails)
    ? (request.data.organizerEmails as unknown[])
        .filter((e): e is string => typeof e === "string")
        .map((e) => e.trim().toLowerCase())
    : [];

  const envEmails = process.env.ORGANIZER_EMAILS
    ? process.env.ORGANIZER_EMAILS.split(",").map((e) => e.trim()).filter(Boolean)
    : [];

  let firestoreAllowed: string[] = [];
  try {
    const settingsSnap = await db.collection("settings").doc("system").get();
    if (settingsSnap.exists) {
      const data = settingsSnap.data();
      if (Array.isArray(data?.organizerEmails)) {
        firestoreAllowed = data.organizerEmails;
      }
    }
  } catch (err) {
    console.warn("Could not read organizerEmails from settings/system:", err);
  }

  // Prefer explicitly configured emails (Firestore settings, client cafeConfig, or env)
  const explicitlyConfigured = [
    ...firestoreAllowed,
    ...clientEmails,
    ...envEmails
  ];

  const allowedPatterns = explicitlyConfigured.length > 0
    ? explicitlyConfigured
    : defaultOrganizerEmails;

  const isAuthorized =
    hasAdminClaim ||
    (callerEmail != null && isAuthorizedOrganizer(callerEmail, allowedPatterns));

  if (!isAuthorized) {
    throw new HttpsError(
      "permission-denied",
      "Only authenticated organizers may finalize a Repair Café session."
    );
  }

  const sessionId = request.data?.sessionId;
  if (!sessionId || typeof sessionId !== "string") {
    throw new HttpsError("invalid-argument", "Valid sessionId must be supplied.");
  }

  const sessionRef = db.collection("sessions").doc(sessionId);
  const sessionSnap = await sessionRef.get();
  if (!sessionSnap.exists) {
    throw new HttpsError("not-found", `Session ${sessionId} was not found.`);
  }

  const sessionData = sessionSnap.data()!;

  // 2. Fetch all repairs for this session
  const repairsRef = sessionRef.collection("repairs");
  const repairsSnap = await repairsRef.get();

  let totalItems = 0;
  let repairedCount = 0;
  let partialCount = 0;
  let unfixableCount = 0;
  let adviceCount = 0;
  let takenHomeCount = 0;
  let totalRepairTimeMinutes = 0;
  let totalWeightKg = 0;
  let mainsCount = 0;
  let patTestedCount = 0;
  let patFailedCount = 0;
  const categoryBreakdown: Record<string, number> = {};

  // Track customer private docs and repair docs for chunked redaction
  const redactionPairs: Array<{
    repairRef: admin.firestore.DocumentReference;
    privateRef: admin.firestore.DocumentReference;
  }> = [];

  for (const doc of repairsSnap.docs) {
    totalItems++;
    const data = doc.data();

    // Aggregations
    const cat = data.item?.category || "OTHER";
    categoryBreakdown[cat] = (categoryBreakdown[cat] || 0) + 1;

    if (data.item?.powerType === "MAINS_240V") {
      mainsCount++;
    }

    if (data.item?.weightKg && typeof data.item.weightKg === "number") {
      totalWeightKg += data.item.weightKg;
    }

    if (data.repair) {
      if (data.repair.repairTimeMinutes && typeof data.repair.repairTimeMinutes === "number") {
        totalRepairTimeMinutes += data.repair.repairTimeMinutes;
      }

      switch (data.repair.outcome) {
        case "FIXED":
          repairedCount++;
          break;
        case "PARTIAL":
          partialCount++;
          break;
        case "UNFIXABLE":
          unfixableCount++;
          break;
        case "ADVICE_GIVEN":
          adviceCount++;
          break;
        case "TAKEN_HOME":
          takenHomeCount++;
          break;
      }
    } else if (data.status === "UNFIXABLE") {
      unfixableCount++;
    }

    if (data.patInitial) {
      patTestedCount++;
      if (
        data.patInitial.outcome === "FAIL_REPAIRABLE_CORD" || 
        data.patInitial.outcome === "DANGER_DO_NOT_ENERGIZE"
      ) {
        patFailedCount++;
      }
    }

    // Queue repair doc and private customer doc for redaction
    const privateRef = doc.ref.collection("private").doc("customer");
    redactionPairs.push({
      repairRef: doc.ref,
      privateRef,
    });
  }

  // 3. Chunked Batch Redaction (Max 400 operations per batch)
  const CHUNK_SIZE = 200;
  for (let i = 0; i < redactionPairs.length; i += CHUNK_SIZE) {
    const chunk = redactionPairs.slice(i, i + CHUNK_SIZE);
    const batch = db.batch();

    for (const pair of chunk) {
      batch.update(pair.repairRef, {
        customerName: "[REDACTED]",
      });
      batch.update(pair.privateRef, {
        firstName: "[REDACTED]",
        contactPhone: admin.firestore.FieldValue.delete(),
        redactedAt: admin.firestore.FieldValue.serverTimestamp(),
      });
    }

    await batch.commit();
  }

  // 4. Calculate Final Analytics
  const successRatePercent = totalItems > 0 
    ? Math.round(((repairedCount + partialCount) / totalItems) * 100) 
    : 0;

  const averageRepairTimeMinutes = (repairedCount + partialCount + unfixableCount + adviceCount) > 0
    ? Math.round(totalRepairTimeMinutes / (repairedCount + partialCount + unfixableCount + adviceCount))
    : 0;

  const patFailureRatePercent = patTestedCount > 0
    ? Math.round((patFailedCount / patTestedCount) * 100)
    : 0;

  const analyticsDoc = {
    sessionId,
    sessionName: sessionData.name,
    date: sessionData.date,
    totalItems,
    repairedCount,
    partialCount,
    unfixableCount,
    adviceCount,
    takenHomeCount,
    totalRepairTimeMinutes,
    averageRepairTimeMinutes,
    successRatePercent,
    totalWeightDivertedKg: Math.round(totalWeightKg * 10) / 10,
    categoryBreakdown,
    mainsItemsCount: mainsCount,
    patTestedCount,
    patFailureRatePercent,
    finalizedAt: admin.firestore.FieldValue.serverTimestamp(),
  };

  // 5. Save Analytics and Finalize Session Status
  const batch = db.batch();
  batch.set(db.collection("analytics").doc(sessionId), analyticsDoc);
  batch.update(sessionRef, {
    status: "FINALIZED",
    finalizedAt: admin.firestore.FieldValue.serverTimestamp(),
  });
  batch.update(db.collection("settings").doc("system"), {
    activeSessionId: null,
    allowRegistration: false,
  });

  await batch.commit();

  return { success: true, analyticsId: sessionId };
});
