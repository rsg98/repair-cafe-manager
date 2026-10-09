import { onCall, HttpsError } from "firebase-functions/v2/https";
import * as admin from "firebase-admin";
import * as crypto from "crypto";

export const verifyVolunteerPin = onCall(async (request) => {
  const { sessionId, pin } = request.data;
  if (!sessionId || !pin) {
    throw new HttpsError("invalid-argument", "Missing sessionId or pin");
  }

  const db = admin.firestore();
  const sessionSnap = await db.doc(`sessions/${sessionId}`).get();
  if (!sessionSnap.exists) {
    throw new HttpsError("not-found", "Session not found");
  }

  const session = sessionSnap.data();
  if (session?.status !== "ACTIVE") {
    throw new HttpsError("failed-precondition", "Session is not active");
  }

  const hashedInput = crypto.createHash("sha256").update(String(pin).trim()).digest("hex");
  if (hashedInput !== session.volunteerPinHash) {
    throw new HttpsError("permission-denied", "Invalid volunteer PIN for this session");
  }

  // Mint custom token with volunteer claim
  const customToken = await admin.auth().createCustomToken(`volunteer-${sessionId}`, {
    role: "volunteer",
    sessionId
  });

  return { token: customToken };
});
