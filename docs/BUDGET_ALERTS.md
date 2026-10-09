# Firebase & Google Cloud Budget Alerts & Free-Tier Guardrails

Repair Cafés are volunteer community organizations operating with zero fixed income. This application is architected from the ground up to operate **permanently within the Google Cloud / Firebase Free Tier** ($0.00/month).

A card-backed **Firebase Blaze Plan** is required strictly for Cloud Functions v2 deployment. Follow this guide to guarantee safety against accidental runaway expenses.

---

## 1. Firebase Free-Tier Quota Allowances vs. Repair Café Usage

| Service | Free Tier Allowance (Every Day) | Typical Repair Café Monthly Session | % of Free Quota Used |
|---|---|---|---|
| **Firestore Document Reads** | **50,000 reads / day** | ~1,850 reads / session | **< 3.7%** |
| **Firestore Document Writes** | **20,000 writes / day** | ~220 writes / session | **< 1.1%** |
| **Firestore Storage** | **1 GiB total storage** | ~0.004 GiB (years of data) | **< 0.4%** |
| **Cloud Functions Invocations**| **2,000,000 calls / month** | ~50 calls / session | **< 0.002%** |
| **Firebase Hosting Transfer** | **10 GiB / month** | ~0.15 GiB / month | **< 1.5%** |

---

## 2. Setting Up a £1.00 / Month Hard Budget Alert in Google Cloud Console

To guarantee you are alerted immediately if anything unusual occurs:

1. Open the [Google Cloud Billing Console](https://console.cloud.google.com/billing).
2. Select your Repair Café billing account.
3. In the left navigation, click **Budgets & alerts** $\rightarrow$ **Create Budget**.
4. Set the budget properties:
   * **Scope:** Select your Repair Café Firebase project.
   * **Time range:** Monthly.
   * **Amount:** Target amount = **£1.00** (or your local equivalent $1.00 / €1.00).
5. Set alert threshold rules:
   * **50% of budget** (£0.50): Email billing account administrators.
   * **90% of budget** (£0.90): Email billing account administrators.
   * **100% of budget** (£1.00): Email billing account administrators + send Pub/Sub notification.

---

## 3. Disabling Billing on Exceeding Budget (Cloud Function Circuit Breaker)

If you wish to automatically disable billing or cap services if the £1 budget is ever reached, you can connect the Pub/Sub alert to a standard GCP Cloud Function that disables project billing:

1. Enable the **Cloud Billing API**.
2. Follow the official Google guide: [Cap spending by disabling billing](https://cloud.google.com/billing/docs/how-to/notify#cap_disable_billing).

---

## 4. Key Architectural Safeguards in this Codebase

1. **Point Queries for Stations:** Fixer and PAT stations use direct `getDoc` point queries by Card # rather than subscribing to full collection snapshots, cutting read operations by 90%.
2. **IndexedDB Local Cache:** Multi-tab persistence retains session state in the browser's IndexedDB across page reloads.
3. **One-Time Registration Lookup:** The visitor registration confirmation screen uses a one-time read instead of real-time listener.
4. **Chunked 400-Doc Batch Redaction:** The `finalizeSession` Cloud Function chunks writes into batches of 400, strictly respecting Firestore's 500-operation transaction limits.
