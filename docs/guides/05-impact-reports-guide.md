# Station 5 Guide: Community Impact Reports (`/reports`)

**Audience:** Repair Café Organisers, Committee Members, Grant Writers, Local Council Partners, and the Public.  
**Route:** `/reports` (or via the **Reports** tab on `https://manager.suttonrepaircafe.app`)  
**Login Required:** None (Publicly readable; contains 100% anonymised session statistics with zero personal data).

---

## Overview

The **Community Impact Reports** view replaces external BI dashboards (such as Looker Studio) with a built-in, zero-cost analytics dashboard. It aggregates the environmental and community impact of every finalized Repair Café session and provides a single-click **CSV Export** formatted for charity grant applications, local council waste-prevention teams, and annual reports.

---

## Step-by-Step Instructions

### Step 1: How Session Data Appears in `/reports`

* Statistics on `/reports` are read from the `analytics/{sessionId}` collection in Firestore.
* An official session appears in `/reports` as soon as a Front Desk organiser clicks **Finalize & Redact Session** on `/frontdesk` at the end of an event.
* **Test / Training Sessions (`isTest: true`) are automatically excluded:** Any session marked as a Test / Training Session is omitted from the cumulative KPI cards, the category breakdown chart, the default Monthly Session Archive table, and the **Export for Grant Report (CSV)** download so rehearsal data never pollutes official figures.
* If you want to pull the latest finalized figures while viewing the page, click the **Refresh** button in the top-right corner.

---

### Step 2: Understanding the Four Cumulative Impact Cards

At the top of the screen, four summary cards display your Repair Café's cumulative impact across all finalized **official** sessions:

1. **Landfill Diverted (`kg e-waste`):**
   * The sum of `weightKg` across all items with an outcome of **`Fixed`** or **`Partially Fixed`**.
   * *Tip for Organisers:* Remind fixers to always enter an estimated weight in kg on `/fixer` when marking an item Fixed or Partially Fixed so your landfill diversion total is accurate.
2. **Repair Success Rate (`%`):**
   * Calculated as:
     $$\text{Success Rate} = \frac{\text{Fixed Items} + \text{Partially Fixed Items}}{\text{Total Items Seen}} \times 100$$
   * Also displays the total number of items fixed out of the total items brought in across all official sessions.
3. **Volunteer Effort (`hrs`):**
   * Total direct repair bench hours logged by fixers (`totalRepairMinutes / 60`).
4. **PAT Screenings (`appliances`):**
   * Total electrical safety tests conducted at the PAT Station, summing both Pre-Repair (`PAT 1`) screenings and Post-Repair (`PAT 2`) certifications.

---

### Step 3: Reviewing the Category Breakdown & Monthly Session Archive

1. **Repairs by Item Category:**
   * Displays a proportional horizontal bar chart comparing how many items were brought in across each category (`ELECTRICAL`, `MECHANICAL`, `TEXTILES`, `WOODWORK`, `TOY`, `OTHER`), helping organisers plan how many fixers of each skill set to recruit for future sessions.
2. **Monthly Session Archive Table:**
   * Lists every finalized official session in reverse chronological order (newest first), showing:
     * **Session Name** and **Date**
     * **Items** (Total items registered)
     * **Fixed** (Count in green)
     * **Partial** (Count in amber)
     * **Unfixable** (Count in red)
     * **Diverted (kg)** (Total weight saved from landfill in that session)
     * **Volunteer Hrs** (Bench repair hours logged in that session)
     * **Volunteers** (Number of volunteers checked into that session)

---

### Step 4: Exporting Data for Grant Applications & Council Reporting (`Export for Grant Report (CSV)`)

When preparing funding bids, charity commission returns, or local authority waste-reduction reports:

1. Click the green **Export for Grant Report (CSV)** button in the top-right corner of `/reports`.
2. Your browser will immediately download a file named `sutton-repair-cafe-impact-YYYY-MM-DD.csv` (which opens directly in Microsoft Excel, Google Sheets, or Apple Numbers).
   * *Note:* Even if an organiser currently has **Show Test Sessions** ticked in the archive table, the CSV export **strictly exports official sessions only** (`isTest !== true`).
3. **Columns Included in the Exported CSV:**
   * `Session ID`
   * `Session Name`
   * `Session Date`
   * `Total Items`
   * `Fixed`
   * `Partial`
   * `Advice Given`
   * `Unfixable`
   * `Taken Home`
   * `Success Rate (%)`
   * `Weight Diverted (kg)`
   * `Total Repair Minutes`
   * `PAT1 Tested`
   * `PAT2 Passed`
   * `Volunteers Attended`
   * `Finalized At`

---

### Step 5: Organiser Tools — Viewing & Reclassifying Test Sessions

When you are signed in with an authorised **Organiser Google Account**, two additional administrative controls appear in the **Session Archive** section:

1. **`Show Test Sessions (N)` Toggle:**
   * Located in the top-right header of the **Session Archive** card.
   * Ticking this box reveals finalized **Test / Training Sessions** in the archive table, highlighted with an amber background and an amber **`TEST`** badge next to the session name.
   * *Note:* Ticking **Show Test Sessions** only displays those rows in the archive table for inspection; the four top KPI cards, the category chart, and the CSV export remain strictly filtered to official sessions.
2. **Reclassifying a Session (`Mark as Test` / `Mark as Official`):**
   * Signed-in organisers see an **Actions** column on the right side of the Session Archive table.
   * If a training or rehearsal session was accidentally finalized as an official session, click **Mark as Test** on its row and confirm the prompt. The app immediately updates both `sessions/{id}` and `analytics/{id}` to `isTest: true`, removes its numbers from the cumulative KPIs and CSV export, and enables **Show Test Sessions** so you can see its updated **`TEST`** badge.
   * Conversely, if an official session was mistakenly marked as a test session, tick **Show Test Sessions** and click **Mark as Official** on its row to restore it to the official impact metrics.
3. **Permanently Purging Historical Test Sessions:**
   * To permanently delete historical test sessions and all of their subcollections from Firestore, use the administrator CLI script documented in **[`docs/MANAGE_SESSIONS_CLI.md`](../MANAGE_SESSIONS_CLI.md)** (`npm run manage-sessions -- --list` / `--purge`).
