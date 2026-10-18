/**
 * @file src/views/FixerStationView.tsx
 *
 * Station 4: Volunteer Fixer Station (`/fixer`).
 *
 * Authenticated via the 4-digit daily session PIN (`{ role: 'volunteer' }`).
 * Allows volunteer fixers to look up repair items by physical Card Number (#1..#N),
 * inspect PAT 1 electrical safety cautions, log repair outcomes, time spent, landfill
 * diversion weight (kg), diagnosis/notes, attach up to 2 client-side compressed item
 * photos (with automatic EXIF/GPS stripping), and confirm custody/contact rules before
 * logging a `TAKEN_HOME` outcome (GitHub Issue #4).
 */

import React, { useState, useEffect, useMemo, useRef } from 'react';
import { 
  Hammer, 
  Search, 
  CheckCircle2, 
  Clock, 
  Scale, 
  Wrench, 
  Home, 
  HelpCircle, 
  XCircle,
  BookOpen,
  AlertTriangle,
  X,
  Camera,
  Trash2,
  Eye,
  ShieldAlert,
  RefreshCw
} from 'lucide-react';
import {
  Session,
  RepairItem,
  RepairOutcome,
  RepairPhoto,
  MAX_PHOTOS_PER_REPAIR
} from '../types';
import { useVolunteerPin } from '../hooks/useVolunteerPin';
import { useRegisterUnsavedWork } from '../context/UnsavedWorkContext';
import {
  getRepairByCardNumber,
  submitRepairRecord,
  fetchRepairPhotos,
  deleteRepairPhoto,
  requiresTakeHomeConfirmation,
  REPAIR_ITEM_LOOKUP_INPUT_PROPS
} from '../services/repairService';
import {
  compressRepairPhoto,
  canAddMorePhotos,
  formatPhotoSizeKb
} from '../utils/imageCompression';
import { CardToken } from '../components/common/CardToken';
import { StatusBadge } from '../components/common/StatusBadge';
import { SafetyBanner } from '../components/common/SafetyBanner';
import { PinModal } from '../components/common/PinModal';
import { PoliciesModal } from '../components/common/PoliciesModal';
import { PhotoViewerModal } from '../components/common/PhotoViewerModal';

/**
 * Props for the `FixerStationView` component.
 */
interface FixerStationViewProps {
  session: Session | null;
}

/**
 * Volunteer Fixer Station view component (`/fixer`).
 *
 * Architectural Note: Kept as a single cohesive station view (>50 lines) so card
 * lookup, repair form state, client-side photo staging, and the pre-submit `TAKEN_HOME`
 * confirmation modal coordinate cleanly with `useRegisterUnsavedWork`.
 */
export const FixerStationView: React.FC<FixerStationViewProps> = ({ session }) => {
  // Enforce daily 4-digit volunteer PIN gate
  const { isUnlocked, unlock, error: pinError } = useVolunteerPin(session);

  // Volunteer persistent settings stored in localStorage
  const [fixerName, setFixerName] = useState(() => localStorage.getItem('fixer_volunteer_name') || '');
  const [showPoliciesModal, setShowPoliciesModal] = useState(false);

  // Sort active session's attending volunteers alphabetically for the Fixer dropdown
  const attendingVolunteers = useMemo(
    () => [...(session?.attendingVolunteers || [])].sort((a, b) => a.name.localeCompare(b.name)),
    [session?.attendingVolunteers]
  );

  // Card search state
  const [searchCardNumber, setSearchCardNumber] = useState('');
  const [searching, setSearching] = useState(false);
  const [currentItem, setCurrentItem] = useState<RepairItem | null>(null);
  const [searchMessage, setSearchMessage] = useState<string | null>(null);

  // Repair form state
  const [outcome, setOutcome] = useState<RepairOutcome>('FIXED');
  const [repairTimeMinutes, setRepairTimeMinutes] = useState<number>(30);
  const [weightKg, setWeightKg] = useState<string>('1.5');
  const [diagnosis, setDiagnosis] = useState('');
  const [repairNotes, setRepairNotes] = useState('');
  const [partsUsed, setPartsUsed] = useState('');
  const [submittingRepair, setSubmittingRepair] = useState(false);
  const [successBanner, setSuccessBanner] = useState<string | null>(null);

  // Item photo state (saved subcollection photos + newly staged compressed photos)
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [existingPhotos, setExistingPhotos] = useState<RepairPhoto[]>([]);
  const [stagedPhotos, setStagedPhotos] = useState<Array<Omit<RepairPhoto, 'id'>>>([]);
  const [compressingPhoto, setCompressingPhoto] = useState(false);
  const [deletingSavedPhotoId, setDeletingSavedPhotoId] = useState<string | null>(null);
  const [photoError, setPhotoError] = useState<string | null>(null);
  const [showPhotoViewerModal, setShowPhotoViewerModal] = useState(false);
  const [photoViewerInitialIndex, setPhotoViewerInitialIndex] = useState<number>(0);
  const [previewStagedPhoto, setPreviewStagedPhoto] = useState<Omit<RepairPhoto, 'id'> | null>(null);

  // Pre-submit confirmation modal state when outcome === 'TAKEN_HOME'
  const [showTakeHomeModal, setShowTakeHomeModal] = useState(false);

  // Prevent automatic PWA reload while a repair record, photo compression, or confirmation modal is active
  const isFixerDirty =
    currentItem !== null ||
    searchCardNumber.trim().length > 0 ||
    searching ||
    submittingRepair ||
    showPoliciesModal ||
    successBanner !== null ||
    stagedPhotos.length > 0 ||
    compressingPhoto ||
    showTakeHomeModal ||
    showPhotoViewerModal ||
    previewStagedPhoto !== null;
  useRegisterUnsavedWork(isFixerDirty, 'fixer-station-view');

  // Validate cached fixerName against the active session's attending volunteer roster
  useEffect(() => {
    if (session && fixerName && !attendingVolunteers.some((v) => v.name === fixerName)) {
      setFixerName('');
    }
  }, [session, attendingVolunteers, fixerName]);

  // Persist selected fixer name to localStorage
  useEffect(() => {
    localStorage.setItem('fixer_volunteer_name', fixerName);
  }, [fixerName]);

  /**
   * Resets all repair form fields, saved/staged photo arrays, and modal flags
   * to prevent state bleed across different physical cards.
   */
  const resetFixerWorkspace = () => {
    // Clear active item and reset diagnostic form fields to defaults
    setCurrentItem(null);
    setOutcome('FIXED');
    setRepairTimeMinutes(30);
    setWeightKg('1.5');
    setDiagnosis('');
    setRepairNotes('');
    setPartsUsed('');
    // Clear saved and staged photo queues and close any open modals
    setExistingPhotos([]);
    setStagedPhotos([]);
    setPhotoError(null);
    setShowTakeHomeModal(false);
    setShowPhotoViewerModal(false);
    setPhotoViewerInitialIndex(0);
    setPreviewStagedPhoto(null);
  };

  // Point lookup of a repair item by its physical Card Number (#1..#N)
  const handleSearchCard = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!session) return;
    const num = parseInt(searchCardNumber, 10);
    if (isNaN(num)) return;

    // Clear previous card's photo queues and modal state before searching
    setSearching(true);
    setSearchMessage(null);
    setSuccessBanner(null);
    setStagedPhotos([]);
    setExistingPhotos([]);
    setPhotoError(null);
    setShowTakeHomeModal(false);
    setShowPhotoViewerModal(false);
    setPreviewStagedPhoto(null);

    try {
      // Execute targeted query by cardNumber to stay within Free Tier read guardrails
      const item = await getRepairByCardNumber(session.id, num);
      if (!item) {
        setSearchMessage(`No item found assigned to Card #${num}.`);
        resetFixerWorkspace();
      } else {
        setCurrentItem(item);

        // Hydrate form fields if re-looking up an item with an existing repair record
        if (item.repair) {
          setOutcome(item.repair.outcome);
          setRepairTimeMinutes(item.repair.repairTimeMinutes ?? 30);
          setDiagnosis(item.repair.diagnosis || '');
          setRepairNotes(item.repair.repairNotes || '');
          setPartsUsed(item.repair.partsUsed || '');
          setWeightKg(item.item.weightKg !== undefined ? String(item.item.weightKg) : '1.5');

          // Hydrate fixerName if not already selected on this tablet
          if (!fixerName.trim() && item.repair.fixerName) {
            setFixerName(item.repair.fixerName);
          }

          // Point-fetch existing photos only when photoCount indicates saved photos exist
          if ((item.repair.photoCount ?? 0) > 0) {
            try {
              const savedPhotos = await fetchRepairPhotos(session.id, item.id);
              setExistingPhotos(savedPhotos);
            } catch {
              setExistingPhotos([]);
            }
          } else {
            setExistingPhotos([]);
          }
        } else {
          // Fresh item without a prior repair submission: reset fields to clean defaults
          setOutcome('FIXED');
          setRepairTimeMinutes(30);
          setDiagnosis('');
          setRepairNotes('');
          setPartsUsed('');
          setWeightKg(item.item.weightKg !== undefined ? String(item.item.weightKg) : '1.5');
          setExistingPhotos([]);
        }
      }
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Error searching card';
      setSearchMessage(message);
    } finally {
      setSearching(false);
    }
  };

  // Compress selected image files on-device (<=800px, <=70KB base64) and stage them for atomic batch save
  const handlePhotoFileSelect = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const selectedFiles = Array.from(e.target.files || []);
    // Reset input value immediately so a removed file can be selected again
    e.target.value = '';
    if (selectedFiles.length === 0) return;

    // Calculate remaining photo capacity across saved and staged photos
    setPhotoError(null);
    const totalCurrent = existingPhotos.length + stagedPhotos.length;
    const remainingSlots = MAX_PHOTOS_PER_REPAIR - totalCurrent;

    if (remainingSlots <= 0) {
      setPhotoError(`Maximum of ${MAX_PHOTOS_PER_REPAIR} photos allowed per repair item.`);
      return;
    }

    // Slice selected files to fit within remaining capacity and notify volunteer if truncated
    const filesToProcess = selectedFiles.slice(0, remainingSlots);
    if (selectedFiles.length > remainingSlots) {
      setPhotoError(
        `Only ${remainingSlots} more photo${remainingSlots === 1 ? '' : 's'} can be added (limit ${MAX_PHOTOS_PER_REPAIR} per item).`
      );
    }

    setCompressingPhoto(true);
    try {
      // Compress each selected image sequentially to keep tablet memory footprint low
      const uploaderLabel = fixerName.trim() || 'Volunteer Fixer';
      const newlyCompressed: Array<Omit<RepairPhoto, 'id'>> = [];
      for (const file of filesToProcess) {
        const compressed = await compressRepairPhoto(file, uploaderLabel);
        newlyCompressed.push(compressed);
      }
      setStagedPhotos((prev) => [...prev, ...newlyCompressed]);
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Failed to compress photo.';
      setPhotoError(message);
    } finally {
      setCompressingPhoto(false);
    }
  };

  // Remove an unsaved staged photo from local state
  const handleRemoveStagedPhoto = (indexToRemove: number) => {
    setStagedPhotos((prev) => prev.filter((_, idx) => idx !== indexToRemove));
    setPhotoError(null);
  };

  // Synchronise existingPhotos and currentItem.repair.photoCount in memory (0 extra Firestore reads)
  const handleSavedPhotosChanged = (remainingPhotos: RepairPhoto[]) => {
    setExistingPhotos(remainingPhotos);
    setCurrentItem((prev) =>
      prev
        ? {
            ...prev,
            repair: prev.repair
              ? { ...prev.repair, photoCount: remainingPhotos.length }
              : prev.repair,
          }
        : null
    );
  };

  // Delete a saved photo directly from its thumbnail card on the Fixer Station
  const handleDeleteSavedPhotoDirectly = async (photo: RepairPhoto) => {
    if (!session || !currentItem) return;
    setDeletingSavedPhotoId(photo.id);
    setPhotoError(null);
    try {
      // Atomically delete photo doc and decrement parent repair.photoCount via writeBatch
      await deleteRepairPhoto(session.id, currentItem.id, photo.id, existingPhotos.length);
      const remaining = existingPhotos.filter((p) => p.id !== photo.id);
      handleSavedPhotosChanged(remaining);
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Failed to delete saved photo.';
      setPhotoError(message);
    } finally {
      setDeletingSavedPhotoId(null);
    }
  };

  // Validate form and intercept TAKEN_HOME outcomes with the mandatory custody/contact warning modal
  const handleSubmitRepair = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!session || !currentItem) return;
    if (!fixerName.trim()) {
      alert('Please select your name from the attending volunteer list.');
      return;
    }

    // Intercept TAKEN_HOME outcome to require explicit volunteer acknowledgement before saving
    if (requiresTakeHomeConfirmation(outcome)) {
      setShowTakeHomeModal(true);
      return;
    }

    await executeSubmitRepair();
  };

  // Persist the repair record and any staged photos atomically via writeBatch
  const executeSubmitRepair = async () => {
    if (!session || !currentItem) return;

    setShowTakeHomeModal(false);
    setSubmittingRepair(true);
    try {
      // Route Mains 240V FIXED/PARTIAL repairs to WAITING_PAT2; others to READY_FOR_COLLECTION
      const isMains = currentItem.item.powerType === 'MAINS_240V';
      const nextStatus = await submitRepairRecord({
        sessionId: session.id,
        repairId: currentItem.id,
        fixerName: fixerName.trim(),
        outcome,
        repairTimeMinutes,
        diagnosis: diagnosis.trim(),
        repairNotes: repairNotes.trim(),
        partsUsed: partsUsed.trim(),
        weightKg: parseFloat(weightKg) || undefined,
        isMainsPower: isMains,
        existingPhotoCount: existingPhotos.length,
        newPhotos: stagedPhotos
      });

      // Build confirmation banner explaining next station routing and saved photo count
      const totalSavedPhotos = existingPhotos.length + stagedPhotos.length;
      let statusMsg = `Repair record submitted for Card #${currentItem.cardNumber}. Outcome: ${outcome}.`;
      if (totalSavedPhotos > 0) {
        statusMsg += ` (${totalSavedPhotos} photo${totalSavedPhotos === 1 ? '' : 's'} saved).`;
      }
      // Append station routing guidance based on calculated next status
      if (nextStatus === 'WAITING_PAT2') {
        statusMsg += ' Item routed to PAT Station for final post-repair safety certification.';
      } else if (nextStatus === 'READY_FOR_COLLECTION') {
        statusMsg += ' Item routed to Front Desk for customer collection.';
      } else if (nextStatus === 'TAKEN_HOME') {
        statusMsg += ' Please return physical Card #' + currentItem.cardNumber + ' to the Front Desk.';
      }

      // Reset form state for the next repair item
      setSuccessBanner(statusMsg);
      setSearchCardNumber('');
      resetFixerWorkspace();
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Error saving repair';
      alert(message);
    } finally {
      setSubmittingRepair(false);
    }
  };

  return (
    <div className="max-w-4xl mx-auto px-4 my-6">
      {/* Station PIN Gate */}
      <PinModal
        isOpen={!isUnlocked}
        stationName="Volunteer Fixer Station"
        onVerify={unlock}
        error={pinError}
      />

      {/* Station Header */}
      <div className="bg-white rounded-3xl p-6 sm:p-8 border border-slate-200 shadow-sm mb-6">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pb-6 border-b border-slate-100">
          {/* Station icon and title */}
          <div className="flex items-center gap-3">
            <div className="h-12 w-12 rounded-2xl bg-blue-100 text-blue-800 flex items-center justify-center">
              <Hammer className="h-6 w-6" />
            </div>
            <div>
              <h2 className="text-xl sm:text-2xl font-black text-slate-900">
                Volunteer Fixer Station
              </h2>
              <p className="text-xs sm:text-sm text-slate-500">
                Log diagnosis, repairs, parts, duration, and outcomes
              </p>
            </div>
          </div>

          {/* Attending Volunteer Dropdown & Policies Reference Button */}
          <div className="flex flex-wrap items-center gap-2 text-xs">
            {/* Attending Volunteer Selector */}
            <select
              aria-label="Select Volunteer Fixer"
              value={fixerName}
              onChange={(e) => setFixerName(e.target.value)}
              className="px-3.5 py-2 rounded-xl border border-slate-300 bg-white font-semibold text-slate-800 focus:outline-none focus:ring-2 focus:ring-blue-500"
            >
              {/* Default placeholder option reflecting checked-in volunteer count */}
              <option value="">
                {attendingVolunteers.length === 0
                  ? 'No Volunteers Checked In Yet'
                  : 'Select Your Name...'}
              </option>
              {/* Render alphabetically sorted attending volunteers */}
              {attendingVolunteers.map((v) => (
                <option key={v.id} value={v.name}>
                  {v.name}{!v.inducted ? ' (Induction Pending)' : ''}
                </option>
              ))}
            </select>
            {/* Quick-access button to view Repair Café policies */}
            <button
              type="button"
              onClick={() => setShowPoliciesModal(true)}
              className="inline-flex items-center gap-1.5 px-3 py-2 rounded-xl border border-slate-200 bg-slate-50 text-slate-700 font-bold hover:bg-slate-100 transition-colors"
              title="View Repair Café Policies"
            >
              <BookOpen className="h-3.5 w-3.5 text-blue-700" />
              Policies
            </button>
          </div>
        </div>

        {/* Warning banner when no volunteers are checked in to the active session */}
        {session && attendingVolunteers.length === 0 && (
          <div className="mt-4 p-3 rounded-xl bg-amber-50 border border-amber-200 text-amber-900 text-xs font-bold flex items-center gap-2">
            <AlertTriangle className="h-4 w-4 text-amber-600 flex-shrink-0" />
            <span>No volunteers checked in — ask Front Desk to update session attendance</span>
          </div>
        )}

        {/* Repair Item Lookup Form (autofill-safe for iOS Safari — Issue #28) */}
        <form onSubmit={handleSearchCard} autoComplete="off" role="search" className="mt-6 flex gap-3">
          <div className="relative flex-1">
            <Search className="h-5 w-5 absolute left-3.5 top-3.5 text-slate-400" />
            {/* Numeric repair item lookup input */}
            <input
              {...REPAIR_ITEM_LOOKUP_INPUT_PROPS}
              id="fixer-repair-item-lookup"
              value={searchCardNumber}
              onChange={(e) => setSearchCardNumber(e.target.value)}
              className="w-full pl-11 pr-4 py-3 rounded-2xl border border-slate-300 text-base font-mono font-bold focus:outline-none focus:ring-2 focus:ring-blue-500 shadow-inner"
            />
          </div>
          {/* Submit button for card lookup */}
          <button
            type="submit"
            disabled={searching || !searchCardNumber}
            className="px-6 py-3 rounded-2xl bg-blue-600 text-white font-bold text-sm hover:bg-blue-700 active:bg-blue-800 disabled:opacity-50 transition-colors shadow-sm"
          >
            {searching ? "Finding..." : "Find Item"}
          </button>
        </form>

        {/* Display lookup warning or informational message */}
        {searchMessage && (
          <div className="mt-4 p-3 rounded-xl bg-blue-50 border border-blue-200 text-blue-900 text-sm font-medium">
            {searchMessage}
          </div>
        )}

        {/* Display repair submission confirmation banner with dismiss button */}
        {successBanner && (
          <div className="mt-4 p-4 rounded-xl bg-emerald-50 border border-emerald-200 text-emerald-900 text-sm font-bold flex items-center justify-between gap-2">
            <div className="flex items-center gap-2">
              <CheckCircle2 className="h-5 w-5 text-emerald-600 flex-shrink-0" />
              <span>{successBanner}</span>
            </div>
            {/* Dismiss button clears the routing banner and releases deferred PWA updates */}
            <button
              type="button"
              onClick={() => setSuccessBanner(null)}
              aria-label="Dismiss confirmation banner"
              className="p-1 rounded-lg text-emerald-700 hover:bg-emerald-100 transition-colors cursor-pointer"
            >
              <X className="h-4 w-4" />
            </button>
          </div>
        )}
      </div>

      {/* Active Repair Card Form */}
      {currentItem && (
        <div className="bg-white rounded-3xl p-6 sm:p-8 border-2 border-blue-400 shadow-md animate-fade-in space-y-6">
          {/* Card Header */}
          <div className="flex flex-wrap items-center justify-between gap-4 pb-4 border-b border-slate-200">
            <div className="flex items-center gap-3">
              <CardToken number={currentItem.cardNumber} size="lg" />
              <div>
                {/* Item brand and model title */}
                <h3 className="text-xl font-black text-slate-900">
                  {currentItem.item.brandModel}
                </h3>
                <p className="text-xs text-slate-500 font-mono">
                  Token: {currentItem.referenceToken} • Category: {currentItem.item.category} • Power: {currentItem.item.powerType}
                </p>
              </div>
            </div>

            {/* Current item status badge */}
            <StatusBadge status={currentItem.status} size="md" />
          </div>

          {/* Safety Warning from PAT 1 if applicable */}
          <SafetyBanner 
            outcome={currentItem.patInitial?.outcome} 
            cautionNotes={currentItem.patInitial?.cautionNotes} 
          />

          {/* Customer reported fault description */}
          <div className="bg-slate-50 p-4 rounded-2xl border border-slate-200 text-sm">
            <span className="text-xs font-bold text-slate-500 uppercase block mb-1">Customer Fault Description</span>
            <p className="text-slate-800 font-medium">{currentItem.item.faultDescription}</p>
          </div>

          {/* Fixer Form */}
          <form onSubmit={handleSubmitRepair} className="space-y-6">
            {/* Outcome Selection */}
            <div>
              <label className="block text-xs font-bold text-slate-800 uppercase tracking-wider mb-2">
                Repair Outcome <span className="text-rose-500">*</span>
              </label>

              {/* Repair outcome button grid */}
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                {/* Outcome: FIXED */}
                <button
                  type="button"
                  onClick={() => setOutcome('FIXED')}
                  className={`p-3.5 rounded-2xl border-2 text-left transition-all ${
                    outcome === 'FIXED'
                      ? 'border-emerald-600 bg-emerald-50 text-emerald-950 shadow-sm'
                      : 'border-slate-200 hover:border-slate-300 text-slate-700'
                  }`}
                >
                  {/* FIXED label and routing hint */}
                  <div className="font-bold flex items-center gap-1.5 text-emerald-900 text-sm">
                    <CheckCircle2 className="h-4 w-4 text-emerald-600" />
                    Fixed / Repaired
                  </div>
                  <p className="text-xs mt-1 text-slate-600">
                    Fully operational. {currentItem.item.powerType === 'MAINS_240V' ? 'Goes to PAT 2.' : 'Ready for pickup.'}
                  </p>
                </button>

                {/* Outcome: PARTIAL */}
                <button
                  type="button"
                  onClick={() => setOutcome('PARTIAL')}
                  className={`p-3.5 rounded-2xl border-2 text-left transition-all ${
                    outcome === 'PARTIAL'
                      ? 'border-blue-600 bg-blue-50 text-blue-950 shadow-sm'
                      : 'border-slate-200 hover:border-slate-300 text-slate-700'
                  }`}
                >
                  {/* PARTIAL label and description */}
                  <div className="font-bold flex items-center gap-1.5 text-blue-900 text-sm">
                    <Wrench className="h-4 w-4 text-blue-600" />
                    Partially Fixed
                  </div>
                  <p className="text-xs mt-1 text-slate-600">
                    Usable with minor limitation or needs user cleaning.
                  </p>
                </button>

                {/* Outcome: ADVICE_GIVEN */}
                <button
                  type="button"
                  onClick={() => setOutcome('ADVICE_GIVEN')}
                  className={`p-3.5 rounded-2xl border-2 text-left transition-all ${
                    outcome === 'ADVICE_GIVEN'
                      ? 'border-purple-600 bg-purple-50 text-purple-950 shadow-sm'
                      : 'border-slate-200 hover:border-slate-300 text-slate-700'
                  }`}
                >
                  {/* ADVICE_GIVEN label and description */}
                  <div className="font-bold flex items-center gap-1.5 text-purple-900 text-sm">
                    <HelpCircle className="h-4 w-4 text-purple-600" />
                    Advice Given
                  </div>
                  <p className="text-xs mt-1 text-slate-600">
                    Recommended replacement part or specialized repair guidance.
                  </p>
                </button>

                {/* Outcome: UNFIXABLE */}
                <button
                  type="button"
                  onClick={() => setOutcome('UNFIXABLE')}
                  className={`p-3.5 rounded-2xl border-2 text-left transition-all ${
                    outcome === 'UNFIXABLE'
                      ? 'border-rose-600 bg-rose-50 text-rose-950 shadow-sm'
                      : 'border-slate-200 hover:border-slate-300 text-slate-700'
                  }`}
                >
                  {/* UNFIXABLE label and description */}
                  <div className="font-bold flex items-center gap-1.5 text-rose-900 text-sm">
                    <XCircle className="h-4 w-4 text-rose-600" />
                    Unfixable / End of Life
                  </div>
                  <p className="text-xs mt-1 text-slate-600">
                    Sealed unit, missing critical IC, or cost/safety prohibitive.
                  </p>
                </button>

                {/* Outcome: TAKEN_HOME */}
                <button
                  type="button"
                  onClick={() => setOutcome('TAKEN_HOME')}
                  className={`p-3.5 rounded-2xl border-2 text-left transition-all ${
                    outcome === 'TAKEN_HOME'
                      ? 'border-sky-600 bg-sky-50 text-sky-950 shadow-sm'
                      : 'border-slate-200 hover:border-slate-300 text-slate-700'
                  }`}
                >
                  {/* TAKEN_HOME label and custody notice */}
                  <div className="font-bold flex items-center gap-1.5 text-sky-900 text-sm">
                    <Home className="h-4 w-4 text-sky-600" />
                    Taken Home to Finish
                  </div>
                  <p className="text-xs mt-1 text-slate-600">
                    Private agreement between volunteer & visitor. Releases cafe custody.
                  </p>
                </button>
              </div>
            </div>

            {/* Repair Duration (Minutes) & Weight */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-6 pt-4 border-t border-slate-100">
              {/* Repair Time Selector (As requested: simplified repairTime in minutes) */}
              <div>
                <label className="block text-xs font-bold text-slate-700 mb-2 flex items-center gap-1">
                  <Clock className="h-4 w-4 text-slate-500" />
                  Estimated Time Spent (Minutes)
                </label>
                {/* Quick duration buttons and custom minute input */}
                <div className="flex gap-2">
                  {[15, 30, 45, 60].map((mins) => (
                    <button
                      key={mins}
                      type="button"
                      onClick={() => setRepairTimeMinutes(mins)}
                      className={`flex-1 py-2 rounded-xl text-xs font-bold border transition-all ${
                        repairTimeMinutes === mins
                          ? 'bg-blue-600 text-white border-blue-700 shadow-sm'
                          : 'bg-slate-100 text-slate-700 border-slate-200 hover:bg-slate-200'
                      }`}
                    >
                      {mins}m
                    </button>
                  ))}
                  {/* Custom duration numeric input */}
                  <input
                    type="number"
                    min={5}
                    max={240}
                    value={repairTimeMinutes}
                    onChange={(e) => setRepairTimeMinutes(parseInt(e.target.value, 10) || 15)}
                    className="w-16 text-center text-xs font-bold font-mono py-2 rounded-xl border border-slate-300"
                    title="Custom minutes"
                  />
                </div>
              </div>

              {/* Item Weight for Landfill Diversion Metrics */}
              <div>
                <label className="block text-xs font-bold text-slate-700 mb-2 flex items-center gap-1">
                  <Scale className="h-4 w-4 text-slate-500" />
                  Item Weight Diverted (kg)
                </label>
                {/* Weight in kg input */}
                <input
                  type="number"
                  step="0.1"
                  min="0.1"
                  placeholder="e.g. 1.8"
                  value={weightKg}
                  onChange={(e) => setWeightKg(e.target.value)}
                  className="w-full px-3.5 py-2 rounded-xl border border-slate-300 text-sm font-mono font-bold"
                />
              </div>
            </div>

            {/* Diagnosis & Notes */}
            <div className="space-y-4 pt-4 border-t border-slate-100">
              {/* Root cause diagnosis field */}
              <div>
                <label className="block text-xs font-bold text-slate-700 mb-1">
                  Diagnosis / What was the root cause?
                </label>
                <input
                  type="text"
                  placeholder="e.g. Blown thermal fuse; corroded contact; gummed up grease in gears."
                  value={diagnosis}
                  onChange={(e) => setDiagnosis(e.target.value)}
                  className="w-full px-3.5 py-2.5 rounded-xl border border-slate-300 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
              </div>

              {/* Repair actions and notes field */}
              <div>
                <label className="block text-xs font-bold text-slate-700 mb-1">
                  Repair Actions & Notes
                </label>
                <textarea
                  rows={2}
                  placeholder="e.g. Desoldered broken switch, lubricated drive motor, replaced internal wiring with high-temp silicone wire."
                  value={repairNotes}
                  onChange={(e) => setRepairNotes(e.target.value)}
                  className="w-full px-3.5 py-2.5 rounded-xl border border-slate-300 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
              </div>

              {/* Parts and materials used field */}
              <div>
                <label className="block text-xs font-bold text-slate-700 mb-1">
                  Parts / Materials Used (if any)
                </label>
                <input
                  type="text"
                  placeholder="e.g. 10A microswitch, 1x heat shrink tubing, 13A UK plug top."
                  value={partsUsed}
                  onChange={(e) => setPartsUsed(e.target.value)}
                  className="w-full px-3.5 py-2.5 rounded-xl border border-slate-300 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
              </div>
            </div>

            {/* Optional Item Photos Section (Client-Side WebP/JPEG Compressed, <= 2 Photos) */}
            <div className="space-y-3 pt-4 border-t border-slate-100">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div>
                  <label className="block text-xs font-bold text-slate-800 uppercase tracking-wider flex items-center gap-1.5">
                    <Camera className="h-4 w-4 text-blue-600" />
                    Item Photos (Optional — {existingPhotos.length + stagedPhotos.length} / {MAX_PHOTOS_PER_REPAIR})
                  </label>
                  {/* Mandatory UK GDPR & Safeguarding reminder */}
                  <p className="text-xs text-slate-500 mt-0.5">
                    <strong>Photo Guidelines:</strong> Photograph the item only — do not include visitor faces, children, or personal name/address labels. Photos are automatically compressed and stripped of location data.
                  </p>
                </div>

                {/* Hidden file input supporting mobile camera capture and photo library selection */}
                <input
                  ref={fileInputRef}
                  type="file"
                  accept="image/*"
                  multiple
                  onChange={handlePhotoFileSelect}
                  className="hidden"
                />

                {/* Trigger button for adding or capturing a photo */}
                {canAddMorePhotos(existingPhotos.length, stagedPhotos.length) && (
                  <button
                    type="button"
                    disabled={compressingPhoto || submittingRepair}
                    onClick={() => fileInputRef.current?.click()}
                    className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-xl bg-blue-50 border border-blue-200 text-blue-800 text-xs font-bold hover:bg-blue-100 disabled:opacity-50 transition-colors cursor-pointer"
                  >
                    {compressingPhoto ? (
                      <>
                        <RefreshCw className="h-3.5 w-3.5 animate-spin text-blue-600" />
                        Compressing...
                      </>
                    ) : (
                      <>
                        <Camera className="h-3.5 w-3.5 text-blue-600" />
                        Add / Take Item Photo
                      </>
                    )}
                  </button>
                )}
              </div>

              {/* Photo compression or validation error alert */}
              {photoError && (
                <div className="p-3 rounded-xl bg-rose-50 border border-rose-200 text-rose-800 text-xs font-semibold flex items-center gap-2">
                  <AlertTriangle className="h-4 w-4 text-rose-600 flex-shrink-0" />
                  <span>{photoError}</span>
                </div>
              )}

              {/* Thumbnail Grid: Saved Subcollection Photos + Newly Staged Photos */}
              {(existingPhotos.length > 0 || stagedPhotos.length > 0) && (
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 pt-1">
                  {/* Saved photos already persisted in Firestore */}
                  {existingPhotos.map((photo, idx) => (
                    <div
                      key={photo.id}
                      className="flex items-center justify-between gap-3 p-2.5 rounded-2xl border border-slate-200 bg-slate-50"
                    >
                      {/* Thumbnail image and Saved badge */}
                      <div className="flex items-center gap-3 min-w-0">
                        <img
                          src={photo.dataUrl}
                          alt={`Saved item photo ${idx + 1}`}
                          onClick={() => {
                            setPhotoViewerInitialIndex(idx);
                            setShowPhotoViewerModal(true);
                          }}
                          className="h-14 w-14 rounded-xl object-cover border border-slate-200 bg-slate-900 flex-shrink-0 cursor-pointer"
                          title="Click to view full photo"
                        />
                        <div className="min-w-0">
                          <span className="inline-block px-2 py-0.5 rounded bg-emerald-100 text-emerald-800 text-[10px] font-bold uppercase">
                            Saved
                          </span>
                          <p className="text-xs text-slate-500 font-mono mt-0.5 truncate">
                            {photo.width}×{photo.height}px • {formatPhotoSizeKb(photo.sizeBytes)}
                          </p>
                        </div>
                      </div>

                      {/* View in PhotoViewerModal or delete saved photo directly */}
                      <div className="flex items-center gap-1.5 flex-shrink-0">
                        {/* Open PhotoViewerModal at this photo's index */}
                        <button
                          type="button"
                          onClick={() => {
                            setPhotoViewerInitialIndex(idx);
                            setShowPhotoViewerModal(true);
                          }}
                          className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-xl bg-white border border-slate-200 text-slate-700 text-xs font-bold hover:bg-slate-100 transition-colors cursor-pointer"
                          title="View or download saved photo"
                        >
                          <Eye className="h-3.5 w-3.5 text-blue-600" />
                          View
                        </button>
                        {/* Direct trash button to delete saved photo via deleteRepairPhoto */}
                        <button
                          type="button"
                          disabled={deletingSavedPhotoId === photo.id}
                          onClick={() => handleDeleteSavedPhotoDirectly(photo)}
                          aria-label={`Delete saved photo ${idx + 1}`}
                          className="p-1.5 rounded-xl bg-white border border-rose-200 text-rose-600 hover:bg-rose-50 disabled:opacity-50 transition-colors cursor-pointer"
                          title="Delete saved photo"
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </button>
                      </div>
                    </div>
                  ))}

                  {/* Newly staged photos awaiting Submit Repair Record */}
                  {stagedPhotos.map((staged, idx) => (
                    <div
                      key={`staged-${idx}`}
                      className="flex items-center justify-between gap-3 p-2.5 rounded-2xl border border-blue-200 bg-blue-50/50"
                    >
                      {/* Staged thumbnail image and "New • XX KB" badge */}
                      <div className="flex items-center gap-3 min-w-0">
                        <img
                          src={staged.dataUrl}
                          alt={`Staged item photo ${idx + 1}`}
                          onClick={() => setPreviewStagedPhoto(staged)}
                          className="h-14 w-14 rounded-xl object-cover border border-blue-200 bg-slate-900 flex-shrink-0 cursor-pointer"
                          title="Click to preview full photo"
                        />
                        <div className="min-w-0">
                          <span className="inline-block px-2 py-0.5 rounded bg-blue-100 text-blue-800 text-[10px] font-bold uppercase">
                            New • {formatPhotoSizeKb(staged.sizeBytes)}
                          </span>
                          <p className="text-xs text-slate-600 font-mono mt-0.5 truncate">
                            {staged.width}×{staged.height}px • EXIF Stripped
                          </p>
                        </div>
                      </div>
                      <div className="flex items-center gap-1.5 flex-shrink-0">
                        {/* Preview staged photo */}
                        <button
                          type="button"
                          onClick={() => setPreviewStagedPhoto(staged)}
                          aria-label={`Preview staged photo ${idx + 1}`}
                          className="p-1.5 rounded-xl bg-white border border-slate-200 text-slate-700 hover:bg-slate-100 transition-colors cursor-pointer"
                          title="Preview photo"
                        >
                          <Eye className="h-3.5 w-3.5 text-blue-600" />
                        </button>
                        {/* Remove staged photo before submission using X button */}
                        <button
                          type="button"
                          onClick={() => handleRemoveStagedPhoto(idx)}
                          aria-label={`Remove staged photo ${idx + 1}`}
                          className="p-1.5 rounded-xl bg-white border border-rose-200 text-rose-600 hover:bg-rose-50 transition-colors cursor-pointer"
                          title="Remove staged photo"
                        >
                          <X className="h-3.5 w-3.5" />
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* Form cancellation and submission actions */}
            <div className="flex justify-end gap-3 pt-4 border-t border-slate-100">
              <button
                type="button"
                onClick={resetFixerWorkspace}
                className="px-5 py-2.5 rounded-xl border border-slate-300 text-sm font-semibold text-slate-700 hover:bg-slate-50"
              >
                Cancel
              </button>
              {/* Submit repair record button */}
              <button
                type="submit"
                disabled={submittingRepair || compressingPhoto}
                className="px-6 py-2.5 rounded-xl bg-blue-600 text-white text-sm font-bold hover:bg-blue-700 disabled:opacity-50 shadow-sm"
              >
                {submittingRepair ? 'Submitting...' : 'Submit Repair Record'}
              </button>
            </div>
          </form>
        </div>
      )}

      {/* Pre-Submit Confirmation Modal when Outcome === 'TAKEN_HOME' */}
      {showTakeHomeModal && currentItem && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4"
          role="dialog"
          aria-modal="true"
          aria-labelledby="take-home-modal-title"
        >
          {/* Taken Home custody, insurance, and GDPR contact warning card */}
          <div className="w-full max-w-lg rounded-3xl bg-white p-6 sm:p-7 shadow-2xl border-2 border-amber-300 space-y-5">
            {/* Warning modal header and icon */}
            <div className="flex items-start gap-3.5">
              <div className="h-12 w-12 rounded-2xl bg-amber-100 text-amber-800 flex items-center justify-center flex-shrink-0">
                <ShieldAlert className="h-6 w-6 text-amber-700" />
              </div>
              <div>
                <h3 id="take-home-modal-title" className="text-lg font-black text-slate-900">
                  Confirm Taking Item Home (Card #{currentItem.cardNumber})
                </h3>
                <p className="text-xs text-slate-600 mt-0.5">
                  Please confirm you have completed these steps with the visitor before submitting:
                </p>
              </div>
            </div>

            {/* Three mandatory operational and legal checkpoints */}
            <div className="space-y-3 text-xs sm:text-sm text-slate-700 bg-amber-50/70 p-4 rounded-2xl border border-amber-200">
              {/* Checkpoint 1: Private agreement outside Repair Café custody & insurance */}
              <div className="flex items-start gap-2.5">
                <span className="h-5 w-5 rounded-full bg-amber-200 text-amber-900 font-black text-xs flex items-center justify-center flex-shrink-0 mt-0.5">
                  1
                </span>
                <p>
                  <strong className="text-slate-900">Private Agreement Outside Café Insurance:</strong>{' '}
                  Under Repair Café Terms &amp; Conditions (§6), taking an item off-site is a private arrangement between you and the visitor. It is no longer in Repair Café custody or covered by Repair Café insurance.
                </p>
              </div>
              {/* Checkpoint 2: Exchange contact details directly before GDPR session scrub */}
              <div className="flex items-start gap-2.5">
                <span className="h-5 w-5 rounded-full bg-amber-200 text-amber-900 font-black text-xs flex items-center justify-center flex-shrink-0 mt-0.5">
                  2
                </span>
                <p>
                  <strong className="text-slate-900">Exchange Contact Details With the Visitor Now:</strong>{' '}
                  Make sure you have taken down the visitor&apos;s phone number or email directly. All visitor contact details stored in this app are automatically scrubbed to <code className="font-mono bg-amber-100 px-1 py-0.5 rounded text-amber-900">[REDACTED]</code> when today&apos;s session is closed (UK GDPR).
                </p>
              </div>
              {/* Checkpoint 3: Return physical reusable card token to Front Desk */}
              <div className="flex items-start gap-2.5">
                <span className="h-5 w-5 rounded-full bg-amber-200 text-amber-900 font-black text-xs flex items-center justify-center flex-shrink-0 mt-0.5">
                  3
                </span>
                <p>
                  <strong className="text-slate-900">Return Physical Card #{currentItem.cardNumber}:</strong>{' '}
                  Ensure the physical numbered card is returned to the Front Desk so it stays with the session set.
                </p>
              </div>
            </div>

            {/* Cancel / Go Back or Confirm & Submit buttons */}
            <div className="flex flex-col-reverse sm:flex-row justify-end gap-3 pt-2">
              <button
                type="button"
                disabled={submittingRepair}
                onClick={() => setShowTakeHomeModal(false)}
                className="px-5 py-2.5 rounded-xl border border-slate-300 text-xs sm:text-sm font-bold text-slate-700 hover:bg-slate-50 cursor-pointer"
              >
                Cancel / Go Back
              </button>
              {/* Confirm and execute atomic repair submission */}
              <button
                type="button"
                disabled={submittingRepair}
                onClick={executeSubmitRepair}
                className="px-5 py-2.5 rounded-xl bg-sky-700 text-white text-xs sm:text-sm font-bold hover:bg-sky-800 disabled:opacity-50 shadow-sm cursor-pointer"
              >
                {submittingRepair ? 'Submitting...' : 'Confirm & Submit Record'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Lightbox Modal for Previewing an Unsaved Staged Photo */}
      {previewStagedPhoto && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm p-4"
          role="dialog"
          aria-modal="true"
        >
          {/* Staged photo preview modal container */}
          <div className="w-full max-w-lg rounded-3xl bg-white p-5 shadow-2xl border border-slate-200 space-y-4">
            {/* Header with dimensions and close button */}
            <div className="flex items-center justify-between">
              <span className="text-sm font-black text-slate-900">
                Staged Photo Preview ({previewStagedPhoto.width}×{previewStagedPhoto.height}px • {formatPhotoSizeKb(previewStagedPhoto.sizeBytes)})
              </span>
              <button
                type="button"
                onClick={() => setPreviewStagedPhoto(null)}
                aria-label="Close staged photo preview"
                className="p-1.5 rounded-xl text-slate-500 hover:bg-slate-100 cursor-pointer"
              >
                <X className="h-5 w-5" />
              </button>
            </div>
            {/* Full-size staged image container */}
            <div className="rounded-2xl overflow-hidden bg-slate-900 flex items-center justify-center max-h-[60vh]">
              <img
                src={previewStagedPhoto.dataUrl}
                alt="Staged repair item preview"
                className="max-h-[58vh] w-auto object-contain"
              />
            </div>
            {/* Footer Done button */}
            <div className="flex justify-end">
              <button
                type="button"
                onClick={() => setPreviewStagedPhoto(null)}
                className="px-4 py-2 rounded-xl bg-slate-800 text-white text-xs font-bold hover:bg-slate-900 cursor-pointer"
              >
                Done
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Saved Subcollection Photo Viewer / Downloader / Two-Step Delete Modal */}
      {session && currentItem && (
        <PhotoViewerModal
          isOpen={showPhotoViewerModal}
          onClose={() => setShowPhotoViewerModal(false)}
          sessionId={session.id}
          repairItem={currentItem}
          initialPhotos={existingPhotos}
          initialIndex={photoViewerInitialIndex}
          onPhotosChange={handleSavedPhotosChanged}
        />
      )}

      {/* Repair Café Policies Reference Modal */}
      <PoliciesModal
        isOpen={showPoliciesModal}
        onClose={() => setShowPoliciesModal(false)}
      />
    </div>
  );
};
