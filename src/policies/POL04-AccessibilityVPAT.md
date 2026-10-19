---
id: POL04
title: Accessibility Conformance Report (VPAT 2.5)
version: "2.5"
lastUpdated: "2026-10-19"
category: Accessibility
summary: Official ITI VPAT 2.5 WCAG Edition Accessibility Conformance Report covering WCAG 2.0, 2.1, and 2.2 Level A and Level AA compliance across all 5 Repair Café stations.
---

# Accessibility Conformance Report (ACR) — VPAT® Version 2.5 WCAG Edition

## Product & Assessment Metadata

* **Name of Product/Version:** Repair Café Session Management System (v1.0 — Sutton Repair Café Reference Instance)
* **Report Date:** 2026-10-19
* **Product Description:** Offline-first Progressive Web Application (PWA) for community Repair Café session management across 5 physical stations: Station 1 Customer Self-Registration (`/register`), Station 2 Front Desk Live Board (`/frontdesk`), Station 3 PAT Electrical Safety Station (`/pat`), Station 4 Volunteer Fixer Station (`/fixer`), and Station 5 Community Impact Reports (`/reports`).
* **Contact Information:** `info@suttonrepaircafe.org.uk`
* **Notes:** Single-tenant open-source civic web application designed for tablet, mobile, and desktop browsers in community hall environments.
* **Evaluation Methods Used:** Automated `axe-core` WCAG 2.2 Level A/AA DOM testing across all 5 operational stations and modal dialogs, static source/contrast token verification, and manual keyboard/screen-reader navigation testing.

---

## Applicable Standards / Guidelines

This report covers the degree of conformance for the following accessibility standards and guidelines:

| Standard / Guideline | Included In Report |
| --- | --- |
| **Web Content Accessibility Guidelines (WCAG) 2.0** | Level A (Yes), Level AA (Yes), Level AAA (Yes) |
| **Web Content Accessibility Guidelines (WCAG) 2.1** | Level A (Yes), Level AA (Yes), Level AAA (Yes) |
| **Web Content Accessibility Guidelines (WCAG) 2.2 (ISO/IEC 40500)** | Level A (Yes), Level AA (Yes), Level AAA (Yes) |

---

## Conformance Terminology

The terms used in the Conformance Level information are defined by the Information Technology Industry Council (ITI) as follows:

| Term | Definition |
| --- | --- |
| **Supports** | The functionality of the product has at least one method that meets the criterion without known defects or meets with equivalent facilitation. |
| **Partially Supports** | Some functionality of the product does not meet the criterion. |
| **Does Not Support** | The majority of product functionality does not meet the criterion. |
| **Not Applicable** | The criterion is not relevant to the product. |
| **Not Evaluated** | The product has not been evaluated against the criterion (used only in Level AAA criteria not specifically targeted). |

---

## Table 1: Success Criteria, Level A

| Criteria | Conformance Level | Remarks and Explanations |
| --- | --- | --- |
| **1.1.1 Non-text Content** (Level A) | Supports | All decorative Lucide icons include `aria-hidden="true"`. Informative images (such as uploaded repair item photos in `FixerStationView` and `PhotoViewerModal`) provide descriptive `alt` text, and icon-only buttons provide explicit `aria-label` attributes. |
| **1.2.1 Audio-only and Video-only (Prerecorded)** (Level A) | Not Applicable | The application does not contain prerecorded audio-only or video-only media. |
| **1.2.2 Captions (Prerecorded)** (Level A) | Not Applicable | The application does not contain prerecorded synchronized audio/video media. |
| **1.2.3 Audio Description or Media Alternative (Prerecorded)** (Level A) | Not Applicable | The application does not contain prerecorded video content. |
| **1.3.1 Info and Relationships** (Level A) | Supports | Semantic HTML landmarks (`<header>`, `<nav aria-label="Station navigation">`, `<main id="main-content">`, `<footer>`), explicit `<label htmlFor>` / `id` pairings across all 5 stations, `role="group"` with `aria-labelledby` for segmented button groups, `role="progressbar"` on category breakdown bars, and `<th scope="col">` on all data and Markdown tables preserve structural relationships. |
| **1.3.2 Meaningful Sequence** (Level A) | Supports | DOM order matches visual presentation order across all station views, responsive grids, and modal dialogs. |
| **1.3.3 Sensory Characteristics** (Level A) | Supports | Instructions and safety indicators (such as PAT safety outcomes and queue status badges) combine text labels, icons, and distinct semantic roles rather than relying solely on shape, size, or visual location. |
| **1.4.1 Use of Color** (Level A) | Supports | Item statuses, PAT electrical safety banners (`SafetyBanner`), calibration overdue alerts, and form validation errors always include explicit text labels and icons alongside color coding. |
| **1.4.2 Audio Control** (Level A) | Not Applicable | The application does not play audio automatically. |
| **2.1.1 Keyboard** (Level A) | Supports | All interactive station workflows—including customer registration, Front Desk card assignment, PAT 1/PAT 2 outcome buttons, Fixer time/outcome selectors, photo thumbnail buttons, and the 4-digit volunteer `PinModal` (supporting physical keyboard digits `0`–`9`, `Backspace`, `Delete`, `Enter`, and `Escape`)—are operable via keyboard. |
| **2.1.2 No Keyboard Trap** (Level A) | Supports | All modal dialogs (`TermsModal`, `PinModal`, `PoliciesModal`, `PhotoViewerModal`, `PatInstrumentModal`, and inline modals in `FrontDeskView`, `VolunteerRegisterPanel`, `SessionAttendanceBar`, and `FixerStationView`) use `useDialogFocusTrap` with topmost-dialog stack tracking, `Escape` dismissal, and focus restoration. |
| **2.1.4 Character Key Shortcuts** (Level A 2.1) | Supports | Single-character numeric shortcuts (`0`–`9`) are active only when the modal `PinModal` dialog is open and active for PIN entry. |
| **2.2.1 Timing Adjustable** (Level A) | Supports | No session timeouts or time limits are imposed on customer registration, PAT testing, or repair logging. Offline persistence via IndexedDB preserves state indefinitely during Wi-Fi drops. |
| **2.2.2 Pause, Stop, Hide** (Level A) | Supports | The application contains no auto-updating carousels or scrolling marquees. Loading spinners only appear during active network operations and respect `prefers-reduced-motion`. |
| **2.3.1 Three Flashes or Below Threshold** (Level A) | Supports | No flashing or strobing content exists anywhere in the user interface. |
| **2.4.1 Bypass Blocks** (Level A) | Supports | A keyboard-accessible **Skip to main content** link (`<a href="#main-content">`) is rendered as the first focusable element in `App.tsx`, moving focus directly to `<main id="main-content" tabIndex={-1}>`. |
| **2.4.2 Page Titled** (Level A) | Supports | `<RouteTitleSynchronizer />` in `App.tsx` dynamically updates `document.title` on every route change to identify both the active station and `cafeConfig.cafeName` (e.g., `PAT Safety Station — Sutton Repair Café`). |
| **2.4.3 Focus Order** (Level A) | Supports | Tab order follows the logical top-to-bottom, left-to-right operational workflow. Opening any modal dialog places initial focus inside the dialog and restores focus to the trigger control upon dismissal. |
| **2.4.4 Link Purpose (In Context)** (Level A) | Supports | All links and navigation tabs clearly state their destination or action (e.g., photo download links include explicit `"Download Photo"` text). |
| **2.5.1 Pointer Gestures** (Level A 2.1) | Supports | All interactions use simple single-pointer taps or clicks; no multipoint or path-based gestures are required. |
| **2.5.2 Pointer Cancellation** (Level A 2.1) | Supports | All actions use standard HTML `click` and `submit` events that fire on pointer up-events and can be aborted by moving the pointer away before release. |
| **2.5.3 Label in Name** (Level A 2.1) | Supports | Where visible text is supplemented by an `aria-label` (such as `"Later — dismiss update notice"` in `UpdateBanner.tsx`), the accessible name begins with the exact visible label text. |
| **2.5.4 Motion Actuation** (Level A 2.1) | Not Applicable | No functionality is triggered by device tilting, shaking, or motion sensors. |
| **3.1.1 Language of Page** (Level A) | Supports | The root `index.html` document specifies `<html lang="en">`. |
| **3.2.1 On Focus** (Level A) | Supports | Moving focus to any input, select, button, or tab never triggers an unexpected context change or form submission. |
| **3.2.2 On Input** (Level A) | Supports | Changing form controls or filter dropdowns updates local state predictably without unannounced navigation or disorienting context switches. |
| **3.2.6 Consistent Help** (Level A 2.2) | Supports | Help mechanisms—including the global **Policies & VPAT** button in `Header.tsx`, station guidance cards, and terms links—appear in consistent relative locations across views. |
| **3.3.1 Error Identification** (Level A) | Supports | Validation and submission errors at all stations and modals are displayed in high-contrast text banners with `role="alert"` and descriptive guidance. |
| **3.3.2 Labels or Instructions** (Level A) | Supports | Every form input, select dropdown, textarea, and segmented toggle group has a persistent programmatic label (`<label htmlFor>` or `aria-labelledby`) and format instructions where required (such as 4-character reference tokens or 4-digit PINs). |
| **3.3.7 Redundant Entry** (Level A 2.2) | Supports | Multi-item customer registration (`CustomerRegisterView`) enters visitor contact details once per visit, and `FixerStationView` caches the volunteer's name in `localStorage` so it does not need to be re-entered across repairs. |
| **4.1.1 Parsing** (Level A) | Supports | Marked obsolete in WCAG 2.2; all JSX/HTML elements use unique IDs (`register-item-${idx}-*`), valid nesting, and complete start/end tags. |
| **4.1.2 Name, Role, Value** (Level A) | Supports | All interactive components expose accurate programmatic names, roles (`role="dialog"`, `role="group"`, `role="progressbar"`), and states (`aria-modal="true"`, `aria-pressed`, `aria-current`) verified by automated `axe-core` audits. |

---

## Table 2: Success Criteria, Level AA

| Criteria | Conformance Level | Remarks and Explanations |
| --- | --- | --- |
| **1.2.4 Captions (Live)** (Level AA) | Not Applicable | The application does not broadcast live synchronized audio or video content. |
| **1.2.5 Audio Description (Prerecorded)** (Level AA) | Not Applicable | The application does not contain prerecorded video content. |
| **1.3.4 Orientation** (Level AA 2.1) | Supports | All 5 station views and modal dialogs adapt fluidly between portrait and landscape orientations on tablets, phones, and desktops without locking display orientation. |
| **1.3.5 Identify Input Purpose** (Level AA 2.1) | Supports | Personal data inputs in `CustomerRegisterView` declare standard HTML `autoComplete` tokens (`autoComplete="given-name"` for first name and `autoComplete="tel"` for contact phone). |
| **1.4.3 Contrast (Minimum)** (Level AA) | Supports | All readable text, secondary labels, `(Optional)` captions, empty-state messages, footer text, and `CardToken` badges use `text-slate-600` ($\ge 7.0:1$ on white, $\ge 5.7:1$ on `bg-slate-100`) or darker palettes, exceeding the $4.5:1$ Level AA threshold. |
| **1.4.4 Resize Text** (Level AA) | Supports | `index.html` uses `<meta name="viewport" content="width=device-width, initial-scale=1.0" />` without `maximum-scale` or `user-scalable=no` restrictions, and all typography uses scalable `rem`-based Tailwind utilities supporting zoom up to 200%+. |
| **1.4.5 Images of Text** (Level AA) | Supports | All headings, badges, card tokens (`CardToken`), and metrics are rendered as live styled HTML text rather than raster images of text. |
| **1.4.10 Reflow** (Level AA 2.1) | Supports | Responsive CSS Grid and Flexbox layouts reflow cleanly at 320 CSS pixels width (400% zoom on a 1280px viewport), with horizontal scrolling isolated to multi-column data tables (`overflow-x-auto`). |
| **1.4.11 Non-text Contrast** (Level AA 2.1) | Supports | Form input borders, active button states, focus indicators (`2px solid var(--color-brand-600)`), and category progress bars maintain $\ge 3:1$ contrast against adjacent backgrounds. |
| **1.4.12 Text Spacing** (Level AA 2.1) | Supports | Containers use flexible heights and padding without fixed-pixel clipping, accommodating user stylesheet overrides for line height ($1.5\times$), paragraph spacing ($2\times$), letter spacing ($0.12\text{em}$), and word spacing ($0.16\text{em}$). |
| **1.4.13 Content on Hover or Focus** (Level AA 2.1) | Supports | The application does not rely on custom hover/focus popovers or tooltips that obscure underlying content; all instructions and metadata are rendered inline or in dismissible modal dialogs. |
| **2.4.5 Multiple Ways** (Level AA) | Supports | Users can navigate between all 5 stations via the global `Navigation` bar, direct URL routes (`/register`, `/frontdesk`, `/pat`, `/fixer`, `/reports`), and search/filter controls within the Front Desk queue and Volunteer Register. |
| **2.4.6 Headings and Labels** (Level AA) | Supports | Every view and modal features descriptive headings (`<h1>`–`<h3>`) and specific form labels detailing required measurements (e.g., `Earth Continuity (Ω)`, `Insulation Resistance (MΩ)`, `Estimated Weight (kg)`). |
| **2.4.7 Focus Visible** (Level AA) | Supports | Global CSS (`src/index.css`) enforces a high-contrast `:focus-visible` outline (`2px solid var(--color-brand-600); outline-offset: 2px`) across all interactive controls. |
| **2.4.11 Focus Not Obscured (Minimum)** (Level AA 2.2) | Supports | Sticky headers are compact, and modal overlays trap focus inside the topmost foreground dialog (`useDialogFocusTrap`) so focused elements are never hidden behind sticky banners or background layers. |
| **2.5.7 Dragging Movements** (Level AA 2.2) | Supports | No functionality requires dragging movements; file uploads (`FixerStationView`), photo carousel navigation (`PhotoViewerModal`), and queue transitions all operate via single-click/tap buttons. |
| **2.5.8 Target Size (Minimum)** (Level AA 2.2) | Supports | Interactive buttons, keypad keys (`h-12`), navigation tabs, and form controls meet or exceed the $24 \times 24$ CSS pixel minimum target size with adequate spacing (`gap-2` or greater), and `touch-action: manipulation` prevents accidental double-tap zoom. |
| **3.1.2 Language of Parts** (Level AA) | Supports | All user interface text and policy documents are authored in English (`lang="en"`). |
| **3.2.3 Consistent Navigation** (Level AA) | Supports | The global `Header`, `Navigation` bar, and `Footer` appear in the same order and layout across every station route. |
| **3.2.4 Consistent Identification** (Level AA) | Supports | Shared components (`CardToken`, `SafetyBanner`, `PhotoViewerModal`, `PoliciesModal`, and status badges) use identical labels, icons, and ARIA semantics wherever they appear. |
| **3.3.3 Error Suggestion** (Level AA) | Supports | Validation messages provide actionable correction instructions (e.g., specifying valid card ranges, required PAT measurement fields, or 4-digit PIN formatting). |
| **3.3.4 Error Prevention (Legal, Financial, Data)** (Level AA) | Supports | Destructive or legally significant actions—including Session Finalisation & GDPR PII Redaction, Test Session Purge, Volunteer Removal, PAT Instrument Removal, Photo Deletion, and Taking an Item Home—require explicit two-step confirmation dialogs. |
| **3.3.8 Accessible Authentication (Minimum)** (Level AA 2.2) | Supports | Organiser login uses federated Google OAuth (supporting password managers and passkeys), and volunteer station unlock (`PinModal`) supports both touch keypad and physical keyboard entry without cognitive puzzles or blocked paste/autofill. |
| **4.1.3 Status Messages** (Level AA 2.1) | Supports | Dynamic status updates use appropriate live regions: `role="alert"` on error banners and hazard states in `SafetyBanner`, `role="status"` on `PASS` safety banners, `role="status" aria-live="polite"` on `OfflineNotice`, and a polite live region announcing entered PIN digit counts in `PinModal`. |

---

## Table 3: Success Criteria, Level AAA

| Criteria | Conformance Level | Remarks and Explanations |
| --- | --- | --- |
| **2.1.3 Keyboard (No Exception)** (Level AAA) | Supports | All application functionality is operable through a keyboard interface without requiring specific timings for individual keystrokes. |
| **2.3.3 Animation from Interactions** (Level AAA 2.1) | Supports | Global CSS (`src/index.css`) includes `@media (prefers-reduced-motion: reduce)` rules that disable non-essential animations, transitions, and smooth scrolling when requested by the operating system. |
| **2.4.8 Location** (Level AAA) | Supports | Active station tabs in `Navigation`, active sub-workspace buttons (`aria-pressed`), and active policy cards (`aria-current="true"`) clearly indicate the user's current location. |
| **2.5.6 Concurrent Input Mechanisms** (Level AAA 2.1) | Supports | Users can switch freely between touch, mouse, and physical keyboard input at all stations (including `PinModal` and `FrontDeskView`) without restriction. |
| **All Other WCAG 2.2 Level AAA Criteria** | Not Evaluated | The target conformance level for the Repair Café Session Management System is **WCAG 2.2 Level AA**. Remaining Level AAA criteria are not formally evaluated in this report. |
