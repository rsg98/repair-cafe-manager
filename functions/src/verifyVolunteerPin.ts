import { onCall, HttpsError } from "firebase-functions/v2/https";
import { initializeApp, getApps } from "firebase-admin/app";
import { getAuth } from "firebase-admin/auth";
import { getFirestore } from "firebase-admin/firestore";
import * as crypto from "crypto";

// Initialize the default Firebase Admin app if not already initialized
if (!getApps().length) {
  initializeApp();
}

export const verifyVolunteerPin = onCall(async (request) => {
  const { sessionId, pin } = request.data;
  if (!sessionId || !pin) {
    throw new HttpsError("invalid-argument", "Missing sessionId or pin");
  }

  const db = getFirestore();
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
  const customToken = await getAuth().createCustomToken(`volunteer-${sessionId}`, {
    role: "volunteer",
    sessionId
  });

  return { token: customToken };
});
