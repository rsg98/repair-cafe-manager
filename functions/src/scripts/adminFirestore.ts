/**
 * @file functions/src/scripts/adminFirestore.ts
 *
 * Shared Firebase Admin SDK project resolution, initialization, and IAM diagnostic
 * helper for administrator CLI utilities (`manage-sessions`, `ingest-history`,
 * `merge-volunteers`, and `whatsapp-reconcile`).
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import { initializeApp, getApps } from 'firebase-admin/app';
import { getFirestore, Firestore } from 'firebase-admin/firestore';

/**
 * Attempts to read `projects.default` from `.firebaserc` in the given directory.
 */
function readProjectIdFromFirebaserc(dirPath: string): string | undefined {
  const rcPath = path.join(dirPath, '.firebaserc');
  if (!fs.existsSync(rcPath)) {
    return undefined;
  }
  try {
    const raw = fs.readFileSync(rcPath, 'utf8');
    const parsed = JSON.parse(raw) as { projects?: { default?: string } };
    const defaultProj = parsed?.projects?.default?.trim();
    return defaultProj && defaultProj.length > 0 ? defaultProj : undefined;
  } catch {
    return undefined;
  }
}

/**
 * Attempts to read `FIREBASE_PROJECT_ID` or `VITE_FIREBASE_PROJECT_ID` from `.env.local` or `.env`.
 */
function readProjectIdFromDotEnv(dirPath: string): string | undefined {
  const candidates = ['.env.local', '.env'];
  for (const filename of candidates) {
    const envPath = path.join(dirPath, filename);
    if (!fs.existsSync(envPath)) {
      continue;
    }
    try {
      const lines = fs.readFileSync(envPath, 'utf8').split(/\r?\n/);
      for (const rawLine of lines) {
        const line = rawLine.trim();
        if (!line || line.startsWith('#')) {
          continue;
        }
        const match = line.match(
          /^(?:export\s+)?(FIREBASE_PROJECT_ID|GCLOUD_PROJECT|GOOGLE_CLOUD_PROJECT|VITE_FIREBASE_PROJECT_ID)\s*=\s*(.+)$/
        );
        if (match) {
          const val = match[2].trim().replace(/^['"]|['"]$/g, '');
          if (val && val !== 'your_project_id' && val !== 'your-project-id') {
            return val;
          }
        }
      }
    } catch {
      // Ignore unreadable .env file and continue
    }
  }
  return undefined;
}

/**
 * Resolves the target Firebase project ID from:
 * 1. Explicit `--project <projectId>` CLI flag
 * 2. Shell environment variables (`FIREBASE_PROJECT_ID`, `GCLOUD_PROJECT`, `GOOGLE_CLOUD_PROJECT`, `VITE_FIREBASE_PROJECT_ID`)
 * 3. `.firebaserc` (`projects.default`) in `process.cwd()` or parent directory
 * 4. `.env.local` / `.env` (`VITE_FIREBASE_PROJECT_ID`) in `process.cwd()` or parent directory
 * 5. Default fallback (`'sutton-repair-cafe'`)
 */
export function resolveAdminProjectId(explicitProjectId?: string): {
  projectId: string;
  source: string;
} {
  if (explicitProjectId && explicitProjectId.trim().length > 0) {
    return { projectId: explicitProjectId.trim(), source: '--project CLI flag' };
  }

  const envVars: Array<[string, string | undefined]> = [
    ['FIREBASE_PROJECT_ID', process.env.FIREBASE_PROJECT_ID],
    ['GCLOUD_PROJECT', process.env.GCLOUD_PROJECT],
    ['GOOGLE_CLOUD_PROJECT', process.env.GOOGLE_CLOUD_PROJECT],
    ['VITE_FIREBASE_PROJECT_ID', process.env.VITE_FIREBASE_PROJECT_ID],
  ];
  for (const [name, val] of envVars) {
    if (val && val.trim().length > 0) {
      return { projectId: val.trim(), source: `env:${name}` };
    }
  }

  const searchDirs = [process.cwd(), path.resolve(process.cwd(), '..')];
  for (const dir of searchDirs) {
    const rcProj = readProjectIdFromFirebaserc(dir);
    if (rcProj) {
      return { projectId: rcProj, source: '.firebaserc (projects.default)' };
    }
  }

  for (const dir of searchDirs) {
    const dotenvProj = readProjectIdFromDotEnv(dir);
    if (dotenvProj) {
      return { projectId: dotenvProj, source: '.env (VITE_FIREBASE_PROJECT_ID)' };
    }
  }

  return { projectId: 'sutton-repair-cafe', source: 'default fallback' };
}

/**
 * Initializes the Firebase Admin Firestore instance for the resolved project ID
 * and aligns `GOOGLE_CLOUD_QUOTA_PROJECT` so user Application Default Credentials
 * (`gcloud auth application-default login`) bill quota against the target project.
 */
export function initAdminFirestore(explicitProjectId?: string): {
  db: Firestore;
  projectId: string;
  source: string;
} {
  const { projectId, source } = resolveAdminProjectId(explicitProjectId);

  // Ensure User ADC sends x-goog-user-project matching the target Firebase project
  // unless an explicit quota project is already configured in the environment.
  if (!process.env.GOOGLE_CLOUD_QUOTA_PROJECT) {
    process.env.GOOGLE_CLOUD_QUOTA_PROJECT = projectId;
  }

  if (getApps().length === 0) {
    initializeApp({ projectId });
  }
  return { db: getFirestore(), projectId, source };
}

/**
 * Formats CLI errors with actionable IAM / Application Default Credentials guidance
 * when Cloud Firestore returns gRPC code 7 (`PERMISSION_DENIED`) or missing ADC errors.
 */
export function formatAdminCliError(err: unknown): string {
  const message = err instanceof Error ? err.message : String(err);
  const code = (err as { code?: number | string })?.code;

  const isPermissionDenied =
    code === 7 ||
    code === 'PERMISSION_DENIED' ||
    message.includes('7 PERMISSION_DENIED') ||
    message.includes('Missing or insufficient permissions');

  const isMissingCredentials =
    message.includes('Could not load the default credentials') ||
    message.includes('Unable to detect a Project Id');

  if (isPermissionDenied || isMissingCredentials) {
    return `${message}

Troubleshooting Firebase Admin CLI Permissions (Error 7: PERMISSION_DENIED):
  Note: Admin CLI scripts use the server-side Firebase Admin SDK (Google Cloud IAM / Application
  Default Credentials), NOT 'firebase login' or client-side 'firestore.rules'.

  1. Verify the target Firebase Project ID shown in "Connected to Firebase project: ..." above.
     - Pass explicitly:  -- --list --project <your-firebase-project-id>
     - Or set in .env:   VITE_FIREBASE_PROJECT_ID=<your-firebase-project-id>
     - Or link Firebase: firebase use --add

  2. Authenticate Application Default Credentials (choose Option A or Option B):
     Option A (Service Account JSON Key - Recommended if you do not use gcloud CLI):
       - In Firebase Console -> Project Settings -> Service accounts -> click "Generate new private key"
       - Export the path in your terminal before running the script:
         export GOOGLE_APPLICATION_CREDENTIALS="/path/to/serviceAccountKey.json"

     Option B (Google Cloud CLI User Credentials):
       - Log in with the Google account that owns/administers the Firebase project:
         gcloud auth application-default login
       - Set the ADC quota project to your Firebase project ID:
         gcloud auth application-default set-quota-project <your-firebase-project-id>`;
  }

  return message;
}
