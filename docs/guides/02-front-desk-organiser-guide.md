# Station 2 Guide: Front Desk Organiser (`/frontdesk`)

**Audience:** Lead Session Organisers & Reception Desk Coordinators.  
**Route:** `/frontdesk` (or `/desk` alias, or `https://manager.suttonrepaircafe.app`)  
**Login Required:** **Google Sign-In** with an authorised Organiser email address.

---

## Overview

The **Front Desk** is the operational control centre of the Repair Café. From this screen, organisers:
1. Maintain the **Volunteer Register**, emergency contacts, and policy inductions.
2. Start the monthly session, set the **4-digit daily volunteer PIN**, and record which volunteers are attending today.
3. Map visitors' `REF-XXXX` check-in tokens to reusable physical numbered cards (`#1..#100`), automatically routing `240V Mains` items to **PAT 1** and non-mains items to the **Fixer Queue**.
4. Monitor queue wait times, look up visitor phone numbers when repairs are ready, and check out completed items.
5. **Finalize & Redact** the session at the end of the event—aggregating impact statistics and permanently scrubbing visitor personal data (PII) for UK GDPR compliance.

---

## Part 1: Signing In & Managing the Volunteer Register (Before the Doors Open)

### Step 1: Sign In with Your Organiser Google Account

1. Open `/frontdesk` on the reception laptop or tablet.
2. Click **Sign in with Google** and select your authorised Google account.
   * *Troubleshooting:* If you see an **"Unauthorized Google Account"** screen, your email address is not yet listed as an Organiser. Ask an existing organiser to tick the **Organiser** checkbox on your profile in the **Volunteer Register** tab (or add your email to `organizerEmails` in `src/config/cafe.config.ts`).

---

### Step 2: Check the Volunteer Register & Induct New Volunteers (`VOLUNTEERS` Tab)

1. Click the **Volunteer Register** tab at the top of the Front Desk screen.
2. To add a new volunteer arriving for their first session, click **+ Add Volunteer** and fill in:
   * **Full Name** (Required — this is how their name appears on the Fixer and PAT stations).
   * **Phone Number** and **Email Address** (Required if granting Organiser access).
   * **Emergency Contact Details** (Required — Name, Phone Number, and Relationship).
   * **Roles & Qualifications:**
     * **Session Organiser:** Tick if this volunteer should be able to sign into `/frontdesk` with their Google account.
     * **PAT Tester Qualified:** Tick if this volunteer is trained and authorised to operate the PAT Electrical Safety Station (`/pat`).
     * **Policy Inducted:** Tick once you have briefed the volunteer on the Health & Safety, Safeguarding, and Whistleblowing policies.
3. Click **Save Volunteer**.
4. **Inducting an Existing Volunteer:** If a volunteer is marked `Pending Induction`, click **View Policies** (or switch to the **Repair Café Policies** tab) to walk them through the policies, then click the green **Confirm Induction** button next to their name.

---

## Part 2: Starting the Repair Café Session

1. Switch back to the **Session Queue** tab.
2. If no session is currently running, you will see the **Start New Repair Café Session** panel:
   * **Session Name:** Defaults to e.g. `Sutton Repair Café - October 2026` (customise if needed).
   * **Session Date:** Defaults to today's date (`YYYY-MM-DD`).
   * **4-Digit Volunteer PIN:** Enter a 4-digit number for today's event (for example, `4829`). **Write this PIN on the volunteer whiteboard**—fixers and PAT testers will enter it once to unlock `/fixer` and `/pat` on their tablets.
   * **Attending Volunteers Today:** Tick all volunteers who have arrived for today's session (use the search box or **Select All** to speed this up).
     * *Why this matters:* Only volunteers ticked as attending today will appear in the name dropdowns on the Fixer Station (`/fixer`) and PAT Station (`/pat`).
3. Click **Launch Session**.

---

## Part 3: Running the Reception Queue During the Event

### 1. Managing Late-Arriving Volunteers & Emergency Contacts
Near the top of the **Session Queue** tab sits the **Today's Attending Volunteers** bar:
* **Late Arrivals:** When a volunteer arrives mid-session, click **Edit Session Volunteers**, tick their name, and click **Save Attendance**. Their name will immediately appear on the `/fixer` and `/pat` stations.
* **Pending Inductions:** If an attending volunteer hasn't been inducted yet, an **Amber Banner** appears with a one-click **Complete Induction: [Name]** button.
* **Emergency Contacts:** In the event of an accident or medical emergency, **click any volunteer's name badge** in the attendance bar (or click the **Heart Pulse icon** in the Volunteer Register) to immediately open their **Emergency Contact Card**.

---

### 2. Setting Up Tablet Card Partitions (If Using 2 Reception Devices)
If two reception volunteers are assigning physical cards simultaneously on two tablets (or if venue Wi-Fi is unstable):
* Use the **Tablet Partition** selector above the queue table:
  * Set Tablet 1 to **`Tablet A (1-50)`** and place physical cards `#1` to `#50` next to it.
  * Set Tablet 2 to **`Tablet B (51-100)`** and place physical cards `#51` to `#100` next to it.
* This prevents both tablets from accidentally assigning the same card number if the Wi-Fi drops briefly. If you only use one Front Desk device, leave it set to **`All Cards (1-100)`**.

---

### 3. Checking In a Visitor & Assigning a Physical Card (`#1..#100`)
When a visitor approaches the Front Desk after registering on `/register`:

1. Ask for their **First Name** or **4-Character Reference Token** (e.g. `REF-A38F`).
2. Locate their row in the queue (items needing a card show a blue **`Registered (Needs Card)`** badge and appear at the top when filtered by `Needs Card #`, or you can type their name/token into the **Search** box).
3. Pick up the next unused physical numbered card (e.g. **Card `#14`**).
4. Type `14` into the **`Card #`** input box on their row and click **Assign**.
   * *Duplicate Protection:* If Card `#14` has already been used today, the app will block the assignment with an alert so you can pick a fresh card.
5. **Direct the Visitor & Item Based on Automatic Routing:**
   * **If the item is `240V Mains`:** Its status automatically changes to **`Waiting PAT 1`** (Amber). Attach the physical card to the appliance and direct it to the **PAT Electrical Safety Station** first.
   * **If the item is Battery / Mechanical / Textile / Woodwork:** Its status automatically changes to **`Waiting for Fixer`** (Purple). Attach the physical card and place the item in the appropriate **Fixer Queue**.

---

### 4. Monitoring the Live Queue & Calling Visitors for Collection
* **First-Come, First-Served (FCFS) Ordering:** Active items are sorted by registration time, with a live **Wait Time** counter (`15m`, `1h 10m`, etc.) so you can spot anyone who has been waiting a long time.
* **Filtering by Stage:** Use the **Status Filter** dropdown to view only items in `Waiting PAT 1`, `Waiting for Fixer`, `Waiting PAT 2`, or `Ready for Pickup`.
* **Viewing a Visitor's Phone Number (`i` Button):**
  * If an item reaches **`Ready for Pickup`** (or if a fixer needs to ask the owner a question) and the visitor isn't in the hall, click the circular **`i` (Info)** button on the right side of their row.
  * A secure modal will fetch and display their **Mobile Phone Number** and T&C consent details so you can call or text them.

---

### 5. Checking Out Collected Items (`Done`)
When a visitor collects their item from the Front Desk (`Ready for Pickup`, `Unfixable`, or `Taken Home by Volunteer`):

1. Recover the physical numbered card (`#1..#100`) from the visitor (unless the item is `Taken Home`, where you still recover the physical card before the volunteer leaves).
2. Click the green **Done** button on the right side of the item's row.
3. The item's status changes to **`Completed & Collected`**, and the row turns grey and moves to the bottom of the table.
   * **Important — Do NOT Reuse Physical Cards in the Same Session:** Even after an item is marked `Done`, its original `Card #` stays recorded on that row for auditability, and the system will prevent that card number from being reassigned during the remainder of today's session. Put recovered cards into a separate *"Returned Today"* tray to be reused next month.

---

## Part 4: Closing Down — Finalizing & Redacting the Session (End of Day)

At the end of the Repair Café event, once all visitors have collected their items and all fixers/PAT testers have logged their results:

1. Check the live summary cards at the top of `/frontdesk` to make sure no items are still stuck in `Needs Card #`, `PAT 1 Queue`, `Repair Queue`, or `PAT 2 Queue`.
2. In the top-right session header, click the dark **Finalize & Redact Session** button.
3. Read the confirmation prompt and click **OK**.
4. **What happens automatically:**
   * All repair outcomes, weights diverted (`kg`), volunteer repair minutes, and PAT test counts are aggregated and saved to the public **Impact Reports (`/reports`)** archive.
   * Every visitor's **First Name** and **Mobile Phone Number** across all items in the session are permanently overwritten with `"[REDACTED]"` in Firestore to comply with UK GDPR Article 5(1)(e).
   * The active session is closed (`FINALIZED`) and the local browser IndexedDB cache is purged so no personal data lingers on the reception computer.
