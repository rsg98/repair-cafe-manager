# AGENTS.md — Agentic Maintenance Guide

> **Welcome, AI Coding Agent!**
> This file is your primary operating manual for maintaining, extending, and testing the **Repair Café Session Management System**. Read this document carefully before making changes to any code or configuration.

---

## 1. Absolute Host Rules & Tool Execution Constraints (CRITICAL)

Agents operating on this host must strictly adhere to the following command execution constraints:

### 1.1 Prohibited Host Commands
- **NEVER execute `npm`, `npx`, `node`, `yarn`, or `pnpm` on this host.**
  - *User Instruction:* Under no circumstances should Node.js or JavaScript package manager commands be executed by the agent directly.
  - *Alternative:* When testing, building, or installing packages, generate and output the exact commands for the human user to run manually in their external terminal.
- **NEVER execute `terraform`, `gcloud`, or `kubectl` on this host.**
  - *Global Host Rule:* Absolute prohibition applies to direct shell invocations, subagents, scripts, or wrappers.
  - *Alternative:* Static analysis and editing of configs/manifests is permitted. If cloud deployments are required, provide the commands for manual user execution.

### 1.2 Permitted Agent Actions
- Static analysis, file reading, file editing, and file creation.
- Non-runtime git and shell utilities (e.g. `git status`, `git diff`, file tree inspection) where no prohibited binary is invoked.
- Detailed, accurate code generation following the established architecture and domain state machines.

---

## 2. Repository Overview & Core Philosophy

- **Repository:** `repair-cafe-manager`
- **Reference Instance:** Sutton Repair Café (operating out of Seears Park Community Hall, Surrey / Greater London, UK).
- **Core Mission:** A community-driven, non-profit initiative where local residents bring broken household items to skilled volunteer "fixers." The twofold mission is **diverting waste from landfills** and **reviving practical repair skills**.
- **Architecture Model:**
  - **Single-Tenant Open Source:** Each repair café forks and deploys its own isolated Firebase project at **zero recurring monetary cost** ($0.00/month within Google Cloud / Firebase Free Tier).
  - **Offline-First PWA:** Community venues (halls, park pavilions) often have spotty or overloaded Wi-Fi. The app relies on `persistentLocalCache` (IndexedDB) and Workbox service workers so the queue never freezes during connectivity drops.
  - **Dual-Phase PAT Electrical Safety Gates:** Mandatory pre- and post-repair electrical safety checks for 240V mains appliances to protect volunteers and the public.
  - **UK GDPR Article 5(1)(e) Compliance:** Visitor PII (first name, phone number) is isolated in a restricted subcollection and scrubbed to `[REDACTED]` when the session is finalized.

---

## 3. Technology Stack

| Layer | Technologies |
|---|---|
| **Frontend Framework** | React 18 (`react`, `react-dom`), React Router v6 (`react-router-dom`) |
| **Language & Tooling** | TypeScript 5.4 (Strict mode), Vite 5.2 |
| **PWA & Offline** | `vite-plugin-pwa` (Workbox caching, manifest, multi-tab IndexedDB cache) |
| **Styling & UI** | Tailwind CSS 4 (`@tailwindcss/vite`), Lucide React icons, mobile-first touch UI |
| **Data & Analytics** | Chart.js 4.4, `react-chartjs-2`, client-side CSV export |
| **Backend & Cloud** | Google Firebase Web SDK v10 (Modular): Auth, Cloud Firestore, Cloud Functions v2 |
| **Unit Testing** | Vitest 1.6 (`vitest run`) |

---

## 4. Operational Architecture: The 5 Physical Stations

The workflow maps directly to physical stations operating simultaneously during a monthly event:

```
[ Entrance / QR Code ]
         │
         ▼
Station 1: Customer Self-Registration (/register — Public)
         │ Reference Token (e.g. REF-A38F)
         ▼
Station 2: Front Desk Board (/frontdesk — Google Auth Admin)
         │ Maps Reference Token to Physical Reusable Card (#1..#N)
         ├────────────────────────────────────────┐
         │ (240V Mains Device)                    │ (Battery / Mechanical / Textile)
         ▼                                        ▼
Station 3: PAT Safety Station (/pat)     Station 4: Volunteer Fixer Station (/fixer)
         │ Pre-Repair (PAT 1)                     │ Diagnostics, Time (min), Landfill Wt (kg)
         ▼                                        ▼
   WAITING_REPAIR ─────────────────────────► Outcome Logging
                                                  │
         ┌────────────────────────────────────────┘
         │ (Repaired Mains Item)                  │ (Repaired Non-Mains / Advice Given)
         ▼                                        ▼
Station 3: PAT Post-Repair (PAT 2)       READY_FOR_COLLECTION
         │ Post-Repair Cert                       │
         └────────────────────────────────────────┤
                                                  ▼
                                         Station 2: Front Desk Checkout
                                                  │ Customer collects item & returns card
                                                  ▼
                                              COMPLETED
                                                  │
                                         Session Finalization (GDPR PII scrub)
                                                  │
                                         Station 5: Impact Reports (/reports)
```

### Station 1: Customer Self-Registration (`/register`)
- **Access:** Public, unauthenticated (visitors scan QR code on mobile or check in on an entrance tablet).
- **Inputs:** First name, optional contact phone (for collection SMS/call), item category, brand/model, fault description, power type.
- **Fair Queue Enforcement:** `cafeConfig.allowMultiItemRegistration` (default `false` for Sutton Repair Café: strictly 1 item per registration = 1 card token).
- **Mandatory Consent:** Customers must view and check the box accepting the cafe's specific Terms & Conditions and House Rules.
- **Confirmation:** Issues a 4-character alphanumeric reference token (e.g., `REF-A38F`, omitting confusing `0, O, 1, I`) via a read-optimized single read (`getDoc`).

### Station 2: Front Desk Operations (`/frontdesk`)
- **Access:** Restricted to organizers via **Google Sign-In** (`request.auth.token.email != null`).
- **Session Lifecycle:** Starts the monthly session, sets the 4-digit daily volunteer PIN, and points `settings/system.activeSessionId`.
- **Card Token Assignment:** Maps customer reference tokens to physical numbered cards (#1..#N) that are reused every session.
  - Automatically routes `MAINS_240V` items to `WAITING_PAT1`.
  - Automatically routes other power types to `WAITING_REPAIR`.
  - Enforces duplicate card checks to prevent assigning a card currently in use by another active item.
- **Checkout & Card Recovery:** Confirms collection, clears `cardNumber` to `null` for reuse, and marks item `COMPLETED`.
- **Session Finalization:** Triggers the backend Cloud Function `finalizeSession` to scrub PII and compile analytics.

### Station 3: PAT Electrical Safety Station (`/pat`)
- **Access:** Authenticated via the 4-digit daily session PIN (mints custom token with `{ role: 'volunteer' }`).
- **Safety Testing Protocol (BS 1363 & IET Code of Practice):**
  - Logs PAT instrument serial number and visual inspection.
  - Inspects plug fuse rating (3A, 5A, 13A, or OTHER).
  - Selects test voltage (250V vs 500V DC) and measures insulation resistance ($\ge 1.0\,\text{M}\Omega$ Class I, $\ge 2.0\,\text{M}\Omega$ Class II).
  - Measures earth continuity ($\le 0.1\,\Omega + \text{cord}$) for Class I.
- **Pre-Repair (PAT 1) Outcomes:**
  - `PASS` $\rightarrow$ `WAITING_REPAIR`
  - `FAIL_REPAIRABLE_CORD` $\rightarrow$ `WAITING_REPAIR` (displays Amber Safety Caution Banner to fixer; de-energized repair only).
  - `DANGER_DO_NOT_ENERGIZE` $\rightarrow$ `UNFIXABLE` (immediate quarantine; cannot be plugged into mains).
  - `UNTESTABLE` $\rightarrow$ `WAITING_REPAIR` (e.g. missing power adapter; flagged for visual inspection).
- **Post-Repair (PAT 2) Safety Certification:**
  - Mandatory for all repaired mains devices before returning to visitors.
  - `PASS` $\rightarrow$ `READY_FOR_COLLECTION`.
  - `FAIL` $\rightarrow$ `WAITING_REPAIR` (returns to fixer).

### Station 4: Volunteer Fixer Station (`/fixer`)
- **Access:** Authenticated via the daily session PIN (`{ role: 'volunteer' }`).
- **Point Lookup:** Direct `getDoc` lookup by physical Card Number (#1..#N).
- **Safety Banner:** Prominently displays high-visibility alert if PAT 1 had a cord fault or danger note.
- **Data Logged:**
  - Fixer name (cached locally in browser `localStorage`).
  - Repair time in minutes (`repairTimeMinutes`: 15, 30, 45, 60+ min) via quick selector without needing start/end timestamps.
  - Item weight in kg (`weightKg`) for landfill diversion reporting.
  - Diagnosis, repair notes, and parts used.
- **Fixer Outcomes & Routing:**
  - `FIXED` (Mains) $\rightarrow$ `WAITING_PAT2`
  - `FIXED` (Non-mains) $\rightarrow$ `READY_FOR_COLLECTION`
  - `PARTIAL` (Mains) $\rightarrow$ `WAITING_PAT2`
  - `ADVICE_GIVEN` $\rightarrow$ `READY_FOR_COLLECTION`
  - `UNFIXABLE` $\rightarrow$ `UNFIXABLE`
  - `TAKEN_HOME` $\rightarrow$ `TAKEN_HOME` (logs volunteer name and releases cafe custody under private informal contract).

### Station 5: Community Impact Reports (`/reports`)
- **Access:** Organizers and public/volunteer viewing.
- **Metrics Tracked:** Total items, repair success rate (%), landfill waste diverted (kg), volunteer hours invested, category distributions.
- **Export:** Single-click CSV export formatted for local council and grant funder submissions.

---

## 5. Domain State Machine & Lifecycle Transitions

The pure transition rules are located in `src/services/repairService.ts` and thoroughly tested in `tests/stateMachine.test.ts`.

```
                    ┌─────────────────────────┐
                    │       REGISTERED        │
                    └────────────┬────────────┘
                                 │
                 assignCardToken(cardNumber)
                                 │
                 ┌───────────────┴───────────────┐
                 │                               │
        (Power: MAINS_240V)           (Power: BATTERY / OTHER)
                 │                               │
                 ▼                               │
        ┌─────────────────┐                      │
        │  WAITING_PAT1   │                      │
        └────────┬────────┘                      │
                 │                               │
       submitPatInitial(...)                     │
                 │                               │
     ┌───────────┼───────────┐                   │
     │           │           │                   │
  [PASS] [FAIL_CORD] [UNTESTABLE]  [DANGER_DO_NOT_ENERGIZE]
     │           │           │                   │
     └───────────┬───────────┘                   ▼
                 ▼                      ┌─────────────────┐
        ┌─────────────────┐             │    UNFIXABLE    │
        │ WAITING_REPAIR  │◄────────┐   │  (Quarantined)  │
        └────────┬────────┘         │   └─────────────────┘
                 │                  │
        submitRepairRecord(...)     │
                 │                  │
     ┌───────────┼──────────────────┼───────────────┐
     │           │                  │               │
  [FIXED/PARTIAL [FIXED/PARTIAL  [PAT 2 FAIL]  [TAKEN_HOME]
   (Mains)]       (Non-Mains)       │               │
     │            OR ADVICE]        │               ▼
     │                 │            │       ┌───────────────┐
     ▼                 │            │       │  TAKEN_HOME   │
┌─────────────────┐    │            │       └───────────────┘
│  WAITING_PAT2   │    │            │
└────────┬────────┘    │            │
         │             │            │
submitPatFinal(...)    │            │
         │             │            │
     ┌───┴─────────────┐            │
     │ [PASS]          │ [FAIL]     │
     │                 └────────────┘
     ▼
┌───────────────────────┐
│ READY_FOR_COLLECTION  │
└───────────┬───────────┘
            │
   completeCollection(...)
            │
            ▼
┌───────────────────────┐
│       COMPLETED       │
│  (Card # freed)       │
└───────────────────────┘
```

---

## 6. Data Protection (GDPR) & Firestore Document Hierarchy

### 6.1 Firestore Structure
```
sessions/{sessionId}
  ├── id: string
  ├── name: string
  ├── date: string (YYYY-MM-DD)
  ├── status: 'ACTIVE' | 'FINALIZED'
  ├── volunteerPinHash: string (SHA-256)
  ├── cardRangeStart: number
  ├── cardRangeEnd: number
  │
  └── repairs/{repairId}                        <--- Public / Volunteer accessible
        ├── id: string
        ├── sessionId: string
        ├── registrationId: string
        ├── referenceToken: string ("REF-XXXX")
        ├── cardNumber: number | null
        ├── status: ItemStatus
        ├── item: { category, brandModel, faultDescription, powerType, weightKg }
        ├── patInitial?: { ... }
        ├── repair?: { fixerName, repairTimeMinutes, outcome, diagnosis, ... }
        ├── patFinal?: { ... }
        │
        └── private/customer                    <--- Segregated GDPR Subcollection
              ├── firstName: string             (Redacted to "[REDACTED]" on finalize)
              ├── contactPhone?: string         (Deleted / Redacted on finalize)
              ├── agreedToTerms: boolean
              ├── termsVersion: string
              └── registeredAt: string

settings/system
  ├── activeSessionId: string | null
  └── allowRegistration: boolean

analytics/{sessionId}
  └── (Aggregated anonymous impact metrics: diversion kg, success %, time min)
```

### 6.2 Key Security & Privacy Rules
1. **Volunteer Devices Never Receive Customer PII:**
   - Volunteer queries target `sessions/{sessionId}/repairs/{repairId}` only.
   - Security rule: `/private/customer` can only be read by authenticated administrators (`isAdmin()`).
   - Volunteer tablets never cache visitor contact information in IndexedDB.
2. **Cloud Function Redaction (`finalizeSession`):**
   - Batches updates in chunks of 400 (strictly under Firestore's 500 operation transaction limit).
   - Updates `firstName` to `"[REDACTED]"`, deletes `contactPhone`, and sets `redactedAt`.
3. **Client-Side Cache Purge:**
   - On session finalization, the front-desk app calls `terminate(db)` and `clearIndexedDbPersistence(db)` to ensure zero lingering local snapshots.

---

## 7. Security Rules & Authentication Architecture

### 7.1 Security Rule Roles (`firestore.rules`)
- `isAdmin()`: `request.auth != null && request.auth.token.email != null` (Google Authenticated organizer).
  - Can create/edit sessions, modify `settings/system`, read customer PII in `private/customer`, and finalize sessions.
- `isVolunteer()`: `request.auth != null && (request.auth.token.role == 'volunteer' || isAdmin())`.
  - Can read repair docs and update repair status, PAT results, and fixer records.
  - CANNOT read or write `private/customer`.
- `Public`:
  - Can read `settings/system`, active sessions, and repair docs.
  - Can create new registrations and create `private/customer` records at registration time.

### 7.2 Volunteer PIN Authentication Flow
1. Organizer creates session with a 4-digit PIN (e.g. `4829`). The SHA-256 hash is saved to `sessions/{sessionId}.volunteerPinHash`.
2. Volunteer station enters the 4-digit PIN in `PinModal.tsx`.
3. Calls Cloud Function `verifyVolunteerPin({ sessionId, pin })`.
4. Function checks hash and calls `admin.auth().createCustomToken(...)` with claim `{ role: 'volunteer', sessionId }`.
5. Frontend signs in using `signInWithCustomToken(auth, token)`.
6. Station stays authenticated for the duration of the event with zero account-creation friction.

---

## 8. Free Tier Budget Guardrails ($0.00 / Month Target)

Because repair cafes operate with zero budget, the application is strictly designed to remain inside the Firebase Free Tier. When maintaining this codebase, **do not introduce architectural changes that break these rules**:

1. **Point Queries vs. Collection Listeners:**
   - ONLY the Front Desk Live Board attaches an `onSnapshot` listener to the active session repairs.
   - Customer confirmation, PAT Station, and Fixer Station must use targeted `getDoc` point queries by ID or Card Number.
   - Never add wide collection snapshots to public or volunteer screens.
2. **Offline-First Persistence:**
   - Initialized with `persistentLocalCache({ tabManager: persistentMultipleTabManager() })`.
   - Repeated queries in the same browser session resolve from IndexedDB rather than consuming billable document reads.
3. **Batch Commit Limits:**
   - Firestore has a hard limit of 500 operations per batch/transaction.
   - Batch writes (such as `finalizeSession`) must be chunked to $\le 400$ items.
4. **Cloud Functions v2 Limits:**
   - All callable functions must use lightweight resources (Node 20, minimal cold-start overhead).
   - Follow instructions in `docs/BUDGET_ALERTS.md` to keep GCP Billing alerts configured at £1.00.

---

## 9. Codebase File Manifest

```
├── .env.example                       # Sample Firebase frontend env variables
├── AGENTS.md                          # This file (operating guide for AI agents)
├── README.md                          # Public documentation and setup guide
├── firebase.json                      # Hosting rewrites, Firestore rules & indexes, Functions
├── firestore.indexes.json             # Composite indexes for status & card queries
├── firestore.rules                    # Production role-based security rules
├── package.json                       # Frontend dependencies & scripts
├── tsconfig.json                      # Strict TypeScript compiler options
├── vite.config.ts                     # Vite + PWA Workbox config
│
├── docs/
│   ├── BUDGET_ALERTS.md               # Guide to setting up GCP £1 budget safeguards
│   └── design/
│       └── repair_cafe_management_system.md # Full architectural design doc
│
├── functions/                         # Cloud Functions (Node 20 / TypeScript)
│   ├── package.json
│   ├── tsconfig.json
│   └── src/
│       ├── index.ts                   # Exported functions index
│       ├── verifyVolunteerPin.ts      # PIN hash verification & custom token minting
│       └── finalizeSession.ts         # Session analytics aggregator & GDPR scrubber
│
├── src/
│   ├── App.tsx                        # Router layout, session loading, offline indicator
│   ├── main.tsx                       # Entry point
│   ├── index.css                      # Tailwind base & custom components
│   │
│   ├── config/
│   │   └── cafe.config.ts             # Single-tenant cafe branding, legal terms, card range
│   │
│   ├── types/
│   │   └── index.ts                   # TypeScript interfaces and domain types
│   │
│   ├── services/
│   │   ├── firebase.ts                # Firebase app, auth, firestore (persistent cache), functions
│   │   ├── repairService.ts           # State machine helpers, registrations, card assign, PAT, repair
│   │   ├── sessionService.ts          # Session creation, PIN hashing, active session resolver
│   │   └── analyticsService.ts        # Historical queries, metrics aggregation, CSV export
│   │
│   ├── hooks/
│   │   ├── useActiveSession.ts        # Subscribes to settings/system & active session
│   │   ├── useRepairs.ts              # Real-time repairs snapshot for Front Desk
│   │   ├── useAuth.ts                 # Google Sign-In state hook
│   │   ├── useVolunteerPin.ts         # PIN authentication modal & token management
│   │   └── useNetworkStatus.ts        # Online/offline browser state
│   │
│   ├── components/
│   │   ├── common/
│   │   │   ├── CardToken.tsx          # Card token badge (#1..#N)
│   │   │   ├── StatusBadge.tsx        # High-contrast queue status badges
│   │   │   ├── SafetyBanner.tsx       # Amber/Red hazard alerts for PAT 1 defects
│   │   │   ├── PinModal.tsx           # 4-digit keypad for volunteer PIN
│   │   │   ├── TermsModal.tsx         # Scrollable Terms & Conditions modal
│   │   │   └── OfflineNotice.tsx      # Top banner when network connectivity drops
│   │   └── layout/
│   │       ├── Header.tsx             # Branding, active session badge, connection status
│   │       └── Navigation.tsx         # Tab navigation between stations
│   │
│   └── views/
│       ├── CustomerRegisterView.tsx   # Station 1: Customer check-in wizard
│       ├── FrontDeskView.tsx          # Station 2: Organizers board & card assignment
│       ├── PatStationView.tsx         # Station 3: PAT 1 & PAT 2 electrical safety tester
│       ├── FixerStationView.tsx       # Station 4: Volunteer fixer log & time tracker
│       └── ReportsView.tsx            # Station 5: Visual analytics & CSV report download
│
└── tests/                             # Vitest unit test suites
    ├── stateMachine.test.ts           # Full item lifecycle state transition tests
    ├── repairService.test.ts          # Analytics calculation & CSV formatting tests
    └── sessionService.test.ts         # Reference token formatting & SHA-256 PIN hash tests
```

---

## 10. Coding Conventions & Best Practices for Agents

1. **TypeScript Strictness:**
   - Always specify explicit parameter and return types for functions.
   - Avoid `any`. Use domain types from `src/types/index.ts`.
   - Update `src/types/index.ts` if extending schemas.
2. **Pure Business Logic Separation:**
   - Keep state calculations and transition logic as pure functions (e.g. `calculateNextStatusOnRepair`, `calculateNextStatusOnCardAssign`).
   - Pure functions allow 100% test coverage without mocking Firestore or Firebase Auth.
3. **Firebase Modular SDK v10:**
   - Always use tree-shakable modular functions: `import { doc, getDoc, updateDoc } from 'firebase/firestore'`.
   - Never use legacy namespaced v8 syntax (`firestore.collection(...).doc(...)`).
4. **Offline Resilience:**
   - When calling Firestore, handle network disconnections gracefully.
   - Catch errors on collection queries that require composite indexes when offline, and allow local cache fallback.
5. **UI & Accessibility:**
   - Stations are operated on mobile phones and budget 10" Android/iPad tablets.
   - Use large touch targets (minimum `min-h-[44px]` or `p-3`).
   - Use high-contrast color coding for safety-critical states:
     - `DANGER_DO_NOT_ENERGIZE`: Deep red pulsing alert banner (`border-red-600 bg-red-50 text-red-950`).
     - `FAIL_REPAIRABLE_CORD`: Amber warning banner (`border-amber-500 bg-amber-50 text-amber-950`).
     - `PASS`: Fresh emerald green badge (`border-emerald-300 bg-emerald-50 text-emerald-950`).

---

## 11. Testing & Verification Guide (For Human Execution)

Because agents **must not execute `npm` or `node` directly**, instruct the user to run tests and builds in their terminal:

```bash
# 1. Run unit test suite
npm test

# 2. Run TypeScript check and production frontend build
npm run build

# 3. Build Cloud Functions
cd functions && npm run build && cd ..

# 4. Run Vite development server
npm run dev
```

When modifying domain logic, always ensure tests in `tests/stateMachine.test.ts`, `tests/repairService.test.ts`, and `tests/sessionService.test.ts` remain aligned and pass.

---

## 12. Common Maintenance & Extension Recipes

### Recipe A: Customizing for a New Repair Café
Edit `src/config/cafe.config.ts`:
- Change `cafeName`, `tagline`, `venueName`, `contactEmail`, `websiteUrl`.
- Replace `/public/logo.svg`.
- Adjust `defaultCardRange` to match the café's physical token inventory.
- Update `termsAndConditions` path (default `"/terms.md"`) and edit `public/terms.md` with the local organization's legal notice, house rules, and safety disclaimers.

### Recipe B: Adding a New Item Category or Power Type
1. Update types in `src/types/index.ts`:
   - `ItemCategory` (e.g. adding `'JEWELLERY' | 'LEATHER'`).
   - `PowerType` (e.g. adding `'SOLAR' | 'HYDRAULIC'`).
2. Update options in `src/views/CustomerRegisterView.tsx`.
3. Check `calculateNextStatusOnCardAssign` in `src/services/repairService.ts` to ensure the new power type routes appropriately (to `WAITING_PAT1` if mains, `WAITING_REPAIR` otherwise).
4. Add corresponding test cases to `tests/stateMachine.test.ts`.

### Recipe C: Modifying PAT Safety Parameters
1. Check `src/types/index.ts` (`patInitial`, `patFinal`).
2. Update the form UI in `src/views/PatStationView.tsx`.
3. Update `submitPatInitial` and `submitPatFinal` in `src/services/repairService.ts`.
4. Update `tests/stateMachine.test.ts` to verify the state transitions.

### Recipe D: Modifying Session Metrics & Finalization
1. Update `SessionAnalytics` interface in `src/types/index.ts`.
2. Update the aggregation loop in `functions/src/finalizeSession.ts`.
3. Update `exportAnalyticsToCsv` in `src/services/analyticsService.ts`.
4. Update `tests/repairService.test.ts` for CSV validation.
5. Update `src/views/ReportsView.tsx` to render the new metric.
