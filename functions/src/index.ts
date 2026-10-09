import * as admin from "firebase-admin";

// Initialize Firebase Admin SDK
admin.initializeApp();

export { verifyVolunteerPin } from "./verifyVolunteerPin";
export { finalizeSession } from "./finalizeSession";
