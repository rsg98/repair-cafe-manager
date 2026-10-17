# Station 3 Guide: PAT Electrical Safety Tester (`/pat`)

**Audience:** Qualified Volunteer PAT Testers operating the Electrical Safety Station.  
**Route:** `/pat` (or via the **PAT** tab on `https://fixer.suttonrepaircafe.app`)  
**Login Required:** **4-Digit Daily Session PIN** (or an authorised Organiser Google Sign-In).

---

## Overview

Every `240V Mains` electrical appliance brought to the Repair Café must pass through the **PAT Electrical Safety Station** at two points in its lifecycle:

1. **Pre-Repair Screening (PAT 1):** Before a volunteer fixer works on or plugs in a mains appliance, you inspect and test it to verify whether it is safe to energize, has a repairable cord/plug fault, or is a lethal hazard that must be quarantined immediately.
2. **Post-Repair Certification (PAT 2):** After a fixer repairs (or partially repairs) a `240V Mains` appliance, it **must** return to you for a final post-repair PAT test before the visitor is allowed to take it home.

---

## Part 1: Setting Up Your Station at the Start of the Session

### Step 1: Unlock the PAT Station with Today's Session PIN

1. Open `/pat` on the PAT Station tablet.
2. When prompted by the **Volunteer Station Access** dialog, enter the **4-Digit Session PIN** set by the Front Desk organiser today and tap **Unlock Station**.
   * The tablet will stay unlocked for the rest of the session.

---

### Step 2: Select Your Name & Enter Your PAT Instrument Serial Number

At the top of the screen inside the dark **PAT Tester & Instrument Details** bar:

1. **PAT Tester Name:** Select your name from the dropdown list.
   * *Note:* This dropdown **only** displays volunteers who are both **(a) checked into today's session at the Front Desk** and **(b) flagged as `PAT Trained` in the Volunteer Register**. If your name is missing, ask the Front Desk organiser to check you into today's session or tick `PAT Trained` on your profile.
   * If you see `(Induction Pending)` next to your name, tap the **View Policies** button in the top-right corner, review the Health & Safety policy, and ask the Front Desk organiser to confirm your induction.
2. **PAT Instrument Serial #:** Enter the serial number or asset ID of the Portable Appliance Tester you are using today (for example, `KEWTECH-KT71-042` or `SEAWARD-PRIMETEST-100`).
   * Both your name and instrument serial number are saved automatically on the tablet so you do not have to re-enter them for each item.

---

## Part 2: Looking Up an Appliance by Card Number

When an appliance arrives at the PAT bench with a physical numbered card (`#1..#100`) attached:

1. Type the **Card Number** (e.g. `14`) into the **Card Number (`#1–#100`)** box and tap **Find**.
2. The screen will display the item card showing:
   * Physical Card Badge (`#14`), Reference Token (`REF-XXXX`), Brand & Model, Customer Fault Description, and current status.
3. **Automatic Phase Selection:**
   * If the item is newly checked in (`Waiting PAT 1`), the **Pre-Repair (PAT 1)** tab is selected automatically.
   * If the item has just come back from a fixer (`Waiting PAT 2`), the **Post-Repair (PAT 2)** tab is selected automatically.
   * *(You can also switch between the **Pre-Repair (PAT 1)** and **Post-Repair (PAT 2)** tabs manually if you need to re-run a test.)*

---

## Part 3: Conducting Pre-Repair Screening (PAT 1)

Follow the BS 1363 & IET Code of Practice steps on the **Pre-Repair (PAT 1)** form:

### Step 1: Mandatory Visual Inspection
Inspect the appliance casing, mains flex/cord, strain relief grommets, BS 1363 3-pin plug, internal wiring connections inside the plug (if rewireable), and fuse rating:
* Tap **`PASS — Visually Sound`** if no visual defects are present.
* Tap **`FAIL — Visual Defect Found`** if you spot damaged insulation, exposed conductors, cracked casing, or an incorrect/missing plug fuse.

### Step 2: Appliance Classification, Fuse & Test Voltage
1. **Appliance Classification:**
   * `Class I — Earthed Metal (Earth + Insulation)`
   * `Class II — Double Insulated (Insulation Only)`
   * `Class III — SELV (<50V via External PSU)`
   * `Mains Lead / IEC Cord / Adapter`
2. **BS 1363 Plug Fuse Rating:** Select `3A` (up to ~700W), `5A`, `13A` (heating appliances over 700W), or `OTHER`.
3. **Test Voltage Selected:**
   * Select **`500V DC (Standard)`** for standard heating/motor appliances.
   * Select **`250V DC (Surge-Protected / Sensitive Electronics)`** for IT equipment, switched-mode power supplies, or appliances with surge suppression components to avoid damaging sensitive circuitry.

### Step 3: Instrument Measurements
1. **Earth Continuity ($\Omega$):**
   * Enabled for **Class I** appliances and leads (`disabled` automatically for Class II/III).
   * Enter the reading in Ohms (e.g. `0.08`). Standard pass threshold is $\le 0.1\,\Omega + R_{\text{cord}}$.
2. **Insulation Resistance ($\text{M}\Omega$):**
   * Enter the reading in Megaohms (e.g. `19.99` or `200`). Standard pass threshold is $\ge 1.0\,\text{M}\Omega$ for Class I (or $\ge 0.5\,\text{M}\Omega$ for certain heating elements) and $\ge 2.0\,\text{M}\Omega$ for Class II.

### Step 4: Select the PAT 1 Screening Outcome & Caution Notes

Choose one of the four **Pre-Repair Screening Outcomes**:

| Outcome Button | When to Choose It | What Happens Next |
| :--- | :--- | :--- |
| **`PASS (Safe to Energize)`** | Visual inspection and instrument tests pass (the fault is functional, e.g. a broken switch or mechanical belt, not an electrical safety hazard). | Item moves to **`WAITING_REPAIR`**. Place the item in the Fixer Queue. |
| **`FAIL — Repairable Cord/Plug`** | The appliance has a damaged flex, loose plug wiring, or blown/wrong fuse that a competent electrical fixer can replace before energizing. | Item moves to **`WAITING_REPAIR`** and displays a mandatory **Amber Safety Caution Banner** on the Fixer's screen warning them **not** to plug it into mains until the cord/plug is fixed. **Always write clear details in the Notes box.** |
| **`DANGER — Do Not Energize`** | Catastrophic insulation breakdown, live-to-chassis short circuit, water ingress, or lethal hazard that cannot be safely worked on. | Item is **immediately quarantined** as **`UNFIXABLE`** with a pulsing **Red Hazard Banner**. Do **not** send to the Fixer Queue; return to Front Desk for safe disposal advice. |
| **`UNTESTABLE (See Notes)`** | The item cannot be electrically tested prior to repair (e.g. missing proprietary power adapter or completely severed plug). | Item moves to **`WAITING_REPAIR`** with your notes displayed to the fixer. |

5. Add any **Tester Notes / Safety Caution** for the fixer, then tap **Submit Pre-Repair PAT 1**.

---

## Part 4: Conducting Post-Repair Safety Certification (PAT 2)

When a fixer finishes repairing or partially repairing a `240V Mains` item, the system locks the item in **`WAITING_PAT2`** until you certify it:

1. Type the item's **Card Number (`#1..#100`)** and tap **Find**. The **Post-Repair (PAT 2)** tab will open automatically.
2. Perform a full post-repair visual inspection (ensuring all covers, screws, cord grips, and earth bonds have been properly reassembled by the fixer) and select **`PASS — Visually Sound`** or **`FAIL — Visual Defect Found`**.
3. Run the **Earth Continuity ($\Omega$)** (if Class I) and **Insulation Resistance ($\text{M}\Omega$)** tests on the reassembled appliance and enter the readings.
4. Select the **Post-Repair Final Result**:
   * **`PASS — Safe for Collection`:** The appliance is electrically safe to return to the visitor. Submitting moves the item to **`READY_FOR_COLLECTION`**. Send the item and its card back to the **Front Desk**.
   * **`FAIL — Return to Fixer`:** The appliance failed post-repair safety testing (for example, a pinched wire or disconnected earth after reassembly). Enter the reason in **Certification Notes** and submit—the item moves straight back to **`WAITING_REPAIR`** and should be returned to the fixer's bench.
