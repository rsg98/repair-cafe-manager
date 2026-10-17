# Station 4 Guide: Volunteer Fixer (`/fixer`)

**Audience:** Volunteer Fixers across all repair disciplines (Electrical, Mechanical, Textiles/Sewing, Woodwork, Bicycles, Toys, General).  
**Route:** `/fixer` (or `https://fixer.suttonrepaircafe.app`)  
**Login Required:** **4-Digit Daily Session PIN** (or an authorised Organiser Google Sign-In).

---

## Overview

The **Volunteer Fixer Station** is where repairers look up the item on their workbench using its physical **Card Number (`#1..#100`)**, review any **PAT 1 Electrical Safety Cautions**, and log the repair outcome, time spent, item weight (for landfill diversion tracking), fault diagnosis, and parts used.

---

## Step-by-Step Instructions

### Step 1: Unlock the Station & Select Your Name

1. Open `/fixer` on your workbench tablet or smartphone.
2. If prompted for the **Volunteer Station Access PIN**, enter today's **4-Digit Session PIN** (displayed on the volunteer whiteboard at the Front Desk) and tap **Unlock Station**.
3. In the **Your Name (Fixer)** dropdown at the top of the page, select your name.
   * Your selection is saved automatically on that device so you don't need to re-select it for your next repair unless you are sharing a tablet with another fixer.
   * **Don't see your name in the dropdown?** Only volunteers checked into today's session appear in the list. Ask the Front Desk organiser to click **Edit Session Volunteers** on `/frontdesk` and tick your name.

---

### Step 2: Load the Item by Its Physical Card Number

1. Check the physical numbered card (`#1` to `#100`) attached to the item on your workbench.
2. Type the number (e.g. `14`) into the **Card Number (`#1–#100`)** box and tap **Load**.
3. Review the item header card:
   * **Category & Power Type** (e.g. `ELECTRICAL • MAINS 240V` or `TEXTILES • NOT APPLICABLE`).
   * **Brand & Model** and the visitor's reported **Fault Description**.

---

### Step 3: Check Electrical Safety Banners Before Energizing (`240V Mains` Items)

If the item is a **`240V Mains`** electrical appliance, check its PAT 1 status before plugging it in:

* **Wait if still in `Waiting PAT 1`:** If the status badge says **`Waiting PAT 1`**, do **not** plug the appliance in—take it to the **PAT Electrical Safety Station (`/pat`)** for pre-repair screening first.
* **Amber Safety Caution Banner (`FAIL — Repairable Cord/Plug` or PAT Notes):**
  * Read the PAT Tester's notes and measurements carefully.
  * **De-Energized Repair Only:** Do **NOT** connect the appliance to mains power until the damaged cord, plug wiring, strain relief, or fuse fault identified in PAT 1 has been rectified.
* **Red Quarantine Banner (`DANGER — Do Not Energize`):**
  * The PAT tester found a critical electrical hazard (such as live-to-earth breakdown). The item is quarantined as `UNFIXABLE` and **must never be plugged into mains power**.

---

### Step 4: Carry Out the Repair Together with the Visitor

* Invite the visitor to sit at your workbench, explain what you are checking, and show them how the diagnosis or repair works—sharing practical repair skills is at the heart of the Repair Café mission!
* Remember the Health & Safety policy: use eye protection or gloves where appropriate (e.g. when using adhesives or soldering), take regular breaks, and ask the Lead Organiser or a fellow fixer for a second opinion whenever uncertain.

---

### Step 5: Log the Repair Outcome & Impact Metrics

Once you have finished inspecting or repairing the item, fill in the **Fixer Station** form:

#### 1. Repair Outcome (Select One)
* **`Fixed`:** The fault is fully resolved and the item is working again.
* **`Partially Fixed`:** The item is usable or partially restored, or you have completed the main repair and showed the visitor how to fit a final cosmetic/consumable part.
* **`Advice Given`:** The item could not be fixed on the spot, but you diagnosed the fault, showed the visitor how to maintain/use it, or gave them the exact part number to order for a future session.
* **`Unfixable`:** The item is beyond safe or economical repair (e.g. burnt-out potted transformer, cracked PCB with unavailable IC, or condemned in PAT 1).
* **`Taken Home by Volunteer`:** Choose this **only** if you and the visitor have agreed privately that you will take the item home to complete a complex repair off-site.
  * *Custody Notice:* Selecting `Taken Home by Volunteer` displays an amber confirmation banner noting that the Repair Café's formal custody ends and the off-site repair takes place under an informal private arrangement between you and the visitor.

#### 2. Time Spent (Minutes)
* Tap one of the quick-select buttons (**`15 min`**, **`30 min`**, **`45 min`**, **`60+ min`**) or type the exact number of minutes into the custom box. (There is no need to track start and stop timestamps.)

#### 3. Estimated Weight (`kg`) — *Required for `Fixed` and `Partially Fixed` Items*
* Enter the approximate weight of the item in kilograms (e.g. `1.2`). This number feeds directly into the Repair Café's **Landfill Waste Diverted (`kg`)** metric for council and grant reports.
* **Handy Weight Guide:**
  * Small clothing / toaster / hairdryer / radio / toy: `0.5 kg – 1.5 kg`
  * Kettle / food processor / table lamp / laptop: `1.5 kg – 3.0 kg`
  * Vacuum cleaner / sewing machine / wooden chair: `4.0 kg – 7.0 kg`
  * Microwave / hi-fi amplifier / adult bicycle: `10.0 kg – 15.0 kg`

#### 4. Fault Diagnosis, Repair Notes & Parts Used
* **Fault Diagnosis (Required):** Briefly state what caused the issue (e.g. *"Thermal fuse open-circuit and carbon buildup on thermostat contacts"* or *"Broken stitch on right pocket seam"*).
* **Repair Notes / Actions Taken:** Note what you did (or why it couldn't be fixed / which replacement part the visitor needs to buy).
* **Parts / Consumables Used:** List any fuses, cable, switches, thread, glue, or spares used.

---

### Step 6: Save & Hand Off the Item

Tap **Save Repair Record**. A green confirmation message will tell you where the item goes next:

1. **If the item is `240V Mains` AND you marked it `Fixed` or `Partially Fixed`:**
   * The app automatically routes the item to **`WAITING_PAT2` (Post-Repair PAT 2)**.
   * **Action:** Keep the physical numbered card attached to the appliance and take it (or walk the visitor with it) directly to the **PAT Electrical Safety Station (`/pat`)** for mandatory post-repair safety certification. **Visitors must never take a repaired mains appliance home without passing PAT 2.**
2. **For all Non-Mains items (or items marked `Advice Given`, `Unfixable`, or `Taken Home`):**
   * The app automatically routes the item to **`READY_FOR_COLLECTION`** (or its final state).
   * **Action:** Ask the visitor to take their item and physical numbered card back to the **Front Desk** to check out and return the card.
