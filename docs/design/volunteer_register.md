# Design Document: Volunteer Register, Policy Induction & Session Attendance

## Section 0: Problem Statement in Plain English

### 0.1 Context & Operational Need
Repair Cafés rely entirely on unpaid community volunteers—including practical repairers ("fixers"), qualified electrical safety (PAT) testers, and front-desk session organisers. While the existing Repair Café Session Management System tracks customer items, safety tests, repair outcomes, and anonymised environmental impact metrics, it currently has no structured mechanism to manage the people running the café.

During a live monthly event, this gap creates several operational, safety, and governance risks:

1. **No Emergency Contact Roll-Call:** Volunteers work in an active workshop environment alongside 240V mains testing equipment, soldering irons, sharp hand tools, and heavy appliances. If a volunteer falls ill or suffers an injury during a session, organisers need immediate access to that volunteer's designated emergency contact (name, relationship, and telephone number) and know exactly which volunteers are physically on-site for fire evacuation roll-calls.
2. **Untracked Policy Induction (Health & Safety, Safeguarding, GDPR):** Under community insurance requirements and UK charity governance best practices, every volunteer must be inducted—briefed on the café's core policies (such as Health & Safety, Safeguarding, and Data Protection)—before operating on the floor. Currently, policies are not accessible inside the tool, and there is no record of whether a volunteer has been inducted.
3. **Unverified PAT Tester & Fixer Selection:** At the PAT Electrical Safety Station (`/pat`) and Volunteer Fixer Station (`/fixer`), volunteers currently type their names into an unvalidated free-text box. This allows typos (splitting one volunteer's repairs across `"Dave"`, `"David"`, and `"dave "` in session records) and, critically, provides no technical guardrail to ensure that the person certifying 240V mains electrical safety tests at the PAT Station has actually been marked as **PAT Test Trained**.
4. **Disconnected Organiser Onboarding:** Some volunteers also serve as session organisers. Currently, granting an organiser access to the Front Desk requires a developer to manually edit `organizerEmails` in `src/config/cafe.config.ts` and redeploy the app, rather than allowing existing authenticated organisers to check an "Organiser" box on a volunteer's register entry.
5. **Dynamic Arrival of Volunteers:** While some volunteers confirm attendance before a session starts, others arrive 15–30 minutes after doors open or drop in midway through the morning. Organisers must be able to select initial attendees when launching a session and dynamically add or remove volunteers while the session is running.

### 0.2 The Objective
We will add an integrated **Volunteer Register, Policy Viewer, and Session Attendance Management** system that:
- Allows authenticated organisers at the Front Desk (`/frontdesk`) to maintain a persistent register of volunteers, capturing their name, optional phone and email (mandatory if marked as an Organiser), mandatory emergency contact details, **Organiser** status, **PAT Test Trained** status, and **Policy Induction** confirmation.
- Dynamically grants Front Desk Google Sign-In authorisation to volunteers marked as Organisers by syncing their email addresses to `settings/system.organizerEmails`.
- Automatically enumerates and renders markdown policy documents stored in `src/policies/` (e.g. `POL01-HealthAndSafety.md`) at build time via Vite's native `import.meta.glob`, parsing YAML frontmatter to populate policy titles and metadata in the app and making policies readable from both the Front Desk and Volunteer stations.
- Allows organisers to select attending volunteers when starting a new session and edit the attendance list at any point while the session is active, displaying an amber **Induction Required** warning badge (with a one-click induction flow) if an attending volunteer has not yet been inducted.
- Restricts the Fixer Station (`/fixer`) name selector to volunteers attending the active session, and restricts the PAT Station (`/pat`) tester selector strictly to attending volunteers who are marked **PAT Test Trained**, without leaking volunteer PII (phone numbers, emails, or emergency contacts) to non-admin devices or adding billable Firestore collection listeners.
- Records the total attending volunteer headcount in `SessionAnalytics` (`/reports` and CSV grant exports).

---

## Section 1: Technical Implementation Plan

### 1.1 High-Level Architecture & Data Flow

To stay strictly within the **Firebase Free Tier ($0.00/month)** and **UK GDPR data minimisation** principles established in `AGENTS.md`, the design separates sensitive volunteer contact data from public/station-visible session attendance summaries.

```
┌────────────────────────────────────────────────────────────────────────────────────┐
│                       ORGANISER FRONT DESK (/frontdesk)                            │
│  (Authenticated via Google Sign-In — matches cafeConfig OR Volunteer Organisers)   │
│                                                                                    │
│  ┌──────────────────────────┐  ┌──────────────────────────┐  ┌──────────────────┐  │
│  │ 1. Live Queue & Session  │  │ 2. Volunteer Register    │  │ 3. Café Policies │  │
│  │    Attendance Bar        │  │    - CRUD Volunteers     │  │    Viewer        │  │
│  │    - Edit Attendees      │  │    - Emergency Contacts  │  │    (POL01..POLN) │  │
│  │    - Induction Warnings  │  │    - Organiser / PAT     │  │                  │  │
│  │    - Emergency Lookup    │  │    - Confirm Induction   │  │                  │  │
│  └────────────┬─────────────┘  └────────────┬─────────────┘  └────────┬─────────┘  │
└───────────────┼─────────────────────────────┼─────────────────────────┼────────────┘
                │                             │                         │
                │ Denormalised Non-PII        │ Full Volunteer PII      │ Build-Time
                │ Attendance Summary          │ + Organiser Email Sync  │ import.meta.glob
                ▼                             ▼                         ▼
┌───────────────────────────────┐ ┌───────────────────────────┐ ┌────────────────────┐
│ Firestore: sessions/{id}      │ │ Firestore: volunteers/{id}│ │ src/policies/      │
│ - attendingVolunteerIds[]     │ │ - name, phone, email      │ │ - POL01-*.md       │
│ - attendingVolunteers[]       │ │ - emergencyContactName    │ │ - YAML Frontmatter │
│   { id, name, isOrganiser,    │ │ - emergencyContactPhone   │ │   Parsed at Build  │
│     isPatTrained, inducted }  │ │ - isOrganiser, isPatTrained│ │   via Vite ?raw    │
│ (Read: Public / Volunteers)   │ │ - inducted, inductedAt    │ └─────────┬──────────┘
└───────────────┬───────────────┘ └─────────────┬─────────────┘           │
                │                               │ Syncs emails            │
                │ Existing useActiveSession()   ▼                         │
                │ (0 extra Firestore reads!)  ┌─────────────────────────┐ │
                ├────────────────────────────►│ settings/system         │ │
                │                             │ - organizerEmails[]     │ │
                ▼                             └─────────────────────────┘ │
┌───────────────────────────────────────────────────────────┐             │
│           VOLUNTEER STATIONS (/pat & /fixer)              │◄────────────┘
│  - PAT Station (/pat): Dropdown restricted strictly to    │  Policy Reference Modal
│    session.attendingVolunteers where isPatTrained == true │
│  - Fixer Station (/fixer): Dropdown restricted strictly   │
│    to session.attendingVolunteers                         │
└───────────────────────────────────────────────────────────┘
```

### 1.2 Firestore Data Model & GDPR Segregation

1. **Protected `volunteers/{volunteerId}` Collection (Admin-Only):**
   - Stores the full volunteer record including optional `phone` and `email`, mandatory `emergencyContactName` and `emergencyContactPhone` (plus optional `emergencyContactRelationship`), role flags (`isOrganiser`, `isPatTrained`), and induction state (`inducted`, `inductedAt`, `inductedBy`).
   - Protected in `firestore.rules` with `allow read, write: if isAdmin();`. Unauthenticated visitors and PIN-authenticated volunteer tablets cannot read or list documents in `volunteers`, ensuring volunteer phone numbers, non-organiser emails, and third-party emergency contacts are never cached in volunteer tablet IndexedDB storage.
   - All Firestore write payloads in `volunteerService.ts` and `sessionService.ts` are sanitised with `removeUndefined()` so optional fields (`phone`, `email`, `emergencyContactRelationship`, `inductedAt`, `inductedBy`) never trigger Firestore runtime errors.
   - Point queries (`getDocs(collection(db, 'volunteers'))`) are executed only when an authenticated organiser opens the Front Desk view or edits the register—no background `onSnapshot` listener is attached to `volunteers`.
   - **Multi-Tablet Point Read Fallback:** If Front Desk Tablet A registers a new walk-in volunteer and adds them to the active session, Front Desk Tablet B immediately sees their badge in `SessionAttendanceBar` (via `useActiveSession()`). If an organiser on Tablet B clicks that volunteer's badge to view their Emergency Contact Card and the ID is not yet in Tablet B's local `volunteers` state, `volunteerService.getVolunteerById(id)` performs a single `getDoc(doc(db, 'volunteers', id))` point read and merges it into local state.

2. **Denormalised Attendance Summary on `sessions/{sessionId}` (Zero-Read Station Sync):**
   - When an organiser selects volunteers during session creation or updates the session's attending volunteers while the session is running, we write two fields onto `sessions/{sessionId}`:
      - `attendingVolunteerIds: string[]`
      - `attendingVolunteers: SessionVolunteerSummary[]` containing only `{ id, name, isOrganiser, isPatTrained, inducted }`.
   - Because `App.tsx` already subscribes to the active `Session` document via `useActiveSession()`, both `PatStationView` and `FixerStationView` receive live updates to `session.attendingVolunteers` with **zero additional Firestore reads** and **zero exposure of contact/emergency PII**.
   - **Automatic Active-Session Sync on Volunteer Edit or Delete:**
     - If an organiser edits or inducts a volunteer in the Volunteer Register during an active session and that volunteer is currently in `session.attendingVolunteerIds`, `volunteerService` automatically updates that volunteer's entry in `sessions/{activeSessionId}.attendingVolunteers`.
     - If an organiser deletes a volunteer (`deleteVolunteer`) who is currently in `session.attendingVolunteerIds`, `volunteerService` removes that volunteer from both `attendingVolunteerIds` and `attendingVolunteers` on the active session so no orphaned badge remains in `SessionAttendanceBar`.

3. **Dynamic Organiser Email Synchronisation (`settings/system.organizerEmails`) & Preventing Static Overwrites:**
   - When a volunteer is marked `isOrganiser: true`, the form requires a valid `email` address.
   - Whenever a volunteer record is created, updated, or deleted, `volunteerService.ts` computes the case-insensitive deduplicated union of `cafeConfig.organizerEmails` (the immutable bootstrap list that prevents accidental lockout) and all active organiser emails from `volunteers`, then writes the merged array to `settings/system.organizerEmails`. (Note: While non-organiser emails, phone numbers, and emergency contacts remain strictly inside admin-only `volunteers/{id}`, organiser login emails in `settings/system.organizerEmails` are readable by clients alongside `activeSessionId` to resolve front-desk authorisation.)
   - **Preventing Regression Overwrites:** Currently, `FrontDeskView.tsx` (mount `useEffect`) and `sessionService.ts` (`createSession`, `finalizeSessionDirectly`, `finalizeSessionClient`) write `organizerEmails: cafeConfig.organizerEmails` directly to `settings/system`, which would clobber dynamically added volunteer organisers. All four call sites are updated so they preserve/merge existing `settings/system.organizerEmails` + active volunteer organisers + `cafeConfig.organizerEmails`, and `finalizeSessionDirectly` checks authorisation against the merged organiser email list rather than only `cafeConfig.organizerEmails`.
   - **Preventing Auth Flash in `useAuth.ts`:** `useAuth.ts` subscribes to `settings/system` (`onSnapshot(doc(db, 'settings', 'system'))`) and keeps `loading = true` until **both** Firebase Auth (`onAuthStateChanged`) and the initial `settings/system` snapshot have resolved (falling back gracefully to `cafeConfig.organizerEmails` if offline or on read error). This guarantees a dynamically added volunteer organiser never sees a flash of the "Unauthorized Organizer Account" screen on page load.

#### 1.3 Policy Enumeration, YAML Frontmatter Parsing & Template Exclusion

1. **File Naming, Location & Starter Template Convention:**
   - Policy files live in `src/policies/` with filenames such as `src/policies/POL01-HealthAndSafety.md`, `src/policies/POL02-Safeguarding.md`, and `src/policies/POL03-DataProtection.md`.
   - A starter template file `src/policies/POL00-Template.md` is also stored in `src/policies/` with YAML frontmatter `category: Template` (or `"Template"`).
   - Each file may begin with a standard YAML frontmatter block delimited by `---`:
     ```markdown
     ---
     id: POL01
     name: Health and Safety Policy
     version: "1.0"
     category: Safety
     summary: Workshop safety rules, tool precautions, and emergency procedures.
     ---
     # Health and Safety Policy
     ...
     ```
2. **Build-Time Enumeration via Native Vite `import.meta.glob` & Automatic Template Filtering:**
   - Because policy documents are static governance artefacts that only change when updated in Git and redeployed, we use Vite's built-in `import.meta.glob<string>('../policies/*.md', { query: '?raw', import: 'default', eager: true })` inside `src/services/policyService.ts`.
   - Any policy document whose parsed frontmatter `category` is `"Template"` (case-insensitive: `p.category?.trim().toLowerCase() === 'template'`) is automatically excluded by `filterActivePolicies()` / `getPolicies()`, ensuring `POL00-Template.md` remains in the repository as an authoring reference without ever appearing in the application UI.
   - This requires **zero** custom Vite plugins in `vite.config.ts`, **zero** virtual module declarations in `src/vite-env.d.ts`, **zero** runtime HTTP fetches, and eliminates double-caching in Workbox.
3. **Pure Frontmatter Parser (`src/services/policyService.ts`) & `MarkdownViewer` Enhancement:**
   - `parsePolicyMarkdown(filename, rawContent)` parses leading YAML frontmatter (`name` / `title`, `id` / `code`, `version`, `category`, `summary`), splitting each key-value line on the **first** colon (`line.indexOf(':')`) so colons inside values (e.g. `summary: "Safety: tools and PAT"`) are preserved intact, and strips the frontmatter block from `content`.
   - If a markdown file lacks frontmatter or omits `name`/`id`, it derives the policy code (e.g. `POL01`) and human-readable name (e.g. `Health And Safety`) from the filename `POL01-HealthAndSafety.md`.
   - `MarkdownViewer.tsx` exports and applies `stripYamlFrontmatter(content)` anchored strictly to line 1 (`^(\uFEFF)?---[ \t]*\r?\n([\s\S]*?)\r?\n---[ \t]*(?:\r?\n|$)`), ensuring `public/terms.md` (which has no frontmatter and uses `---` for horizontal dividers mid-document) is completely unaffected.

### 1.4 Station UI Workflows

1. **Front Desk (`/frontdesk`):**
   - **Sub-Navigation Tabs:** `Queue & Session` (default) | `Volunteer Register` | `Café Policies`.
   - **Start New Session Modal:** Expanded to include an **"Attending Volunteers"** multi-select list loaded from the Volunteer Register, with search, "Select All / Clear", role badges (`Organiser`, `PAT Trained`), an amber `Induction Required` badge for uninducted volunteers, and a non-blocking warning banner if 0 volunteers or 0 PAT-trained volunteers are selected.
   - **Active Session Attendance Bar (inside `Queue & Session` tab):** Displays an inline card showing the count and badges of volunteers currently attending the active session, with:
     - **"Manage Session Volunteers" button:** Opens a modal to check/uncheck volunteers who arrive after the session starts (or leave early).
     - **Amber Induction Alert:** Any attending volunteer with `inducted: false` is highlighted with a one-click **"Complete Induction"** action that opens the Policy Induction confirmation modal and updates both the Volunteer Register (`inducted: true, inductedAt, inductedBy`) and the active session summary.
     - **Emergency & Contact Lookup:** Clicking any attending volunteer opens their **Volunteer & Emergency Contact Card** (showing their phone, email, and emergency contact name, relationship, and click-to-call phone link).
   - **Volunteer Register Panel (`VolunteerRegisterPanel.tsx`):** Includes a concise UK GDPR privacy notice on the Add/Edit Volunteer form explaining that volunteer and emergency contact details are stored strictly for session coordination and on-site health & safety emergencies, accessible only to authorised organisers. Prevents duplicate case-insensitive volunteer names.
2. **PAT Electrical Safety Station (`/pat`):**
   - Replaces the free-text `Tester Name` input with a dropdown `<select>` populated strictly from `session.attendingVolunteers.filter(v => v.isPatTrained)` (keyed by `v.id`).
   - **Stale `localStorage` Guard:** A `useEffect` validates `testerName` against the active session's `attendingVolunteers.filter(v => v.isPatTrained)` list; if a name cached in `localStorage` (`pat_tester_name`) from a prior session is not in today's eligible PAT tester list, `testerName` and `localStorage` are immediately reset to `''`.
   - If no PAT-trained volunteer is currently ticked into the session, displays a prominent amber banner instructing the user to ask a Front Desk Organiser to mark a PAT-trained volunteer as attending today's session.
   - Adds a **"Café Policies"** button in the station header to open the `PoliciesModal` at any time.
3. **Volunteer Fixer Station (`/fixer`):**
   - Replaces the free-text `Your Name` input with a dropdown `<select>` populated strictly from `session.attendingVolunteers` (keyed by `v.id`).
   - **Stale `localStorage` Guard:** A `useEffect` validates `fixerName` against `session.attendingVolunteers`; if a cached name in `localStorage` (`fixer_volunteer_name`) is not attending today's session, `fixerName` and `localStorage` are immediately reset to `''`.
   - If no volunteers are currently ticked into the session, displays a clear notice prompting the volunteer to check in with the Front Desk Organiser.
   - Adds a **"Café Policies"** button in the station header to open the `PoliciesModal`.
4. **Community Impact Reports (`/reports`):**
   - `SessionAnalytics` records `volunteerCount: number` (number of attending volunteers when the session is finalised, in both `functions/src/finalizeSession.ts` and client fallback `src/services/sessionService.ts`).
   - `ReportsView.tsx` displays `Volunteers` (`s.volunteerCount ?? '—'`) in the Monthly Session Archive table, and `exportAnalyticsToCsv` appends `'Attending Volunteers'` (`a.volunteerCount ?? 0`) as the 17th column in the exported CSV.

---

## Section 2: Alternatives Considered & Ruled Out

### 2.1 Storing Policies in Firestore or Custom Vite Virtual Modules vs. Static Markdown Files in `src/policies/` Loaded via `import.meta.glob`
- **Alternative A:** Store policy documents as Firestore documents in a `policies/{policyId}` collection with an in-app rich-text/markdown editor.
- **Alternative B:** Store policy documents in `public/policies/` and build a custom Rollup/Vite virtual module plugin (`policiesDiscoveryPlugin` with `fs.watch`) in `vite.config.ts`.
- **Why Ruled Out:** Repair Café policies (Health & Safety, Safeguarding, Data Protection) are formal governance documents that change infrequently via Git pull requests and redeployments. Storing them in `src/policies/POL*.md` with YAML frontmatter and loading them at build time via Vite's native `import.meta.glob('../policies/*.md', { query: '?raw', import: 'default', eager: true })` requires zero Firestore reads, zero custom Vite plugin or `.d.ts` boilerplate, and avoids duplicating `.md` files across `dist/` and the JS bundle.

### 2.2 Exposing the `volunteers` Collection to Volunteer Stations vs. Denormalising `attendingVolunteers` on `Session`
- **Alternative:** Allow `{ role: 'volunteer' }` (PIN-authenticated tablets at `/pat` and `/fixer`) to read the `volunteers` Firestore collection directly to populate station dropdowns.
- **Why Ruled Out:**
  1. **GDPR & Privacy:** `volunteers/{volunteerId}` contains personal mobile numbers, email addresses, and third-party emergency contact details. Under UK GDPR data minimisation, shared Fixer and PAT tablets should never download or cache emergency contact PII in IndexedDB.
  2. **Firebase Free Tier Read Budget:** Querying the `volunteers` collection from every station tablet on every page load wastes Firestore document reads. Denormalising `{ id, name, isOrganiser, isPatTrained, inducted }` onto `sessions/{sessionId}.attendingVolunteers` piggybacks on the existing `useActiveSession()` listener for **zero extra reads**.

### 2.3 Hard-Blocking Uninducted Volunteers from Session Selection vs. Amber Warning + Inline Induction
- **Alternative:** Disable the checkbox for any volunteer with `inducted: false` when starting or editing a session so they cannot be added until an organiser leaves the session screen and edits the Volunteer Register.
- **Why Ruled Out:** At a busy Saturday morning Repair Café, new volunteers frequently arrive 10 minutes before doors open and receive their induction briefing on the spot. Allowing organisers to tick them as present while surfacing a high-visibility amber **"Induction Required"** badge and a one-click **"Brief & Induct"** modal on the live session screen matches real-world floor operations without sacrificing compliance visibility.

### 2.4 Automatically Allowing All Organisers to Perform PAT Tests vs. Explicit `isPatTrained` Flag
- **Alternative:** Permit anyone marked `isOrganiser: true` OR `isPatTrained: true` to appear in the PAT Station tester selector.
- **Why Ruled Out:** Front desk organisers who coordinate queues and refreshments are not necessarily trained in BS 1363 / IET 500V DC electrical safety testing. Requiring `isPatTrained: true` explicitly for anyone (whether volunteer or organiser) to certify PAT tests enforces a strict electrical safety boundary.

---

## Section 3: Detailed Implementation Plan & File Manifest

Every file to be created or modified is enumerated below with its exact responsibilities and contracts.

### 3.1 New Files to Create

| File Path | Rationale & Responsibilities |
|---|---|
| `src/policies/POL00-Template.md` | Starter policy authoring template with YAML frontmatter (`id: POL00`, `name: Policy Template`, `version: "1.0"`, `category: Template`, `summary`). Automatically excluded from the application UI at build time because `category` is `Template`. |
| `src/policies/POL01-HealthAndSafety.md` | Starter Health & Safety policy with YAML frontmatter (`id: POL01`, `name: Health and Safety Policy`, `version: "1.0"`, `category: Safety`, `summary`) covering workshop hazards, 240V mains isolation, PPE, and emergency procedures. |
| `src/policies/POL02-Safeguarding.md` | Starter Safeguarding & Code of Conduct policy with YAML frontmatter (`id: POL02`, `name: Safeguarding and Code of Conduct`, `version: "1.0"`, `category: Governance`, `summary`) covering vulnerable adults, children accompanied by parents/guardians, and respectful collaboration. |
| `src/policies/POL03-DataProtection.md` | Starter UK GDPR & Data Protection policy with YAML frontmatter (`id: POL03`, `name: Data Protection and Privacy Policy`, `version: "1.0"`, `category: Privacy`, `summary`) covering visitor PII segregation, session-end redaction, and emergency contact handling. |
| `src/services/volunteerService.ts` | Firestore CRUD service for `volunteers/{volunteerId}` (`listVolunteers`, `getVolunteerById`, `createVolunteer`, `updateVolunteer`, `deleteVolunteer`, `confirmVolunteerInduction`), pure validation & transformation helpers (`validateVolunteerInput`, `toSessionVolunteerSummary`, `mergeOrganizerEmails`), `syncOrganiserEmailsToSystemSettings()`, and active-session attendance synchronisation (`updateSessionAttendance`). |
| `src/services/policyService.ts` | Pure YAML frontmatter parser (`parsePolicyMarkdown(filename, rawContent)`), filename fallback title/code extractor (e.g. `POL01-HealthAndSafety.md` $\rightarrow$ `id: 'POL01'`, `name: 'Health And Safety'`), `isTemplatePolicy(policy)` / `filterActivePolicies(policies)` helper excluding `category: Template`, and `getPolicies()` loader using Vite's native `import.meta.glob('../policies/*.md', { query: '?raw', import: 'default', eager: true })`. |
| `src/components/common/PoliciesModal.tsx` | Reusable modal (accessible from Front Desk, PAT Station, and Fixer Station) that lists all discovered policy markdown documents with their YAML frontmatter `name`, `id`, `version`, `category`, and `summary`, and renders the selected policy via `MarkdownViewer`. Optionally accepts an induction confirmation mode (`inductionTargetName`, `onConfirmInduction`) when used during an induction briefing. |
| `src/components/frontdesk/VolunteerRegisterPanel.tsx` | Organiser UI panel inside `/frontdesk` for viewing, searching, filtering, creating, editing, inducting, and deleting volunteers in the register, including UK GDPR privacy notice, emergency contact inspection, and one-click policy induction confirmation. |
| `src/components/frontdesk/SessionAttendanceBar.tsx` | Live attendance bar and modals inside `/frontdesk` ("Queue & Session" tab) showing volunteers at the current session, highlighting any uninducted attendees with an amber warning + inline induction action, providing one-click emergency contact lookup (with `getVolunteerById` fallback), and allowing organisers to add/remove volunteers while the session is running. |
| `tests/volunteerService.test.ts` | Unit tests for `validateVolunteerInput` (mandatory emergency contact fields, mandatory email when `isOrganiser === true`, optional phone/email for non-organisers, duplicate name detection), `toSessionVolunteerSummary`, and `mergeOrganizerEmails`. |
| `tests/policyService.test.ts` | Unit tests for `parsePolicyMarkdown`, `isTemplatePolicy`, `filterActivePolicies`, and `getPolicies` covering standard YAML frontmatter (`name`, `title`, `id`, `version`, `category`, `summary`), values containing colons, quoted values, CRLF line endings, frontmatter stripping, filename-based fallback naming (`POL01-HealthAndSafety.md`), and automatic exclusion of `category: Template` (`POL00-Template.md`). |

### 3.2 Existing Files to Modify

| File Path | Rationale & Changes |
|---|---|
| `src/types/index.ts` | Add `Volunteer`, `VolunteerInput`, `SessionVolunteerSummary`, and `PolicyDocument` interfaces. Add optional `attendingVolunteerIds?: string[]` and `attendingVolunteers?: SessionVolunteerSummary[]` to `Session`. Add optional `volunteerCount?: number` to `SessionAnalytics`. |
| `src/components/common/MarkdownViewer.tsx` | Export and apply `stripYamlFrontmatter(content)` anchored strictly to line 1 (`--- ... ---`) before rendering markdown lines so frontmatter never renders as `<hr />` + raw text, while preserving mid-document `---` horizontal rules in `public/terms.md`. |
| `firestore.rules` | Add `match /volunteers/{volunteerId} { allow read, write: if isAdmin(); }` to ensure volunteer contact and emergency contact PII is strictly restricted to authenticated organisers. |
| `src/hooks/useAuth.ts` | Subscribe to `settings/system` via `onSnapshot` and merge `settings/system.organizerEmails` with `cafeConfig.organizerEmails` so volunteers dynamically marked `isOrganiser: true` are authorised as `isAdmin`. Keep `loading: true` until both Firebase Auth and the initial `settings/system` snapshot resolve. |
| `src/services/sessionService.ts` | Update `createSession` to accept `attendingVolunteers: SessionVolunteerSummary[] = []` and store `attendingVolunteerIds` + `attendingVolunteers` on `sessions/{sessionId}`. Preserve existing `settings/system.organizerEmails` (merged with `cafeConfig.organizerEmails`) in `createSession`, `finalizeSessionDirectly`, and `finalizeSessionClient` instead of overwriting with raw `cafeConfig.organizerEmails`. Update `calculateSessionAnalytics` (adding 6th parameter `volunteerCount: number = 0`) and `finalizeSessionDirectly` to include `volunteerCount`. |
| `functions/src/finalizeSession.ts` | Include `volunteerCount: Array.isArray(sessionData.attendingVolunteerIds) ? sessionData.attendingVolunteerIds.length : (Array.isArray(sessionData.attendingVolunteers) ? sessionData.attendingVolunteers.length : 0)` in `analyticsDoc`. |
| `src/services/analyticsService.ts` | Append `'Attending Volunteers'` as the 17th column in `exportAnalyticsToCsv` (using `a.volunteerCount ?? 0`). |
| `src/views/FrontDeskView.tsx` | Add sub-navigation tabs (`Queue & Session`, `Volunteer Register`, `Café Policies`), load volunteers on mount and call `syncOrganiserEmailsToSystemSettings` instead of overwriting `settings/system.organizerEmails` with `cafeConfig.organizerEmails`, update Unauthorized screen copy, integrate `SessionAttendanceBar`, add Attending Volunteers multi-select to the "Start Today's Session" modal, and wire `PoliciesModal`. |
| `src/views/PatStationView.tsx` | Replace free-text `testerName` input with a `<select>` restricted to `session.attendingVolunteers.filter(v => v.isPatTrained)`, validate cached `localStorage` `pat_tester_name` against active session eligible PAT testers in a `useEffect`, show an informative warning if no PAT-trained volunteer is marked as attending, and add a "Café Policies" button in the header. |
| `src/views/FixerStationView.tsx` | Replace free-text `fixerName` input with a `<select>` restricted to `session.attendingVolunteers`, validate cached `localStorage` `fixer_volunteer_name` against active session attendees in a `useEffect`, show a check-in notice if no volunteers are marked as attending, and add a "Café Policies" button in the header. |
| `src/views/ReportsView.tsx` | Display the `Volunteers` headcount column (`s.volunteerCount ?? '—'`) in the Monthly Session Archive table. |
| `tests/sessionService.test.ts` | Add unit test coverage verifying `calculateSessionAnalytics` records `volunteerCount` (6th parameter, defaulting to `0`). |
| `tests/repairService.test.ts` | Update `exportAnalyticsToCsv` test expectations to include the new 17th `'Attending Volunteers'` column (`volunteerCount ?? 0`). |
| `tests/markdownViewer.test.ts` | Add unit test verifying `MarkdownViewer` / `stripYamlFrontmatter` strips leading YAML frontmatter cleanly while preserving mid-document `---` horizontal rules. |

---

### 3.3 Concrete TypeScript Interfaces, Function Signatures & Edge-Case Contracts

#### A. Type Definitions (`src/types/index.ts`)

```ts
export interface Volunteer {
  id: string;
  name: string;
  phone?: string;
  email?: string;
  emergencyContactName: string;
  emergencyContactPhone: string;
  emergencyContactRelationship?: string;
  isOrganiser: boolean;
  isPatTrained: boolean;
  inducted: boolean;
  inductedAt?: number;
  inductedBy?: string;
  createdAt: number;
  updatedAt?: number;
}

export interface VolunteerInput {
  name: string;
  phone?: string;
  email?: string;
  emergencyContactName: string;
  emergencyContactPhone: string;
  emergencyContactRelationship?: string;
  isOrganiser: boolean;
  isPatTrained: boolean;
  inducted: boolean;
  inductedAt?: number;
  inductedBy?: string;
}

export interface SessionVolunteerSummary {
  id: string;
  name: string;
  isOrganiser: boolean;
  isPatTrained: boolean;
  inducted: boolean;
}

export interface PolicyDocument {
  id: string;
  filename: string;
  name: string;
  version?: string;
  category?: string;
  summary?: string;
  content: string; // Markdown body with leading YAML frontmatter stripped
}
```
- On `Session`: add `attendingVolunteerIds?: string[];` and `attendingVolunteers?: SessionVolunteerSummary[];`.
- On `SessionAnalytics`: add `volunteerCount?: number;`.

#### B. Service Function Signatures

1. **`src/services/volunteerService.ts`:**
   - `validateVolunteerInput(input: VolunteerInput, existingVolunteers?: Volunteer[], editingId?: string): { valid: boolean; errors: string[] }`
     - Validates: `name.trim()` non-empty; no duplicate case-insensitive `name.trim()` in `existingVolunteers` (excluding `editingId`); `emergencyContactName.trim()` non-empty; `emergencyContactPhone.trim()` non-empty; if `isOrganiser === true`, `email.trim()` must be non-empty and contain `'@'`.
   - `toSessionVolunteerSummary(volunteer: Volunteer): SessionVolunteerSummary`
     - Returns `{ id: volunteer.id, name: volunteer.name.trim(), isOrganiser: Boolean(volunteer.isOrganiser), isPatTrained: Boolean(volunteer.isPatTrained), inducted: Boolean(volunteer.inducted) }`.
   - `mergeOrganizerEmails(baseEmails: string[], volunteers: Pick<Volunteer, 'email' | 'isOrganiser'>[], existingSystemEmails?: string[]): string[]`
     - Returns trimmed, lowercase-deduplicated array containing `baseEmails` + `existingSystemEmails` (Wait: to allow removing an organiser when `isOrganiser` is unchecked, when syncing from the full `volunteers` list, merge `baseEmails` + `volunteers.filter(v => v.isOrganiser && v.email?.trim()).map(v => v.email!.trim().toLowerCase())`).
   - `syncOrganiserEmailsToSystemSettings(volunteers?: Volunteer[]): Promise<string[]>`
     - Loads `volunteers` if not passed, merges with `cafeConfig.organizerEmails`, writes `{ organizerEmails }` to `settings/system` with `{ merge: true }`, and returns the merged list.
   - `listVolunteers(): Promise<Volunteer[]>` (sorted alphabetically by `name`).
   - `getVolunteerById(volunteerId: string): Promise<Volunteer | null>` (point query `getDoc(doc(db, 'volunteers', volunteerId))`).
   - `createVolunteer(input: VolunteerInput, options?: { inductedByEmail?: string }): Promise<Volunteer>`
   - `updateVolunteer(volunteerId: string, input: VolunteerInput, options?: { activeSessionId?: string; inductedByEmail?: string }): Promise<Volunteer>`
     - Updates `volunteers/{volunteerId}`, syncs `settings/system.organizerEmails`, and if `options?.activeSessionId` (or `settings/system.activeSessionId`) has `volunteerId` in `attendingVolunteerIds`, updates that entry in `sessions/{activeSessionId}.attendingVolunteers`.
   - `confirmVolunteerInduction(volunteerId: string, inductedByEmail?: string, activeSessionId?: string): Promise<void>`
     - Sets `inducted: true, inductedAt: Date.now(), inductedBy: inductedByEmail` on `volunteers/{volunteerId}` and refreshes `sessions/{activeSessionId}.attendingVolunteers` if attending.
   - `deleteVolunteer(volunteerId: string, activeSessionId?: string): Promise<void>`
     - Deletes `volunteers/{volunteerId}`, re-syncs `settings/system.organizerEmails`, and removes `volunteerId` from `sessions/{activeSessionId}.attendingVolunteerIds` and `attendingVolunteers` if present.
   - `updateSessionAttendance(sessionId: string, attendingVolunteers: SessionVolunteerSummary[]): Promise<void>`
     - Updates `sessions/{sessionId}` with `attendingVolunteerIds: attendingVolunteers.map(v => v.id)` and `attendingVolunteers`.

2. **`src/services/policyService.ts`:**
   - `stripYamlFrontmatter(rawContent: string): string`
   - `parsePolicyMarkdown(filename: string, rawContent: string): PolicyDocument`
     - Fallback derivation when frontmatter `id` or `name` is omitted: strips `.md` extension; if filename matches `/^([A-Za-z0-9]+)[-_](.+)$/` (e.g. `POL01-HealthAndSafety.md`), `id` defaults to `match[1].toUpperCase()` (`'POL01'`) and `name` defaults to `match[2]` with camelCase/PascalCase/underscores/hyphens expanded to spaces (`'Health And Safety'`).
   - `isTemplatePolicy(policy: Pick<PolicyDocument, 'category'>): boolean` (returns `policy.category?.trim().toLowerCase() === 'template'`).
   - `filterActivePolicies(policies: PolicyDocument[]): PolicyDocument[]` (filters out policies where `isTemplatePolicy(p)` is `true` and sorts ascending by `id`, then `filename`).
   - `getPolicies(): PolicyDocument[]` (loads `../policies/*.md` via `import.meta.glob`, parses each with `parsePolicyMarkdown`, and returns `filterActivePolicies(...)`).

3. **`src/services/sessionService.ts`:**
   - `createSession(name: string, date: string, rawPin: string, cardRangeStart?: number, cardRangeEnd?: number, attendingVolunteers: SessionVolunteerSummary[] = []): Promise<Session>`
   - `calculateSessionAnalytics(sessionId: string, sessionName: string, sessionDate: string, repairs: RepairItem[], now: number = Date.now(), volunteerCount: number = 0): SessionAnalytics`

4. **`src/services/analyticsService.ts`:**
   - `exportAnalyticsToCsv(analyticsList: SessionAnalytics[]): string`
     - Appends `'Attending Volunteers'` as the 17th column header after `'PAT Fail Rate (%)'`, and outputs `a.volunteerCount ?? 0` as the 17th value on each row.

