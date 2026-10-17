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
* A session appears in `/reports` as soon as a Front Desk organiser clicks **Finalize & Redact Session** on `/frontdesk` at the end of an event.
* If you want to pull the latest finalized figures while viewing the page, click the **Refresh** button in the top-right corner.

---

### Step 2: Understanding the Four Cumulative Impact Cards

At the top of the screen, four summary cards display your Repair Café's cumulative impact across all finalized sessions:

1. **Landfill Diverted (`kg e-waste`):**
   * The sum of `weightKg` across all items with an outcome of **`Fixed`** or **`Partially Fixed`**.
   * *Tip for Organisers:* Remind fixers to always enter an estimated weight in kg on `/fixer` when marking an item Fixed or Partially Fixed so your landfill diversion total is accurate.
2. **Repair Success Rate (`%`):**
   * Calculated as:
     $$\text{Success Rate} = \frac{\text{Fixed Items} + \text{Partially Fixed Items}}{\text{Total Items Seen}} \times 100$$
   * Also displays the total number of items fixed out of the total items brought in across all sessions.
3. **Volunteer Effort (`hrs`):**
   * Total direct repair bench hours logged by fixers (`totalRepairMinutes / 60`).
4. **PAT Screenings (`appliances`):**
   * Total electrical safety tests conducted at the PAT Station, summing both Pre-Repair (`PAT 1`) screenings and Post-Repair (`PAT 2`) certifications.

---

### Step 3: Reviewing the Category Breakdown & Monthly Session Archive

1. **Repairs by Item Category:**
   * Displays a proportional horizontal bar chart comparing how many items were brought in across each category (`ELECTRICAL`, `MECHANICAL`, `TEXTILES`, `WOODWORK`, `TOY`, `OTHER`), helping organisers plan how many fixers of each skill set to recruit for future sessions.
2. **Monthly Session Archive Table:**
   * Lists every finalized session in reverse chronological order (newest first), showing:
     * **Session Name** and **Date**
     * **Items** (Total items registered)
     * **Fixed** (Count in green)
     * **Partial** (Count in amber)
     * **Unfixable** (Count in red)
     * **Diverted (kg)** (Total weight saved from landfill in that session)
     * **Volunteer Hrs** (Bench repair hours logged in that session)

---

### Step 4: Exporting Data for Grant Applications & Council Reporting (`Export CSV for Grants`)

When preparing funding bids, charity commission returns, or local authority waste-reduction reports:

1. Click the green **Export CSV for Grants** button in the top-right corner of `/reports`.
2. Your browser will immediately download a file named `sutton-repair-cafe-impact-YYYY-MM-DD.csv` (which opens directly in Microsoft Excel, Google Sheets, or Apple Numbers).
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
   * `Finalized At`
