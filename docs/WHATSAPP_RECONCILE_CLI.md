# WhatsApp Group Reconciliation CLI (`npm run whatsapp-reconcile`)

The `whatsapp-reconcile` administrative CLI utility keeps the Repair Café WhatsApp group in sync with the Firestore `volunteers` register (Issue #43) at zero recurring cost.

---

## 1. Prerequisites

Ensure you have Application Default Credentials (ADC) or a service account configured for the target Firebase project:

```bash
export FIREBASE_PROJECT_ID="sutton-repair-cafe"
```

---

## 2. Supported Participant Input Formats (`--file <path>`)

The parser accepts any of the following text exports from WhatsApp:

1. **Plain Text or CSV List** — One phone number (or `Name, Phone`) per line:
   ```text
   Alice Smith, 07700 900111
   +44 7700 900222
   07700900333
   ```
2. **Copied WhatsApp Web / Desktop Group Header** — The comma-separated participant list copied from the top of the WhatsApp Web group info pane:
   ```text
   +44 7700 900111, +44 7700 900222, Alice Smith, ~ Bob Fixer, You
   ```
3. **vCard Contact Export (`.vcf`)** — Standard `BEGIN:VCARD ... END:VCARD` contact cards.
4. **WhatsApp Exported Chat (`_chat.txt`)** — Extracts unique sender numbers and names from message timestamps.

---

## 3. Usage Examples

### A. Preview Reconciliation Report (Dry-Run Default)

Running without `--confirm` performs a read-only comparison and prints the full reconciliation report without modifying Firestore:

```bash
npm run whatsapp-reconcile -- --file ./whatsapp-participants.txt
```

### B. Apply Sync Updates (`PENDING_ADD` $\leftrightarrow$ `ADDED`)

When `--confirm` is passed, the CLI updates volunteers who have already opted into WhatsApp (`whatsappOptIn: true`):
* Volunteers with `whatsappStatus: 'PENDING_ADD'` who are found in the group are marked `'ADDED'`.
* Active volunteers with `whatsappStatus: 'ADDED'` who are missing from the group are reset to `'PENDING_ADD'` so the Front Desk Volunteer Register highlights them as **WhatsApp: Needs Adding**.

```bash
npm run whatsapp-reconcile -- --file ./whatsapp-participants.txt --confirm
```

### C. Initial Setup: Bootstrap Existing Group Members (`--opt-in-matched`)

When onboarding an existing WhatsApp group for the first time, pass `--opt-in-matched` alongside `--confirm` to automatically mark active volunteers found in the group as `whatsappOptIn: true` and `whatsappStatus: 'ADDED'`:

```bash
npm run whatsapp-reconcile -- --file ./whatsapp-participants.txt --opt-in-matched --confirm
```

---

## 4. How Archived Volunteers & Social Group Members Are Handled

When a volunteer is archived in the Front Desk Volunteer Register (`archiveVolunteer`), their plaintext phone number is permanently deleted from Firestore for UK GDPR compliance, while a one-way **SHA-256 hash** of their normalised E.164 phone number (`phoneHash`) is retained on the archived record.

During `npm run whatsapp-reconcile`:
* Each participant phone number in the WhatsApp export is normalised to E.164 (`+447...`) and hashed with SHA-256.
* If a number matches an archived volunteer's `phoneHash` (for example, a former volunteer who remains in the WhatsApp group for social reasons), the CLI recognises them as having a volunteer record and **does not** flag them under **Group Members With No Volunteer Record**.
