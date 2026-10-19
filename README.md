# Repair Café Session Management System

An open-source, offline-first, single-tenant Progressive Web Application (PWA) built to manage the end-to-end operations of a community Repair Café session—from visitor check-in and electrical safety testing to volunteer repair logging, GDPR-compliant data scrubbing, and community impact reporting.

Originally engineered for **Sutton Repair Café** ([www.suttonrepaircafe.org.uk](https://www.suttonrepaircafe.org.uk)), this system is designed so any community Repair Café can fork the repository, customize a single configuration file, and run its own isolated instance on Google Firebase at **$0.00/month** within the permanent Free Tier.

---

## Table of Contents

1. [Overview & Problems Solved](#1-overview--problems-solved)
   - [The Mission](#the-mission)
   - [Problems This Project Solves](#problems-this-project-solves)
   - [End-to-End Session Workflow](#end-to-end-session-workflow)
2. [Station Views in Detail](#2-station-views-in-detail)
   - [Station 1: Customer Self-Registration (`/register`)](#station-1-customer-self-registration-register)
   - [Station 2: Front Desk Operations (`/frontdesk`)](#station-2-front-desk-operations-frontdesk)
   - [Station 3: PAT Electrical Safety Station (`/pat`)](#station-3-pat-electrical-safety-station-pat)
   - [Station 4: Volunteer Fixer Station (`/fixer`)](#station-4-volunteer-fixer-station-fixer)
   - [Station 5: Community Impact Reports (`/reports`)](#station-5-community-impact-reports-reports)
   - [Item Lifecycle State Machine](#item-lifecycle-state-machine)
3. [Step-by-Step Deployment Guide (Zero Cloud Experience Required)](#3-step-by-step-deployment-guide-zero-cloud-experience-required)
   - [Prerequisites: Tools to Install on Your Computer](#prerequisites-tools-to-install-on-your-computer)
   - [Step 1: Create Your Firebase Project & Upgrade to Blaze](#step-1-create-your-firebase-project--upgrade-to-blaze)
   - [Step 2: Enable Google Sign-In Authentication](#step-2-enable-google-sign-in-authentication)
   - [Step 3: Create the Cloud Firestore Database](#step-3-create-the-cloud-firestore-database)
   - [Step 4: Configure IAM Permissions for Volunteer PIN Authentication (Fixes Issue #13)](#step-4-configure-iam-permissions-for-volunteer-pin-authentication-fixes-issue-13)
   - [Step 5: Register Your Web App & Configure Environment Variables](#step-5-register-your-web-app--configure-environment-variables)
   - [Step 6: Customize Your Café Settings](#step-6-customize-your-café-settings)
   - [Step 7: Build & Deploy to Firebase](#step-7-build--deploy-to-firebase)
   - [Step 8: (Optional) Connect Custom Subdomains](#step-8-optional-connect-custom-subdomains)
4. [Configuration Options & Hostname View Filtering](#4-configuration-options--hostname-view-filtering)
   - [Complete Configuration Reference (`src/config/cafe.config.ts`)](#complete-configuration-reference-srcconfigcafeconfigts)
   - [Customizing Legal Terms & Safety Policies](#customizing-legal-terms--safety-policies)
   - [Organizer Authorization (`organizerEmails`)](#organizer-authorization-organizeremails)
   - [Hostname Matching & View Filtering (`hostnameViews`)](#hostname-matching--view-filtering-hostnameviews)
5. [Local Development & Testing](#5-local-development--testing)
   - [Testing Subdomain Filtering Locally](#testing-subdomain-filtering-locally)
   - [Managing & Purging Test Sessions (`manage-sessions` CLI)](#managing--purging-test-sessions-manage-sessions-cli)
   - [Ingesting Historical CSVs & Merging Volunteers (`ingest-history` & `merge-volunteers` CLI)](#ingesting-historical-csvs--merging-volunteers-ingest-history--merge-volunteers-cli)

---

## 1. Overview & Problems Solved

### The Mission

Community Repair Cafés are volunteer-run, non-profit monthly events where local residents bring broken household items—toasters, lamps, vacuum cleaners, bicycles, clothing, furniture, and toys—to be repaired free of charge alongside skilled volunteer "fixers." Their twofold mission is **diverting repairable waste from landfills** and **reviving practical repair skills** in the community.

### Problems This Project Solves

Many repair cafés start out running sessions with paper clipboards or a patchwork of Google Forms, Google Sheets, and Looker Studio dashboards. As events grow to 50–100+ items per three-hour session, those ad-hoc workflows break down. This system was purpose-built to solve eight core operational, safety, legal, and technical challenges:

#### 1. Disconnected Multi-Form & Spreadsheet Bottlenecks
* **The Problem:** Using separate Google Forms for customer registration, PAT testing, and fixer outcomes requires manual spreadsheet formulas to join rows together. A typo in an item number orphans the repair record, and volunteers have no real-time visibility into what is waiting in the queue.
* **The Solution:** A single unified application with role-specific screens for visitors, the front desk, PAT safety testers, and fixers—all updating a shared data model in real time.

#### 2. Reused Physical Card Collisions
* **The Problem:** At the physical reception desk, cafés hand out numbered wooden or laminated cards (`#1` through `#100`) that stay with the item and are reused every month. Using physical card numbers as database keys causes collisions across sessions or when a customer registers from home before arriving.
* **The Solution:** Two-stage token mapping. Online or QR check-in issues a unique 4-character alphanumeric **Reference Token** (e.g. `REF-A38F`, omitting ambiguous characters `0, O, 1, I`). When the visitor arrives at the Front Desk, an organiser assigns a physical **Card Number** (`#1..#100`) for that session. Even after an item is collected and marked `COMPLETED`, its card number remains preserved on the record for session auditability and cannot be accidentally reassigned during the same session.

#### 3. Mandatory Dual-Phase Electrical Safety (PAT 1 & PAT 2)
* **The Problem:** Mains-powered (`240V AC`) appliances brought in by the public may have exposed live conductors, perished insulation, or internal short circuits. Furthermore, an appliance opened and reassembled by a volunteer must be certified safe before it goes back into a visitor's home.
* **The Solution:** A strict **Dual-Phase Portable Appliance Testing (PAT) Gate** aligned with BS 1363 and the IET Code of Practice:
  * **PAT 1 (Pre-Repair Screening):** Every `MAINS_240V` item is automatically routed to `WAITING_PAT1` upon check-in. PAT testers record appliance class, fuse rating, earth continuity ($\Omega$), and insulation resistance ($\text{M}\Omega$).
    * Items with a damaged mains lead or plug (`FAIL_REPAIRABLE_CORD`) are permitted into the repair queue (`WAITING_REPAIR`) with a high-visibility **Amber Safety Caution Banner** instructing the fixer not to energize the appliance until the cord/plug fault is rectified.
    * Items with catastrophic internal faults (`DANGER_DO_NOT_ENERGIZE`) are immediately quarantined (`UNFIXABLE`) with a **Red Hazard Banner** so no volunteer plugs them in.
  * **PAT 2 (Post-Repair Certification):** Any `MAINS_240V` item marked `FIXED` or `PARTIAL` by a fixer is automatically routed to `WAITING_PAT2`. It cannot reach `READY_FOR_COLLECTION` until it passes a final post-repair PAT test. If it fails PAT 2, it is routed straight back to `WAITING_REPAIR`.

#### 4. Low-Friction Volunteer Access & Safety Induction Tracking
* **The Problem:** Volunteers range widely in technical familiarity and often use shared workbench tablets. Requiring every volunteer to register an email/password account creates major friction on a busy Saturday morning, yet public visitors must not be able to modify repair or PAT records.
* **The Solution:** When an organiser starts a session on the Front Desk, they set a **4-digit daily session PIN**. Volunteers enter this PIN once on `/pat` or `/fixer` tablets; a backend Cloud Function (`verifyVolunteerPin`) verifies the SHA-256 PIN hash and mints a custom Firebase Authentication token (`{ role: 'volunteer', sessionId }`) that keeps the tablet signed in for the rest of the session. Meanwhile, organisers maintain a central **Volunteer Register** tracking who is checked in today, who is PAT-qualified, and who has completed their Health & Safety induction.

#### 5. UK GDPR Compliance & Automatic PII Redaction
* **The Problem:** Collecting visitor names and phone numbers on shared spreadsheets exposes Personal Identifiable Information (PII) to every volunteer device and retains personal data indefinitely after the event, violating UK GDPR Article 5(1)(e) (storage limitation) and Article 5(1)(f) (integrity and confidentiality).
* **The Solution:**
  * **Subcollection Segregation:** Customer contact details (`firstName`, `contactPhone`, and T&C consent timestamp) are stored in a restricted Firestore subcollection (`repairs/{repairId}/private/customer`) readable **only** by authenticated Front Desk organisers. Volunteer tablets never download or cache customer phone numbers in IndexedDB.
  * **End-of-Session Redaction:** When the organiser clicks **Finalize & Redact Session**, the `finalizeSession` Cloud Function aggregates anonymous session statistics and permanently overwrites `customerName` and `firstName` with `"[REDACTED]"`, deletes `contactPhone`, and purges the local browser IndexedDB cache.

#### 6. Unreliable Community Hall Wi-Fi (Offline-First PWA)
* **The Problem:** Community halls and park pavilions frequently suffer from weak cellular reception and overloaded Wi-Fi routers. A cloud-only web app that freezes during a 3-minute drop brings the physical reception queue to a halt.
* **The Solution:** The app is built as an **Offline-First Progressive Web App** using Workbox service workers for static asset caching and Firestore's `persistentLocalCache` (IndexedDB with `persistentMultipleTabManager`). Reads and writes continue seamlessly offline and synchronize automatically when connectivity returns. To prevent two offline Front Desk tablets from assigning the same physical card number during an outage, the Front Desk includes a **Tablet Range Partition** selector (`Tablet A: Cards #1–50`, `Tablet B: Cards #51–100`).

#### 7. Off-Site Repair Custody Handoff (`TAKEN_HOME`)
* **The Problem:** Occasionally a volunteer offers to take a complex item home to finish repairing it with specialist tools. The café needs to record this outcome while legally releasing the Repair Café from ongoing custody and liability.
* **The Solution:** A dedicated `TAKEN_HOME` outcome logs the volunteer's name and transitions the item to a terminal `TAKEN_HOME` status, recording that the item left the venue under a private arrangement between the visitor and volunteer.

#### 8. Zero Recurring Cost ($0.00/Month Architecture)
* **The Problem:** Community repair cafés operate on tiny donation jars and occasional council micro-grants; monthly SaaS subscriptions or high cloud database bills are unsustainable.
* **The Solution:** The query architecture is engineered specifically to stay under **4% of Google Firebase's permanent Free Tier**:
  * **Only** the Front Desk board uses a real-time collection listener (`onSnapshot`) scoped to the active session.
  * Customer registration confirmation, the PAT Station, and the Fixer Station exclusively use targeted single-document point lookups (`getDoc`) by Card Number or Document ID.

---

### End-to-End Session Workflow

```
[ Visitor Scans Entrance QR Code or Uses Check-In Tablet ]
                         │
                         ▼
     Station 1: Customer Self-Registration (/register)
     Issues 4-Char Reference Token (e.g. REF-A38F)
                         │
                         ▼
       Station 2: Front Desk Board (/frontdesk)
     Maps REF-A38F ──► Physical Reusable Card (#1..#100)
                         │
         ┌───────────────┴───────────────────────────┐
         │ (240V Mains Appliance)                    │ (Battery / Mechanical / Textile)
         ▼                                           ▼
Station 3: PAT Safety Station (/pat)        Station 4: Volunteer Fixer Station (/fixer)
Pre-Repair Screening (PAT 1)                Point Lookup by Card #
         │                                  Logs Diagnosis, Time (min), Weight (kg)
         ├── PASS / FAIL_CORD / UNTESTABLE ─────────►│
         │                                           │
         └── DANGER_DO_NOT_ENERGIZE                  ├── FIXED / PARTIAL (240V Mains)
                    │                                │          │
                    ▼                                │          ▼
               UNFIXABLE                             │  Station 3: Post-Repair PAT 2 (/pat)
             (Quarantined)                           │          │
                                                     │          ├── FAIL ──► Returns to Fixer
                                                     │          │
                                                     │          └── PASS ──┐
                                                     │                     │
                                                     ├── FIXED (Non-Mains) ┤
                                                     └── ADVICE_GIVEN ─────┤
                                                                           ▼
                                                                 READY_FOR_COLLECTION
                                                                           │
                                                                           ▼
                                                            Station 2: Front Desk Checkout
                                                            Visitor collects item & returns card
                                                                           │
                                                                           ▼
                                                                       COMPLETED
                                                                           │
                                                            End of Event: Finalize Session
                                                            (Aggregates stats & scrubs PII)
                                                                           │
                                                                           ▼
                                                            Station 5: Impact Reports (/reports)
```

---

## 2. Station Views in Detail

The application provides five specialized views designed around the physical stations of a Repair Café event. Step-by-step operational guides for each station role are available in [`docs/guides/`](docs/guides/):

* **[Station 1 Guide: Customer Self-Registration (`/register`)](docs/guides/01-customer-registration-guide.md)**
* **[Station 2 Guide: Front Desk Organiser (`/frontdesk`)](docs/guides/02-front-desk-organiser-guide.md)**
* **[Station 3 Guide: PAT Electrical Safety Tester (`/pat`)](docs/guides/03-pat-tester-guide.md)**
* **[Station 4 Guide: Volunteer Fixer (`/fixer`)](docs/guides/04-volunteer-fixer-guide.md)**
* **[Station 5 Guide: Community Impact Reports (`/reports`)](docs/guides/05-impact-reports-guide.md)**

### Station 1: Customer Self-Registration (`/register`)

> **Step-by-Step User Guide:** [`docs/guides/01-customer-registration-guide.md`](docs/guides/01-customer-registration-guide.md)

* **Who uses it:** Members of the public arriving with broken items (accessed on their own smartphone via a poster QR code or on a shared check-in tablet at the entrance).
* **Authentication:** Public (unauthenticated). Can be toggled open or closed by the Front Desk via `allowRegistration`.
* **Key Features & Workflow:**
  1. **Visitor Details:** Captures the visitor's **First Name** and an optional **Mobile Phone Number** (used strictly during the session to call or text the visitor if they step away while waiting).
  2. **Fair Queue Enforcement (`allowMultiItemRegistration`):**
     * When set to `false` (the default for Sutton Repair Café), each submission registers **strictly 1 item** so visitors with multiple items re-join the back of the queue fairly.
     * When set to `true`, visitors can add up to **4 items** in a single registration.
  3. **Item Details & Smart Power Defaults:**
     * **Category:** `Electrical`, `Mechanical`, `Textiles`, `Woodwork`, `Toy`, or `Other`.
     * **Power Type:** Automatically defaults based on the chosen category (e.g. selecting `Electrical` selects `240V Mains (Plug)`; selecting `Textiles` or `Woodwork` selects `None / Not Applicable`), while allowing the user to choose `Battery / Low Voltage`, `Mechanical (No Power)`, or `Other`.
     * **Brand / Model** and **Fault Description**.
  4. **Mandatory House Rules & Consent:** Visitors must open and accept the café's Terms & Conditions modal (loaded dynamically from `/terms.md`) before submitting.
  5. **Reference Token Confirmation:** Upon submission, the screen displays a high-contrast 4-character alphanumeric **Reference Token** (e.g. `REF-A38F`) along with live status badges showing each registered item's progress.

---

### Station 2: Front Desk Operations (`/frontdesk`)

> **Step-by-Step User Guide:** [`docs/guides/02-front-desk-organiser-guide.md`](docs/guides/02-front-desk-organiser-guide.md)

* **Who uses it:** Event organisers and reception desk coordinators (also accessible via the `/desk` route alias).
* **Authentication:** Restricted to authorised organisers via **Google Sign-In**. When a user signs in with Google, their email is verified against `cafeConfig.organizerEmails` and the `isOrganiser` flags in the Volunteer Register. Unauthorised Google accounts are blocked with a clear notice and a button to switch accounts.
* **Key Features & Sub-Views:**

#### Tab 1: Session Queue (`QUEUE`)
1. **Starting a Session:** When no session is active, organisers can create a new monthly session by specifying:
   * Session Name (e.g. `Sutton Repair Café — October 2026`) and Date.
   * A **4-Digit Volunteer PIN** (hashed with SHA-256 and stored on the session document so volunteers can unlock `/pat` and `/fixer` stations).
   * **Test / Training Session (`isTest`):** Optional checkbox for volunteer training nights, rehearsals, or equipment checks. Displays an amber **`TEST`** badge in the header across all stations and automatically excludes the session from official `/reports` KPIs and CSV grant exports.
   * Initial **Volunteer Attendance Check-In** selected from the registered volunteer roster.
2. **Live Session Attendance Bar:** Allows the Front Desk to check in late-arriving volunteers with a single click throughout the session so their names immediately appear on the Fixer and PAT station dropdowns.
3. **Live Queue Metrics:** Displays real-time counters across the top of the board:
   * `Total Items`, `Needs Card #`, `PAT 1 Queue`, `Repair Queue`, `PAT 2 Queue`, and `Ready for Pickup`.
4. **First-Come, First-Served (FCFS) Queue Table:**
   * Displays items ordered by registration time so reception staff can see who has been waiting the longest, complete with a live wait-time counter (updated every 5 minutes).
   * **Search & Status Filter:** Instant filtering by customer first name, Reference Token (`REF-XXXX`), physical Card Number (`#1..#100`), item brand/model, or lifecycle status.
   * **Tablet Partition Selector:** Filters card assignment validation to `All Cards (1–100)`, `Tablet A (1–50)`, or `Tablet B (51–100)` so two reception tablets can assign cards concurrently—even during a Wi-Fi drop—without issuing duplicate card numbers.
5. **Assigning Physical Card Numbers:**
   * Entering a physical card number (`#1..#100`) next to a `REGISTERED` item validates that the card has not already been used in the current session and automatically routes the item:
     * `MAINS_240V` items $\rightarrow$ `WAITING_PAT1`
     * All other power types $\rightarrow$ `WAITING_REPAIR`
6. **Viewing Protected Customer Contact Info (PII):**
   * Clicking the **Info (`i`)** button on any row fetches the restricted `private/customer` document (accessible only to organisers) to display the visitor's phone number and T&C consent timestamp.
7. **Checkout & Card Recovery (`Done`):**
   * When an item is in `READY_FOR_COLLECTION`, `UNFIXABLE`, or `TAKEN_HOME`, clicking **Done** marks the item `COMPLETED`.
   * The row is greyed out and moved to the bottom of the list while **preserving the original `cardNumber`** for auditability and preventing that card number from being reused during the same session.
8. **Finalize & Redact Session (or Discard & Purge Test Session):**
   * At the end of an official event, clicking **Finalize & Redact Session** invokes the `finalizeSession` Cloud Function (with an automatic client-side fallback), computing final session impact metrics into `analytics/{sessionId}`, redacting `customerName` and `firstName` to `"[REDACTED]"`, deleting `contactPhone` across all repair records, closing the active session, and purging the local browser IndexedDB cache.
   * When running a **Test / Training Session** (`isTest: true`), an amber banner on `/frontdesk` also provides a **Discard & Purge Test Session** button that permanently deletes the test session and all nested `repairs` and `private/customer` documents in a bottom-up cascade without writing to `/reports`.

#### Tab 2: Volunteer Register (`VOLUNTEERS`)
* A persistent directory of Repair Café volunteers managed by organisers.
* Stores Full Name, Email Address, Phone Number, Emergency Contact Name & Phone, and three operational flags:
  * **Organiser (`isOrganiser`):** Grants Front Desk admin access when signing in with that Google email address (automatically synced to `settings/system.organizerEmails`).
  * **PAT Trained (`isPatTrained`):** Allows the volunteer to appear in the tester selector on the PAT Electrical Safety Station (`/pat`).
  * **Health & Safety Inducted (`inducted`):** Tracks whether the volunteer has read and accepted the café's Health & Safety and PAT Testing policies (displays an amber warning badge on station selectors if pending).

#### Tab 3: Repair Café Policies (`POLICIES`)
* Built-in split-pane viewer displaying the café's Health & Safety, Safeguarding, and Whistleblowing policies bundled from [`src/policies/`](src/policies/) (see [`docs/POLICIES.md`](docs/POLICIES.md)).

---

### Station 3: PAT Electrical Safety Station (`/pat`)

> **Step-by-Step User Guide:** [`docs/guides/03-pat-tester-guide.md`](docs/guides/03-pat-tester-guide.md)

* **Who uses it:** Qualified volunteer PAT testers operating the electrical safety testing bench.
* **Authentication:** Unlocked via the **4-digit daily session PIN** (or automatically unlocked if signed in as an authorised Google organiser).
* **Key Features & Workflow:**
  1. **Tester & Instrument Persistence:**
     * The tester selects their name from a dropdown **strictly filtered to PAT-trained volunteers checked into today's session** and enters their **PAT Instrument Serial Number**. Both values are saved in `localStorage` so they don't need to be re-typed between items.
     * Includes a **View Policies** button opening the café's PAT and Health & Safety guidelines in a modal.
  2. **Point Lookup by Card Number:**
     * Entering the physical Card Number (`#1..#100`) performs a single-document query (`getDoc`) to load the item without subscribing to the entire collection.
  3. **Automatic Phase Detection (PAT 1 vs. PAT 2):**
     * **Pre-Repair Screening (PAT 1):** Shown when an item is in `WAITING_PAT1` (or before repair). Captures:
       * **Visual Inspection:** Pass / Fail toggle (checking casing, cord strain relief, plug pins, and correct fuse).
       * **Appliance Classification:** `Class I (Earthed Metal)`, `Class II (Double Insulated)`, `Class III (SELV <50V)`, or `Mains Lead / Adapter`.
       * **BS 1363 Plug Fuse Rating:** `3A`, `5A`, `13A`, or `OTHER`.
       * **Test Voltage Selected:** `500V DC (Standard)` or `250V DC (Surge-Protected / Sensitive Electronics)`.
       * **Earth Continuity ($\Omega$):** Enabled for Class I appliances (pass threshold $\le 0.1\,\Omega + \text{cord}$).
       * **Insulation Resistance ($\text{M}\Omega$):** Pass threshold $\ge 1.0\,\text{M}\Omega$ (Class I) or $\ge 2.0\,\text{M}\Omega$ (Class II).
       * **PAT 1 Outcome & Routing:**
         * `PASS (Safe to Energize)` $\rightarrow$ `WAITING_REPAIR`
         * `FAIL — Repairable Cord/Plug` $\rightarrow$ `WAITING_REPAIR` (attaches an **Amber Caution Banner** for the fixer)
         * `DANGER — Do Not Energize` $\rightarrow$ `UNFIXABLE` (immediately quarantines the item with a **Red Hazard Banner**)
         * `UNTESTABLE (See Notes)` $\rightarrow$ `WAITING_REPAIR` (e.g. missing proprietary power supply; requires notes)
     * **Post-Repair Certification (PAT 2):** Automatically selected when a `MAINS_240V` item has been repaired (`WAITING_PAT2`).
       * `PASS — Safe for Collection` $\rightarrow$ `READY_FOR_COLLECTION`
       * `FAIL — Return to Fixer` $\rightarrow$ `WAITING_REPAIR` (routes the item back to the fixer bench for rework)

---

### Station 4: Volunteer Fixer Station (`/fixer`)

> **Step-by-Step User Guide:** [`docs/guides/04-volunteer-fixer-guide.md`](docs/guides/04-volunteer-fixer-guide.md)

* **Who uses it:** Volunteer repairers at the workbench stations (electrical, mechanical, sewing/textiles, woodwork, bikes, toys).
* **Authentication:** Unlocked via the **4-digit daily session PIN** (or automatically unlocked for signed-in organisers).
* **Key Features & Workflow:**
  1. **Fixer Selection:** The volunteer selects their name from the dropdown of volunteers checked into the active session (persisted in `localStorage` on that device). If no volunteers have been checked in at the Front Desk yet, an amber notice prompts them to ask the Front Desk to mark attendance.
  2. **Point Lookup by Card Number:** The fixer types the physical Card Number (`#1..#100`) attached to the item on their bench.
  3. **High-Visibility Electrical Safety Banners:**
     * If the item is `MAINS_240V` and has PAT 1 notes or a `FAIL_REPAIRABLE_CORD` result, an **Amber Safety Caution Banner** is displayed at the top of the screen detailing the fuse rating, earth/insulation readings, and tester notes.
     * If the item was marked `DANGER_DO_NOT_ENERGIZE`, a pulsing **Red Quarantine Banner** warns the fixer not to plug the item into mains power.
  4. **Repair Outcome & Impact Logging:**
     * **Repair Outcome:**
       * `Fixed`
       * `Partially Fixed`
       * `Advice Given`
       * `Unfixable`
       * `Taken Home by Volunteer` (displays a custody release warning confirming the volunteer is taking the item off-site under an informal private arrangement)
     * **Repair Duration (Minutes):** Quick-select touch buttons (`15 min`, `30 min`, `45 min`, `60+ min` or custom input)—eliminating the need for start/stop timers.
     * **Estimated Weight (`weightKg`):** Used to calculate total landfill waste diverted (required when an item is marked `Fixed` or `Partially Fixed`).
     * **Fault Diagnosis**, **Repair Notes / Actions Taken**, and **Parts / Consumables Used**.
  5. **Automated Post-Repair Routing:**
     * If the item is `MAINS_240V` and the outcome is `Fixed` or `Partially Fixed`, submitting the form automatically routes the item to `WAITING_PAT2` and instructs the fixer to carry the item to the PAT Station for final certification.
     * Non-mains items (or items marked `Advice Given`) are routed directly to `READY_FOR_COLLECTION`.

---

### Station 5: Community Impact Reports (`/reports`)

> **Step-by-Step User Guide:** [`docs/guides/05-impact-reports-guide.md`](docs/guides/05-impact-reports-guide.md)

* **Who uses it:** Organisers, volunteers, grant funders, local council partners, and community members.
* **Authentication:** Publicly readable (queries only aggregated, anonymous `analytics/{sessionId}` documents containing zero personal data).
* **Key Features:**
  1. **Cumulative Impact KPI Cards (Official Sessions Only):**
     * **Landfill Diverted:** Total weight in `kg` of successfully repaired items across all finalized official sessions.
     * **Repair Success Rate:** Percentage of items repaired (`Fixed` + `Partially Fixed`) alongside total items seen.
     * **Volunteer Effort:** Total direct workbench repair hours (`repairTimeMinutes / 60`).
     * **PAT Screenings:** Total electrical safety inspections (`PAT 1` + `PAT 2`) completed.
  2. **Repairs by Item Category Chart:** Proportional visual breakdown of items across `ELECTRICAL`, `MECHANICAL`, `TEXTILES`, `WOODWORK`, `TOY`, and `OTHER`.
  3. **Monthly Session Archive Table & Test Session Controls:**
     * Chronological breakdown of finalized official sessions showing items seen, fixed, partial, unfixable, weight diverted (`kg`), volunteer hours, and volunteers attended.
     * **Test Session Isolation:** Sessions flagged with `isTest: true` are automatically excluded from all public KPIs, charts, default archive rows, and CSV exports. Signed-in organisers can tick **Show Test Sessions** to inspect test runs or click **Mark as Test** / **Mark as Official** to reclassify any historical session.
  4. **Single-Click CSV Export (`Export for Grant Report (CSV)`):** Downloads a formatted `.csv` file of official sessions ready for local council environmental reporting, Repair Café International monitoring, and charity grant applications.

---

### Item Lifecycle State Machine

All status transitions are enforced by pure functions in `src/services/repairService.ts`:

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
│  (Card # preserved)   │
└───────────────────────┘
```

---

## 3. Step-by-Step Deployment Guide (Zero Cloud Experience Required)

This guide walks you through deploying your own Repair Café instance from scratch. **No prior experience with Google Cloud or Firebase is assumed.**

> **What is Firebase?**
> Firebase is a platform run by Google that hosts your website (**Firebase Hosting**), stores your repair queue data (**Cloud Firestore**), handles organiser Google logins (**Firebase Authentication**), and runs two small background scripts (**Cloud Functions**) that verify the daily volunteer PIN and redact visitor data at the end of a session.

---

### Prerequisites: Tools to Install on Your Computer

Before setting up the cloud project, install these three free tools on your computer (Windows, Mac, or Linux):

1. **Git** (for downloading the code):
   * Download and install from [https://git-scm.com/downloads](https://git-scm.com/downloads).
2. **Node.js (Version 24 LTS recommended)**:
   * Download and install the **LTS (Long Term Support)** installer from [https://nodejs.org/](https://nodejs.org/).
   * Installing Node.js automatically includes `npm` (the Node Package Manager).
   * To verify it worked, open your computer's **Terminal** (on Mac/Linux) or **Command Prompt / PowerShell** (on Windows) and run:
     ```bash
     node --version
     npm --version
     ```
3. **Firebase CLI** (the command-line tool used to publish the app to Firebase):
   * In your Terminal / Command Prompt, install the Firebase CLI globally by running:
     ```bash
     npm install -g firebase-tools
     ```

Next, download a copy of this repository onto your computer:

```bash
git clone https://github.com/rsg98/repair-cafe-manager.git
cd repair-cafe-manager
```

---

### Step 1: Create Your Firebase Project & Upgrade to Blaze

1. Sign in to your Google account and go to the **[Firebase Console](https://console.firebase.google.com/)**.
2. Click **Create a project** (or **Add project**).
3. Enter a project name (for example, `my-town-repair-cafe`) and click **Continue**.
   * *Tip:* Note down the **Project ID** shown underneath the project name (e.g., `my-town-repair-cafe-12345`). You will need this later.
4. When asked about **Google Analytics**, toggle it **Off** (it is not needed and simplifies GDPR compliance), then click **Create project**.
5. Once your project is ready, click **Continue** to enter the project dashboard.
6. **Upgrade from "Spark" to "Blaze (Pay as you go)":**
   * Look at the bottom-left corner of the left sidebar where it says **Spark plan (Free)** and click **Upgrade**.
   * Select the **Blaze (Pay as you go)** plan and follow the prompts to link a billing account.
   * **Why is a billing account required if the app is free?** Google requires a billing account to deploy **Cloud Functions** (which power the 4-digit volunteer PIN login and the GDPR redaction button). However, the Blaze plan still includes the exact same **permanent monthly Free Tier** as the Spark plan:
     * **Firestore Free Tier:** 50,000 reads/day, 20,000 writes/day, 1 GiB storage. (A typical 100-item Repair Café session uses fewer than 2,000 reads and 600 writes—under **4%** of a single day's free quota.)
     * **Cloud Functions Free Tier:** 2,000,000 invocations/month. (A session uses ~25 invocations.)
   * **Recommended Safety Net:** When prompted during the Blaze upgrade (or immediately afterwards), set a budget alert for **£1.00 / $1.00**. See [`docs/BUDGET_ALERTS.md`](docs/BUDGET_ALERTS.md) for a step-by-step guide on setting up a £1.00 email alert.

---

### Step 2: Enable Google Sign-In Authentication

Organisers use their Google accounts to sign in to the Front Desk (`/frontdesk`).

1. In the Firebase Console left sidebar, click **Build** $\rightarrow$ **Authentication**.
2. Click **Get started**.
3. Under the **Sign-in method** tab, click **Google**.
4. Toggle the **Enable** switch to **On**.
5. Select a **Project support email** from the dropdown (your email address) and click **Save**.

---

### Step 3: Create the Cloud Firestore Database

Cloud Firestore stores your sessions, repair queue, volunteer register, and anonymised impact statistics.

1. In the Firebase Console left sidebar, click **Build** $\rightarrow$ **Firestore Database**.
2. Click **Create database**.
3. **Select a Location:** Choose a region close to your Repair Café (for UK cafés, choose `eur3 (europe-west)` or `europe-west2 (London)`), then click **Next**.
4. **Security Rules:** Select **Start in production mode** and click **Create**. (You will upload the project's custom security rules automatically in Step 7.)

---

### Step 4: Configure IAM Permissions for Volunteer PIN Authentication (Fixes Issue #13)

> **Why this step is critical ([GitHub Issue #13](https://github.com/rsg98/repair-cafe-manager/issues/13)):**
> When a volunteer enters the 4-digit session PIN on the PAT Station (`/pat`) or Fixer Station (`/fixer`), the `verifyVolunteerPin` Cloud Function calls Firebase Admin's `createCustomToken()` to create a temporary login token for that tablet.
>
> Behind the scenes, `createCustomToken()` asks Google Cloud's IAM system to cryptographically sign that token (`iam.serviceAccounts.signBlob`). On newly created Google Cloud / Firebase projects, the default Cloud Functions service account **does not** have permission to sign tokens out of the box. If you skip this step, entering a valid volunteer PIN will fail with an **`HTTP 500` error** (`FirebaseAuthError: Permission 'iam.serviceAccounts.signBlob' denied on resource`).

To grant this permission, follow these steps in the Google Cloud Console:

#### 4a. Enable the IAM Service Account Credentials API
1. Open the **[Google Cloud IAM Credentials API page](https://console.cloud.google.com/apis/library/iamcredentials.googleapis.com)**.
2. Ensure your Firebase project is selected in the project dropdown at the very top of the page.
3. If the button says **Enable**, click **Enable**. (If it says **Manage**, it is already enabled.)

#### 4b. Grant the "Service Account Token Creator" Role
1. Open the **[Google Cloud IAM Console](https://console.cloud.google.com/iam-admin/iam)** (and verify your project is selected in the top bar).
2. In the **Permissions** table, look for the **Default compute service account**, which looks like:
   * `<PROJECT_NUMBER>-compute@developer.gserviceaccount.com` (used by 2nd Gen Cloud Functions)
   * *(Note: If you also see `<PROJECT_ID>@appspot.gserviceaccount.com`, apply the role below to it as well.)*
3. On the right side of that row, click the **Pencil icon (Edit principal)**.
   * *(Tip: If you don't see `<PROJECT_NUMBER>-compute@developer.gserviceaccount.com` listed yet, check the **Include Google-provided role grants** checkbox near the top-right of the table, or wait until after Step 7 and come back to this screen.)*
4. In the slide-out panel, click **+ Add another role**.
5. Click the **Select a role** dropdown, type **`Service Account Token Creator`** into the filter box, and select **Service Account Token Creator** (`roles/iam.serviceAccountTokenCreator`).
6. Click **Save**.

<details>
<summary><strong>Alternative: Setting this IAM rule via the <code>gcloud</code> command line (Optional)</strong></summary>

If you have the Google Cloud CLI installed on your machine, you can perform Steps 4a and 4b with two commands (replace `YOUR_PROJECT_ID` and `YOUR_PROJECT_NUMBER` with your project's values from **Project Settings**):

```bash
# 1. Enable the IAM Service Account Credentials API
gcloud services enable iamcredentials.googleapis.com --project=YOUR_PROJECT_ID

# 2. Grant Service Account Token Creator to the Compute Engine default service account (Gen 2 Functions)
gcloud projects add-iam-policy-binding YOUR_PROJECT_ID \
  --member="serviceAccount:YOUR_PROJECT_NUMBER-compute@developer.gserviceaccount.com" \
  --role="roles/iam.serviceAccountTokenCreator"

# 3. (Optional) Also grant to the App Engine default service account if present
gcloud projects add-iam-policy-binding YOUR_PROJECT_ID \
  --member="serviceAccount:YOUR_PROJECT_ID@appspot.gserviceaccount.com" \
  --role="roles/iam.serviceAccountTokenCreator"
```
</details>

---

### Step 5: Register Your Web App & Configure Environment Variables

Now connect the frontend code on your computer to your Firebase project:

1. Return to the **[Firebase Console](https://console.firebase.google.com/)** and click the **Gear icon** ⚙️ next to *Project Overview* in the top-left sidebar $\rightarrow$ **Project settings**.
2. Scroll down to the **Your apps** section and click the **Web icon (`</>`)**.
3. Enter an app nickname (e.g., `Repair Café Web App`). Leave *Firebase Hosting* unchecked for now and click **Register app**.
4. Firebase will display a block of code containing `const firebaseConfig = { ... }`. Keep this values screen open.
5. In your project folder on your computer, copy the sample environment file `.env.example` to a new file named `.env`:
   ```bash
   cp .env.example .env
   ```
6. Open `.env` in any text editor (such as Notepad, TextEdit, or VS Code) and fill in the values from the `firebaseConfig` screen:
   ```env
   VITE_FIREBASE_API_KEY=AIzaSyYourApiKeyHere
   VITE_FIREBASE_AUTH_DOMAIN=your-project-id.firebaseapp.com
   VITE_FIREBASE_PROJECT_ID=your-project-id
   VITE_FIREBASE_STORAGE_BUCKET=your-project-id.appspot.com
   VITE_FIREBASE_MESSAGING_SENDER_ID=123456789012
   VITE_FIREBASE_APP_ID=1:123456789012:web:abcdef1234567890
   ```
7. Save the `.env` file, then click **Continue to console** in Firebase.

---

### Step 6: Customize Your Café Settings

1. Open [`src/config/cafe.config.ts`](src/config/cafe.config.ts) in your text editor:
   * Update `cafeName`, `tagline`, `venueName`, `contactEmail`, and `websiteUrl`.
   * Under `organizerEmails`, add your own Google email address (e.g., `'yourname@gmail.com'`) so you are authorised to log in to the Front Desk (`/frontdesk`).
   * **Important — Configure `hostnameViews` for your Firebase domain:**
     By default, Firebase hosts your site at `YOUR_PROJECT_ID.web.app` and `YOUR_PROJECT_ID.firebaseapp.com`. Add those hostnames to `hostnameViews` in [`src/config/cafe.config.ts`](src/config/cafe.config.ts) so the app knows which views to show when you open your live URL:
     ```ts
     hostnameViews: {
       'your-project-id.web.app': ['register', 'frontdesk', 'pat', 'fixer', 'reports'],
       'your-project-id.firebaseapp.com': ['register', 'frontdesk', 'pat', 'fixer', 'reports'],
       // Plus any custom subdomains you plan to add later (see Section 4)
     }
     ```
2. Open [`functions/src/config.ts`](functions/src/config.ts) and add your organiser Google email address to `DEFAULT_ORGANIZER_EMAILS` as well so the backend `finalizeSession` Cloud Function recognizes you.

---

### Step 7: Build & Deploy to Firebase

From your Terminal / Command Prompt inside the `repair-cafe-manager` folder, run the following commands in order:

1. **Log in to Firebase:**
   ```bash
   firebase login
   ```
   *(This opens a browser window where you sign in with the same Google account used in Step 1.)*

2. **Link this folder to your Firebase Project:**
   ```bash
   firebase use --add
   ```
   * Use the arrow keys to select your Firebase Project ID from the list and press **Enter**.
   * When asked for an alias, type `default` and press **Enter**.

3. **Install frontend and Cloud Function dependencies:**
   ```bash
   npm install
   npm --prefix functions install
   ```

4. **Build the frontend application and Cloud Functions:**
   ```bash
   npm run build
   npm --prefix functions run build
   ```

5. **Deploy everything (Hosting, Firestore Rules & Indexes, and Cloud Functions) to Firebase:**
   ```bash
   firebase deploy
   ```
   * *Note:* The first time you run `firebase deploy`, Google Cloud may take 2–4 minutes to provision the Cloud Functions environment. If it asks whether to grant permissions to Eventarc or Cloud Build service accounts, type `y` and press **Enter**.

When the command completes, it will print your live **Hosting URL**:
`https://your-project-id.web.app`

Open that URL in your browser, navigate to `/frontdesk`, sign in with your Google account, and start your first Repair Café session!

---

### Step 8: (Optional) Connect Custom Subdomains

If your Repair Café owns a domain name (e.g. `suttonrepaircafe.app`), you can map separate subdomains to specific station views (such as `register.suttonrepaircafe.app` for public QR codes and `fixer.suttonrepaircafe.app` for workbench tablets):

1. In the Firebase Console, go to **Build** $\rightarrow$ **Hosting** and click **Add custom domain**.
2. Enter your subdomain (e.g. `register.suttonrepaircafe.app`) and follow the instructions to add the DNS `A` / `TXT` records at your domain registrar. Repeat for each subdomain you want (`fixer.*`, `manager.*`, etc.).
3. **Add your custom domains to Firebase Authentication's Authorized Domains:**
   * Go to **Build** $\rightarrow$ **Authentication** $\rightarrow$ **Settings** tab $\rightarrow$ **Authorized domains**.
   * Click **Add domain** and add each custom domain (e.g. `manager.suttonrepaircafe.app`) where organisers will use Google Sign-In. *(Without this, Google Sign-In popups will be blocked on custom domains.)*
4. Map each subdomain in `hostnameViews` inside [`src/config/cafe.config.ts`](src/config/cafe.config.ts) (see [Section 4](#hostname-matching--view-filtering-hostnameviews) below for full details), then re-run `npm run build && firebase deploy`.

---

## 4. Configuration Options & Hostname View Filtering

All single-tenant branding, operational rules, authorised organisers, and subdomain view filters live in a single strongly-typed configuration file: **[`src/config/cafe.config.ts`](src/config/cafe.config.ts)**.

### Complete Configuration Reference (`src/config/cafe.config.ts`)

| Option | Type | Default (Sutton Reference) | Description |
| :--- | :--- | :--- | :--- |
| `cafeName` | `string` | `'Sutton Repair Café'` | The primary display name of your Repair Café shown in the header, registration screen, terms modal, and exported reports. |
| `tagline` | `string` | `'Toss it? No way! Community repair in the London Borough of Sutton'` | Subtitle displayed in the application header on desktop screens. |
| `venueName` | `string` | `'Seears Park Community Hall, St Dunstans Hill, Sutton SM1 2SW'` | Physical venue name and address displayed on the registration view and session screens. |
| `logoUrl` | `string` | `'/logo.svg'` | Path (inside `public/`) or external URL to your Repair Café logo icon. |
| `contactEmail` | `string` | `'info@suttonrepaircafe.org.uk'` | Public contact email displayed in legal notices and privacy references. |
| `websiteUrl` | `string` | `'https://suttonrepaircafe.org.uk'` | External link to your main community website. |
| `defaultCardRange` | `{ start: number; end: number }` | `{ start: 1, end: 100 }` | Defines the valid range of physical numbered tokens (`#1` to `#100`) used at the Front Desk, PAT Station, and Fixer Station. |
| `allowMultiItemRegistration` | `boolean` | `false` | Controls whether a visitor can register multiple items in a single check-in. When `false`, visitors are limited to **1 item per registration** (enforcing a fair 1-item-per-turn queue). When `true`, an *"Add Another Item"* button appears on `/register`, allowing up to **4 items** per registration. |
| `termsVersion` | `string` | `'2026-04-v1'` | Version identifier recorded alongside the visitor's consent timestamp in `private/customer.termsVersion` for GDPR and liability auditability. Update this string whenever you materially revise `/terms.md`. |
| `termsAndConditions` | `string` | `'/terms.md'` | Path or URL to the Markdown file containing your House Rules, Liability Disclaimer, and GDPR Privacy Notice fetched by the Terms modal on `/register`. |
| `organizerEmails` | `string[]` | `['@suttonrepaircafe.org.uk', ...]` | List of authorised Google email addresses or domain suffixes allowed to access `/frontdesk` and finalize sessions (see [Organizer Authorization](#organizer-authorization-organizeremails)). |
| `hostnameViews` | `Record<string, StationViewId[]>` | *(See below)* | Maps each hostname/subdomain to the ordered list of station views permitted on that host (see [Hostname Matching & View Filtering](#hostname-matching--view-filtering-hostnameviews)). |

---

### Customizing Legal Terms & Safety Policies

Visitor terms and operational safety policies are managed using Markdown files so you can customize them for your community without touching React component code:

1. **[`public/terms.md`](public/terms.md) — Visitor Terms & Conditions / House Rules:**
   * Displayed in a modal on `/register` before a visitor can submit their item.
   * Covers voluntary repair disclaimers, spare parts costs, mandatory PAT electrical testing consent, off-site repair (`TAKEN_HOME`) liability release, and the UK GDPR data retention policy.
2. **[`src/policies/*.md`](src/policies/) — Operational Governance & Safety Policies:**
   * Policy documents stored in [`src/policies/`](src/policies/) are automatically discovered and bundled at build time by [`src/services/policyService.ts`](src/services/policyService.ts).
   * Only the starter template **[`src/policies/POL00-Template.md`](src/policies/POL00-Template.md)** is tracked in git (live policy `.md` files are excluded via `.gitignore` so personal committee/safeguarding contact details are not committed to a public repo). Each policy follows the YAML frontmatter and Markdown layout defined in `POL00-Template.md` (`id`, `title`, `version`, `lastUpdated`, `category`), and files with `category: Template` are automatically hidden from the live UI.
   * Policies are displayed in the **Repair Café Policies** modal across the app and are used when inducting new volunteers in the **Volunteer Register**.
   * 📖 **Full documentation:** See **[`docs/POLICIES.md`](docs/POLICIES.md)** for a complete guide on creating new policies from [`POL00-Template.md`](src/policies/POL00-Template.md) and understanding how YAML frontmatter is parsed.

---

### Organizer Authorization (`organizerEmails`)

Access to the Front Desk (`/frontdesk`) and the backend `finalizeSession` Cloud Function is restricted to authorised organisers using Google Sign-In. Authorization is evaluated in three places:

1. **Frontend Configuration (`cafeConfig.organizerEmails` in [`src/config/cafe.config.ts`](src/config/cafe.config.ts)):**
   * Supports both **exact email addresses** (case-insensitive) and **Google Workspace domain suffixes** starting with `@`:
     ```ts
     organizerEmails: [
       '@suttonrepaircafe.org.uk',      // Any Google account ending in @suttonrepaircafe.org.uk
       'coordinator@example.com',       // A specific personal Gmail / Google account
     ],
     ```
2. **Dynamic Volunteer Register Sync (`settings/system.organizerEmails`):**
   * Whenever an existing organiser adds a volunteer in the Front Desk **Volunteer Register** tab and checks the **Organiser (`isOrganiser`)** box alongside their Google email address, the app automatically syncs that email to `settings/system.organizerEmails` in Firestore—granting them organiser access without needing to redeploy the code.
3. **Backend Cloud Function Configuration ([`functions/src/config.ts`](functions/src/config.ts)):**
   * When finalizing a session, `finalizeSession` checks `settings/system.organizerEmails`, the `ORGANIZER_EMAILS` environment variable (comma-separated, if set on the Cloud Function), and `DEFAULT_ORGANIZER_EMAILS` in `functions/src/config.ts`.

---

### Hostname Matching & View Filtering (`hostnameViews`)

A key architectural feature of the system is **Hostname-Based View Filtering**, implemented in [`src/utils/hostnameViews.ts`](src/utils/hostnameViews.ts) and [`src/App.tsx`](src/App.tsx).

#### Why Hostname Filtering Exists
During a live event, different people interact with the system on different devices:
* **Visitors** scan a public QR code on their own phones and should **only** see the Customer Self-Registration screen (`/register`)—without navigation tabs pointing to internal volunteer stations or organiser sign-in buttons.
* **Volunteer Fixers and PAT Testers** use shared workbench tablets and only need `/fixer` and `/pat`.
* **Organisers** at the reception desk need full access to all 5 views (`/frontdesk`, `/register`, `/pat`, `/fixer`, `/reports`).

Instead of deploying three separate web apps, you deploy the same build once and use `hostnameViews` in [`src/config/cafe.config.ts`](src/config/cafe.config.ts) to control which views are unlocked on each subdomain.

#### Example Configuration

```ts
// Valid StationViewId values: 'register' | 'frontdesk' | 'pat' | 'fixer' | 'reports'
hostnameViews: {
  // Public QR code domain: strictly Customer Self-Registration
  'register.suttonrepaircafe.app': ['register'],

  // Workbench tablets: Fixer Station (default) and PAT Station
  'fixer.suttonrepaircafe.app': ['fixer', 'pat'],

  // Organiser & reception laptops: All 5 stations (defaults to Front Desk)
  'manager.suttonrepaircafe.app': ['frontdesk', 'register', 'pat', 'fixer', 'reports'],
},
```

#### How Hostname Resolution Works (`resolveHostnameViews`)

When the application loads in the browser, [`resolveHostnameViews()`](src/utils/hostnameViews.ts) inspects `window.location.hostname` (lowercased and stripped of any trailing dot) and evaluates four rules in order:

1. **Rule 1 — Exact Production Hostname Match:**
   * If `window.location.hostname` exactly matches a key in `cafeConfig.hostnameViews` (case-insensitive), only the views listed in that array are enabled (`isConfigured: true`).
2. **Rule 2 — Local Subdomain Development Match (`<prefix>.localhost`):**
   * For local testing, if the hostname ends with `.localhost` (for example, `http://fixer.localhost:5173`), the resolver extracts the subdomain prefix (`fixer.`) and matches it against any configured key in `hostnameViews` starting with `fixer.` (such as `fixer.suttonrepaircafe.app`).
   * If no key in `hostnameViews` starts with that prefix (e.g. `unknown.localhost`), it marks the hostname as unconfigured (`isConfigured: false`).
3. **Rule 3 — Bare Localhost Fallback (`localhost`, `127.0.0.1`, `[::1]`):**
   * When developing locally on bare `http://localhost:5173` or `http://127.0.0.1:5173`, all 5 station views (`['register', 'frontdesk', 'pat', 'fixer', 'reports']`) are automatically enabled so developers can test every station without extra setup.
4. **Rule 4 — Unconfigured Hostname Lockdown:**
   * If the browser's hostname does not match Rules 1–3 (or if a matched hostname has an empty array `[]`), `isConfigured` is set to `false` and the application renders the **"Hostname Not Configured"** lockout screen (`UnconfiguredHostnameNotice`), displaying the current hostname and instructing the administrator to add it to `cafeConfig.hostnameViews`.
   * *Note:* This is why you must add your `your-project-id.web.app` domain (or your custom domains) to `hostnameViews` before deploying to production.

#### How Filtered Views Control Routing & UI Chrome

Once `allowedViews` is resolved for the current hostname, [`src/App.tsx`](src/App.tsx) adapts the routing and interface automatically:

| Behavior | How It Works | Example (`register.suttonrepaircafe.app` $\rightarrow$ `['register']`) | Example (`fixer.suttonrepaircafe.app` $\rightarrow$ `['fixer', 'pat']`) |
| :--- | :--- | :--- | :--- |
| **Default Landing Route (`/`)** | Visiting `/` automatically redirects to the **first view** in the hostname's array (`allowedViews[0]`). | `/` redirects to `/register` | `/` redirects to `/fixer` |
| **Route Mounting & Unknown URLs (`*`)** | React Router **only** mounts routes present in `allowedViews`. Navigating to any disallowed path (e.g. typing `/frontdesk` on `register.*`) redirects back to `allowedViews[0]`. | `/frontdesk`, `/pat`, `/fixer`, `/reports` are unmounted and redirect to `/register` | Only `/fixer` and `/pat` are mounted; other paths redirect to `/fixer` |
| **Station Navigation Bar (`showNavigation`)** | The top station switcher bar is rendered **only** when `allowedViews.length > 1`, and only shows buttons for the views in `allowedViews`. | Hidden completely (`allowedViews.length === 1`) | Shows **only** the `Fixer` and `PAT` navigation tabs |
| **Header Auth Controls (`showAuthControls`)** | The Volunteer Auth badge and Organiser Sign-In / Sign-Out buttons in the header are rendered **only** when at least one non-`register` view is allowed (`allowedViews.some(v => v !== 'register')`). | Hidden completely so visitors see a clean, distraction-free check-in page | Shown so volunteers can see their active session authentication status |

---

## 5. Local Development & Testing

To run the application locally on your machine for development or testing:

```bash
# Start the Vite development server (http://localhost:5173)
npm run dev

# Run the Vitest unit test suite (state machine, hostname filtering, auth & GDPR logic)
npm test

# Type-check and build the production bundle
npm run build
```

### Testing Subdomain Filtering Locally

Most modern browsers resolve `*.localhost` directly to `127.0.0.1` without editing `/etc/hosts`. While `npm run dev` is running, you can preview each station profile in your browser:

* **All Stations (Dev Fallback):** `http://localhost:5173`
* **Customer Check-In Only (`['register']`):** `http://register.localhost:5173`
* **Workbench Tablet (`['fixer', 'pat']`):** `http://fixer.localhost:5173`
* **Organiser Full View (`['frontdesk', 'register', 'pat', 'fixer', 'reports']`):** `http://manager.localhost:5173`
* **Unconfigured Hostname Notice:** `http://unconfigured.localhost:5173`

### Managing & Purging Test Sessions (`manage-sessions` CLI)

To inspect sessions, reclassify accidental test sessions, or permanently purge test/training sessions (including orphaned `repairs` and `private/customer` subcollections) from Firestore without opening the Firebase Console, use the built-in CLI utility:

```bash
# List all sessions in Firestore (read-only)
npm run manage-sessions -- --list

# Reclassify an existing session as a Test session (or back to Official)
npm run manage-sessions -- --mark-test <sessionId>
npm run manage-sessions -- --unmark-test <sessionId>

# Preview and permanently purge all test sessions (isTest === true)
npm run manage-sessions -- --purge-all-test
npm run manage-sessions -- --purge-all-test --confirm

# Purge a specific session by ID (requires --force if the session is Official)
npm run manage-sessions -- --purge <sessionId> --confirm
```

For full details on authentication prerequisites, project resolution, safety guardrails, and operational recipes, see **[`docs/MANAGE_SESSIONS_CLI.md`](docs/MANAGE_SESSIONS_CLI.md)**.

### Ingesting Historical CSVs & Merging Volunteers (`ingest-history` & `merge-volunteers` CLI)

To migrate legacy Google Forms CSV exports (`Registration Responses`, `Repair Outcomes`, and `PAT Tests`) into finalized, GDPR-redacted Firestore sessions (`YYYYMMDD-yourspace`) and consolidate any duplicate or auto-enrolled volunteer records:

```bash
# Preview historical CSV ingestion (dry-run)
npm run ingest-history -- \
  --registrations ./registrations.csv \
  --outcomes ./outcomes.csv \
  --pat ./pat.csv \
  --dry-run

# Execute historical CSV ingestion
npm run ingest-history -- \
  --registrations ./registrations.csv \
  --outcomes ./outcomes.csv \
  --pat ./pat.csv \
  --force \
  --confirm

# List all volunteers (highlighting auto-enrolled historical records)
npm run merge-volunteers -- --list

# Preview and merge a duplicate volunteer record across all collections
npm run merge-volunteers -- --from <sourceIdOrName> --into <targetIdOrName> --dry-run
npm run merge-volunteers -- --from <sourceIdOrName> --into <targetIdOrName> --confirm
```

For full documentation on date snapping, brand/volunteer canonicalization, orphan handling, and merge rules, see **[`docs/HISTORICAL_INGEST_CLI.md`](docs/HISTORICAL_INGEST_CLI.md)**.
