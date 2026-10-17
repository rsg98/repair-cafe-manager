# Station 1 Guide: Customer Self-Registration (`/register`)

**Audience:** Visitors bringing broken items to the Repair Café, and Entrance Greeters / Triage Volunteers assisting visitors on a reception tablet.  
**Route:** `/register` (or the dedicated public subdomain, e.g. `https://register.suttonrepaircafe.app`)  
**Login Required:** None (Public access while a session is active and registration is open).

---

## Overview

The **Customer Self-Registration** view is the first step in a Repair Café session. Visitors either scan a QR code poster at the entrance using their own smartphone or use a shared check-in tablet to register their broken item, accept the Repair Café's House Rules, and receive a **4-character Reference Token** (e.g. `REF-A38F`) to take to the Front Desk.

---

## Step-by-Step Instructions

### Step 1: Open the Registration Page

1. Scan the **Repair Café Check-In QR Code** with your phone's camera, or approach the entrance check-in tablet.
2. Check that the green session banner at the top of the screen shows today's active session name and venue (for example, `Sutton Repair Café — October 2026`).
   * *Note for Greeters:* If the screen says **"No Active Session Found"** or **"Registration Currently Paused"**, ask the Lead Organiser at the Front Desk (`/frontdesk`) to start today's session or re-open registration.

---

### Step 2: Enter Your Details

Under **Section 1 — Your Details**:

1. **First Name (Required):** Enter your first name so volunteers and the Front Desk can call you when it is your turn.
2. **Mobile Phone (Optional):** Enter your mobile number if you would like the Front Desk to call or text you when your repair is finished (for example, if you pop out while waiting).
   * **Privacy & UK GDPR Note:** Your phone number is stored in a restricted, encrypted area visible **only** to the Front Desk organiser (never on volunteer workbench tablets) and is **permanently deleted** at the end of today's session.

---

### Step 3: Enter Your Broken Item Details

Under **Section 2 — Item to Repair**:

1. **Category (Required):** Choose the category that best matches your item:
   * `Electrical` (toasters, lamps, kettles, vacuum cleaners, radios, hi-fi, hairdryers, etc.)
   * `Mechanical` (bicycles, clocks, sewing machines, garden tools, prams, etc.)
   * `Textiles` (clothing, bags, zips, seams, soft furnishings, darning, etc.)
   * `Woodwork` (chairs, small tables, wooden boxes, picture frames, joints, etc.)
   * `Toy` (electronic or mechanical toys, plush toys, board game parts, etc.)
   * `Other` (jewellery, ceramics, umbrellas, or anything else)
2. **Power Type (Required):**
   * The form automatically selects the most common power type for your chosen category (for example, `Electrical` defaults to **`240V Mains (Plug)`**, and `Textiles`/`Woodwork` default to **`None / Not Applicable`**).
   * **Important Safety Check:** If your item plugs into a wall socket (or uses a detachable 240V mains power lead/adapter), ensure **`240V Mains (Plug)`** is selected so it is routed through mandatory electrical safety testing (**PAT 1**).
   * If your electrical item is powered purely by batteries or a USB cable without a mains brick, change the dropdown to **`Battery / Low Voltage`**.
3. **Brand & Model (Required):** Enter the make and model of the item (e.g. `Dualit 2-Slice Toaster`, `Dyson V8 Vacuum`, `Brompton Folding Bike`, or `Blue Denim Jacket`).
4. **What is the fault? (Required):** Briefly describe what has gone wrong or what needs fixing (e.g. *"Left side doesn't heat up and lever won't stay down"* or *"Zipper slider has come off on the left track"*).

#### Registering More Than One Item
* **Standard 1-Item Fair Queue Rule:** Most Repair Cafés limit check-in to **1 item per registration** so everyone in the queue gets a fair turn. If you brought a second item, you can register it after your first item has been seen.
* **Multi-Item Mode (If Enabled by the Café):** If the café has enabled multi-item check-in (`allowMultiItemRegistration: true`), click the **+ Add Another Item** button to add up to 4 items before submitting.

---

### Step 4: Read & Accept the House Rules and Terms

1. In the **Terms & Conditions** box, click **Read Rules** (or click the *"Repair Café Terms & House Rules"* link) to open the House Rules modal.
2. Review the key community rules:
   * Repairs are carried out free of charge by volunteers (donations are welcome), but **no guarantee** can be given that an item can be fixed.
   * Visitors are encouraged to sit with the fixer and watch/assist so repair skills are shared.
   * Any replacement parts or consumables needed must be supplied or paid for by the visitor.
   * All `240V Mains` electrical items must undergo pre-repair and post-repair **PAT Electrical Safety Testing**.
3. Click **I Agree & Accept Terms** inside the modal (or tick the consent checkbox).

---

### Step 5: Submit & Take Your Reference Token to the Front Desk

1. Click the green **Register & Get Reference Token** button.
2. Your screen will display a large **4-Character Reference Token** inside a dark badge, such as:
   ```
   REF-A38F
   ```
3. **Keep this screen open** (or take a screenshot) and walk up to the **Front Desk**:
   * Show the Front Desk organiser your `REF-XXXX` token.
   * They will hand you a physical numbered **Item Card** (e.g. **`Card #12`**) to attach to your item and tell you whether to head to the **PAT Electrical Safety Station** (for 240V mains appliances) or wait for the next available **Volunteer Fixer**.

---

### Step 6: Checking Live Progress or Registering Another Item

* **Live Status Refresh:** While waiting on the confirmation screen, tap the **Refresh Status** icon in the top-right corner of the *"Registered Items"* card to see your assigned physical **Card Number (`#12`)** and live queue status (`Waiting PAT 1`, `Waiting for Fixer`, `Waiting PAT 2`, or `Ready for Pickup`).
* **Next Visitor / Shared Tablet:** If you are using a shared entrance tablet (or want to register another item), tap **Register Another Item** at the bottom of the confirmation screen to clear the form for the next person.
