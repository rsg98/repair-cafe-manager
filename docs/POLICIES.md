# Repair Café Policies & Volunteer Induction System

This document explains how official Repair Café policies (Health & Safety, Safeguarding, Whistleblowing, Data Protection, etc.) are authored, bundled, and used for volunteer induction inside the **Repair Café Session Management System**.

---

## 1. Overview

Rather than storing policy documents in a single monolithic file or external database, the application manages policies as individual, version-controlled Markdown files inside [`src/policies/`](../src/policies/).

At build time, [`src/services/policyService.ts`](../src/services/policyService.ts) automatically discovers all `.md` files in `src/policies/` using Vite's native `import.meta.glob`, parses their YAML frontmatter metadata, filters out template files, and sorts active policies alphabetically by their policy `id`.

### Where Policies Appear in the App

1. **Front Desk — Repair Café Policies Tab (`/frontdesk`):**
   * Organisers can switch to the **Repair Café Policies** tab at any time to read or show volunteers the full set of active policies in an embedded split-pane reader ([`PoliciesModal.tsx`](../src/components/common/PoliciesModal.tsx)).
2. **Front Desk — Volunteer Register & Session Attendance Bar (`/frontdesk`):**
   * Both the **Volunteer Register** (`VOLUNTEERS` tab) and the **Today's Attending Volunteers** bar include a **Policies** button that opens the Policies viewer modal so an organiser can brief a new volunteer and immediately click **Complete Induction**.
3. **PAT Electrical Safety Station (`/pat`):**
   * The PAT Station includes a **View Policies** button in the top-right corner of the tester bar so electrical testers can reference Health & Safety and PAT procedures directly at the testing bench.

---

## 2. Repository Template & Version Control Privacy

Out of the box, [`src/policies/`](../src/policies/) in the repository contains only the starter template:

| File | Policy ID | Category | Rendered in UI? | Purpose |
| :--- | :--- | :--- | :--- | :--- |
| [`POL00-Template.md`](../src/policies/POL00-Template.md) | `POL00` | `Template` | **No** (Hidden automatically) | Starter template to copy when creating your Repair Café's policy documents. |

> **Why Live Policies Are Excluded from Git (`.gitignore`):**
> Operational policies (such as Health & Safety, Safeguarding, or Whistleblowing documents) typically contain personal contact details for committee members, designated safeguarding leads, and venue managers. To prevent personal data from being committed to a public repository, `.gitignore` ignores `src/policies/*.md` while keeping `!src/policies/POL00-Template.md` tracked. You create your café's live policy files locally in `src/policies/` before building and deploying.

> **Visitor Terms vs. Volunteer Policies:**
> Visitor-facing House Rules and liability disclaimers shown on the public check-in screen (`/register`) are stored separately in [`public/terms.md`](../public/terms.md) (configured via `cafeConfig.termsAndConditions`). The files in `src/policies/` are specifically for **volunteer governance, safety, and induction**.

---

## 3. Policy File Structure & YAML Frontmatter Reference

Every policy file in [`src/policies/`](../src/policies/) starts with a **YAML frontmatter block** enclosed between `---` lines at the very top of the file, followed by standard Markdown content.

### Starter Template (`src/policies/POL00-Template.md`)

```markdown
---
id: POL00
title: Policy Template (Copy to Create a New Policy)
version: "1.0"
lastUpdated: "2026-04-12"
category: Template
summary: Template file for adding new Repair Café policies. Excluded from the app UI automatically when category is Template.
---

# Policy Title

## 1. Purpose & Scope
Briefly state why this policy exists and who it applies to (e.g. all volunteers, visitors, and session organisers at Repair Café events).

## 2. Core Principles
- **Principle 1:** Describe the primary rule or standard of conduct.
- **Principle 2:** Describe supporting expectations and safety/governance boundaries.
- **Principle 3:** Explain how volunteers should act when uncertain.

## 3. Operational Procedures
1. **Before the Session:** Steps organisers or volunteers must take during setup.
2. **During the Session:** Practical guidance while repairing items or assisting visitors.
3. **Escalation & Reporting:** Who to notify (e.g. the Lead Session Organiser at the Front Desk) if an issue or incident occurs.
```

### Frontmatter Fields Reference

| Field | Required? | Fallback if Omitted | Description |
| :--- | :--- | :--- | :--- |
| `id` | Recommended | Filename without `.md` | Short identifier (e.g. `POL01`, `POL02`). Used as the badge label in the UI and for sorting policies in ascending alphabetical order. |
| `title` | Recommended | `name` field, first `# Heading`, or filename | Human-readable title displayed in the policy sidebar and header. |
| `version` | Optional | `"1.0"` | Version string displayed as a badge (e.g. `v1.0`) at the top of the policy reader. |
| `lastUpdated` | Optional | *(None)* | ISO date string (e.g. `"2026-04-12"`) displayed next to the calendar icon in the policy header. |
| `category` | Recommended | `"General"` | Category badge shown in the sidebar and header (e.g. `Safety`, `Safeguarding`, `Governance`, `Data Protection`). **Important:** Any policy with `category: Template` (case-insensitive) is automatically excluded from the UI. |
| `summary` | Optional | *(None)* | A 1–2 sentence summary displayed beneath the policy title in the left navigation sidebar of the Policies viewer. |

---

## 4. How to Create and Customize Policies for Your Repair Café

### Creating a New Policy from the Template
1. Copy [`src/policies/POL00-Template.md`](../src/policies/POL00-Template.md) to a new `.md` file in [`src/policies/`](../src/policies/):
   ```bash
   cp src/policies/POL00-Template.md src/policies/POL01-MyPolicy.md
   ```
2. Edit the YAML frontmatter at the top of your new file:
   * Set a unique `id` (e.g. `POL01`).
   * Set your `title`, `version`, `lastUpdated`, and `summary`.
   * **Change `category` from `Template` to your desired category** (e.g. `Safety`, `Safeguarding`, or `Governance`). *If you leave `category: Template`, the policy will remain hidden from the UI.*
3. Write the policy body below the closing `---` using standard Markdown (`#`, `##`, `###` headings, bullet lists, numbered lists, bold/italic text, horizontal rules `---`, and inline code).
4. Run `npm run build` (and `firebase deploy` when ready). Your new policy will automatically appear in the **Active Policies** sidebar in both `/frontdesk` and `/pat`.

### Editing an Existing Policy
1. Open your policy `.md` file in [`src/policies/`](../src/policies/).
2. Update the content, `version`, and `lastUpdated` date in the YAML frontmatter and Markdown body.
3. Save the file and rebuild the application (`npm run build`).

---

## 5. Volunteer Induction Workflow

The policy system is integrated directly with the **Volunteer Register** (`volunteers` collection in Firestore):

1. When a new volunteer is added to the **Volunteer Register** on `/frontdesk`, their `inducted` status defaults to `false` (`Pending Induction`) unless checked during creation.
2. If an uninducted volunteer is checked into an active session:
   * The **Today's Attending Volunteers** bar on `/frontdesk` displays a prominent **Amber Warning Banner**: *"Policy Induction Required Before Starting Repairs"*.
   * On the `/pat` and `/fixer` stations, the volunteer's name in the dropdown is suffixed with `(Induction Pending)`.
3. An organiser clicks the **Policies** button to review the policies in `src/policies/` with the volunteer, then clicks **Complete Induction** (either on the Session Attendance Bar or in the Volunteer Register row).
4. The system records `inducted: true`, `inductedAt` (ISO timestamp), and `inductedBy` (the organiser's email address) on both the permanent Volunteer Register record and the active session's attendance roster.
