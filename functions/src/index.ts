import { initializeApp, getApps } from "firebase-admin/app";

// Initialize Firebase Admin SDK
if (!getApps().length) {
  initializeApp();
}

export { verifyVolunteerPin } from "./verifyVolunteerPin";
export { finalizeSession } from "./finalizeSession";
