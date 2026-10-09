# Repair Café Session Management System

An open-source, serverless, offline-first Web application and PWA designed to manage community Repair Café sessions (e.g. [Sutton Repair Café](https://suttonrepaircafe.org.uk)).

Built with **React 18, TypeScript, Tailwind CSS, Vite PWA**, and **Google Firebase** (Auth, Firestore, Cloud Functions v2). Designed to run **100% within the Firebase Free Tier** ($0.00/month).

---

## Features

1. **Station 1: Customer Self-Registration (`/register` — Public)**
   * Mobile/tablet check-in via entrance QR code.
   * Collects minimal details (First Name, optional mobile).
   * **Fair Queue Enforcement:** Configurable single-item check-in (`allowMultiItemRegistration: false`, default for Sutton Repair Café).
   * Mandatory agreement to the repair café's terms & house rules.
   * Displays high-contrast Reference Token (e.g., `REF-A38F`).

2. **Station 2: Front Desk Live Board (`/frontdesk` — Google Auth)**
   * Authenticated organizer portal for launching monthly sessions.
   * Maps customer reference tokens to physical reusable numbered cards (#1..#N).
   * Automatically routes 240V mains appliances to PAT screening, and mechanical/low-voltage items to the repair queue.
   * Live queue status counters and customer checkout.
   * Session finalization and automated GDPR phone number redaction.

3. **Station 3: PAT Electrical Safety Station (`/pat` — 4-Digit Session PIN)**
   * PIN-protected tablet interface for qualified PAT testers.
   * Pre-repair inspection (PAT 1): Visual check, BS 1363 fuse rating (3A/5A/13A), test voltage (250V vs 500V DC), Earth continuity (Class I), Insulation resistance.
   * Dedicated handling for repairable cord/plug faults (`FAIL_REPAIRABLE_CORD`) vs lethal shock hazards (`DANGER_DO_NOT_ENERGIZE`).
   * Post-repair safety certification (PAT 2) before appliances can be returned to visitors.

4. **Station 4: Volunteer Fixer Station (`/fixer` — 4-Digit Session PIN)**
   * Point-lookup by Card Number (#1..#N).
   * High-visibility safety banners for appliances with cord defects or PAT notes.
   * Simplified **repair time in minutes** logging (15 / 30 / 45 / 60+ min) without burdensome start/end timestamps.
   * Item weight tracking (kg) for landfill diversion reporting.
   * Formal handoff recording for informal home repairs (`TAKEN_HOME`).

5. **Station 5: Community Impact Reports (`/reports` — Free Looker Studio Alternative)**
   * Real-time metrics: Repair success rate (%), landfill waste diverted (kg), volunteer hours invested.
   * Single-click CSV export formatted for local council and grant funder submissions.

---

## Reusing for Your Repair Café (Single-Tenant Setup)

Each repair café deploys its own standalone instance into their own free Firebase project.

### Step 1: Customize Branding & Policy
Edit `src/config/cafe.config.ts`:
```typescript
export const cafeConfig = {
  cafeName: "Your Town Repair Café",
  tagline: "Fixing things together for our community",
  venueName: "Community Hall",
  logoUrl: "/logo.svg",
  contactEmail: "info@yourtownrepaircafe.org",
  websiteUrl: "https://yourtownrepaircafe.org",
  defaultCardRange: { start: 1, end: 100 },
  allowMultiItemRegistration: false, // Set to true if your cafe allows multiple items per customer
  termsAndConditions: `...Your legal terms...`
};
```

### Step 2: Set Environment Variables
Copy `.env.example` to `.env`:
```bash
VITE_FIREBASE_API_KEY="your-api-key"
VITE_FIREBASE_AUTH_DOMAIN="your-project.firebaseapp.com"
VITE_FIREBASE_PROJECT_ID="your-project"
VITE_FIREBASE_STORAGE_BUCKET="your-project.appspot.com"
VITE_FIREBASE_MESSAGING_SENDER_ID="1234567890"
VITE_FIREBASE_APP_ID="1:1234567890:web:demoapp"
```

### Step 3: Deploy to Firebase (Free Tier)
```bash
# 1. Install dependencies
npm install
cd functions && npm install && cd ..

# 2. Build frontend and cloud functions
npm run build
cd functions && npm run build && cd ..

# 3. Deploy hosting, firestore security rules, indexes, and cloud functions
firebase deploy
```

Refer to [`docs/BUDGET_ALERTS.md`](./docs/BUDGET_ALERTS.md) to set up a £1.00/month billing alert to guarantee $0.00 expenses.

---

## Agentic Maintenance & Development

For AI coding agents or developers looking to understand the system architecture, state machines, and coding rules, consult [`AGENTS.md`](./AGENTS.md).

