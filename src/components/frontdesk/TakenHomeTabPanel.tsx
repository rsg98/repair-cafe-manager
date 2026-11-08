/**
 * @file src/components/frontdesk/TakenHomeTabPanel.tsx
 *
 * Front Desk Organiser "Taken Home" Management Panel (`/frontdesk`).
 *
 * Allows Google-authenticated organisers to view items taken home across all
 * Repair Café sessions, inspect retained customer contact details (`private/customer`)
 * alongside matched volunteer fixer contact details (`Volunteer[]`), filter between
 * unresolved items and resolved history, and open an accessible modal to either save
 * interim progress notes (`TAKEN_HOME`) or complete and close the repair record
 * (`FIXED`, `PARTIAL`, `ADVICE_GIVEN`, `UNFIXABLE`) with automatic UK GDPR PII redaction.
 *
 * Architectural Note: Kept as a cohesive Front Desk panel module (>50 lines) so
 * customer PII hydration, table filtering, photo staging, and the focus-trapped
 * Organiser Taken-Home Repair Modal coordinate cleanly.
 */

import React, { useState, useEffect, useRef } from 'react';
import {
  Home,
  Search,
  RefreshCw,
  Phone,
  Mail,
  Camera,
  CheckCircle2,
  Wrench,
  HelpCircle,
  XCircle,
  Clock,
  Scale,
  ShieldCheck,
  AlertTriangle,
  Trash2,
  Eye,
  X,
} from 'lucide-react';
import {
  TakenHomeRepairEntry,
  Volunteer,
  RepairItem,
  RepairOutcome,
  RepairPhoto,
  PrivateCustomerData,
  MAX_PHOTOS_PER_REPAIR,
} from '../../types';
import {
  getPrivateCustomerData,
  isUnresolvedTakenHomeItem,
  isResolvedTakenHomeItem,
  isCustomerPiiRedacted,
  matchVolunteerByFixerName,
  sortAndFilterTakenHomeEntries,
  submitOrganiserTakenHomeUpdate,
  fetchRepairPhotos,
  deleteRepairPhoto,
} from '../../services/repairService';
import {
  compressRepairPhoto,
  canAddMorePhotos,
  formatPhotoSizeKb,
} from '../../utils/imageCompression';
import { useDialogFocusTrap } from '../../hooks/useDialogFocusTrap';
import { CardToken } from '../common/CardToken';
import { StatusBadge } from '../common/StatusBadge';

/**
 * Props accepted by the {@link TakenHomeTabPanel} component.
 */
export interface TakenHomeTabPanelProps {
  /** Cross-session and live active-session taken-home entries. */
  entries: TakenHomeRepairEntry[];
  /** Whether cross-session taken-home entries are currently loading. */
  loading: boolean;
  /** Active and archived volunteers from the Volunteer Register for contact matching. */
  volunteers: Volunteer[];
  /** Signed-in organiser's email address for resolution audit attribution. */
  organizerEmail?: string | null;
  /** Callback to reload persisted taken-home entries from Firestore. */
  onRefresh: () => Promise<void> | void;
  /** Callback to open the shared Front Desk PhotoViewerModal for an item. */
  onOpenPhotoViewer: (sessionId: string, repairItem: RepairItem) => void;
  /** Optional callback notifying FrontDeskView when the modal opens or closes (`isFrontDeskDirty`). */
  onModalOpenChange?: (isOpen: boolean) => void;
}

/**
 * Formats a human-readable badge label for a `RepairOutcome`.
 */
function formatOutcomeLabel(outcome?: RepairOutcome): string {
  // Map each final RepairOutcome enum value to its organiser display label
  switch (outcome) {
    case 'FIXED':
      return 'Fixed / Repaired';
    case 'PARTIAL':
      return 'Partially Fixed';
    case 'ADVICE_GIVEN':
      return 'Advice Given';
    // Handle terminal unfixable and default in-progress taken-home states
    case 'UNFIXABLE':
      return 'Unfixable';
    case 'TAKEN_HOME':
    default:
      return 'Taken Home (In Progress)';
  }
}

/**
 * Returns Tailwind CSS classes with >= 4.5:1 WCAG AA contrast for an outcome pill.
 */
function getOutcomeBadgeClasses(outcome?: RepairOutcome): string {
  // Select accessible dark-on-light badge palette matching the outcome disposition
  switch (outcome) {
    case 'FIXED':
      return 'bg-emerald-100 text-emerald-900 border-emerald-300';
    case 'PARTIAL':
      return 'bg-blue-100 text-blue-900 border-blue-300';
    case 'ADVICE_GIVEN':
      return 'bg-purple-100 text-purple-900 border-purple-300';
    // Use rose for unfixable and sky blue for in-progress taken-home items
    case 'UNFIXABLE':
      return 'bg-rose-100 text-rose-900 border-rose-300';
    case 'TAKEN_HOME':
    default:
      return 'bg-sky-100 text-sky-900 border-sky-300';
  }
}

/**
 * Formats an epoch timestamp (ms) into an ISO `YYYY-MM-DD` date string.
 */
function formatDateShort(epochMs?: number): string {
  if (!epochMs || !Number.isFinite(epochMs)) return '—';
  // Convert epoch ms to UTC YYYY-MM-DD calendar date
  return new Date(epochMs).toISOString().split('T')[0];
}

/**
 * Renders the segregated customer contact cell (`private/customer`) without nested ternaries.
 */
function renderCustomerContactCell(
  isLoadingPii: boolean,
  piiRedacted: boolean,
  pii: PrivateCustomerData | null | undefined
): React.ReactNode {
  // Show loading placeholder while fetching private/customer document
  if (isLoadingPii) {
    return <span className="text-slate-600 italic">Loading contact...</span>;
  }

  // Show GDPR redacted badge once the item has been resolved and scrubbed
  if (piiRedacted) {
    return (
      <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg bg-slate-100 border border-slate-200 text-slate-700 font-bold text-[11px]">
        <ShieldCheck className="h-3.5 w-3.5 text-emerald-700" aria-hidden="true" />
        Redacted (GDPR)
      </span>
    );
  }

  // Render retained customer first name and optional clickable phone number
  return (
    <div className="space-y-1">
      <div className="font-bold text-slate-900">{pii?.firstName}</div>
      {pii?.contactPhone ? (
        <div className="flex items-center gap-1.5">
          {/* Phone icon and tel: link for contacting visitor */}
          <Phone className="h-3.5 w-3.5 text-sky-700 flex-shrink-0" aria-hidden="true" />
          <a
            href={`tel:${pii.contactPhone}`}
            className="font-mono font-semibold text-sky-900 underline underline-offset-2"
          >
            {pii.contactPhone}
          </a>
        </div>
      ) : (
        <div className="text-slate-600 italic">No phone provided</div>
      )}
    </div>
  );
}

/**
 * Organiser "Taken Home" management panel rendered inside `FrontDeskView`.
 */
export const TakenHomeTabPanel: React.FC<TakenHomeTabPanelProps> = ({
  entries,
  loading,
  volunteers,
  organizerEmail,
  onRefresh,
  onOpenPhotoViewer,
  onModalOpenChange,
}) => {
  // Search and resolved-history toggle state
  const [searchTerm, setSearchTerm] = useState('');
  const [showResolved, setShowResolved] = useState(false);

  // Hydrated private/customer PII keyed by `${sessionId}/${repairId}`
  const [customerPiiByKey, setCustomerPiiByKey] = useState<
    Record<string, PrivateCustomerData | null>
  >({});
  const [loadingPiiByKey, setLoadingPiiByKey] = useState<Record<string, boolean>>({});

  // Active item selected in the Organiser Taken-Home Repair Modal
  const [editingEntry, setEditingEntry] = useState<TakenHomeRepairEntry | null>(null);
  const [fixerName, setFixerName] = useState('');
  const [outcome, setOutcome] = useState<RepairOutcome>('FIXED');
  const [repairTimeMinutes, setRepairTimeMinutes] = useState<number>(30);
  const [weightKg, setWeightKg] = useState<string>('');
  const [diagnosis, setDiagnosis] = useState('');
  const [repairNotes, setRepairNotes] = useState('');
  const [partsUsed, setPartsUsed] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);

  // Saved and newly staged item photos inside the Organiser Taken-Home Repair Modal
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [existingPhotos, setExistingPhotos] = useState<RepairPhoto[]>([]);
  const [stagedPhotos, setStagedPhotos] = useState<Array<Omit<RepairPhoto, 'id'>>>([]);
  const [compressingPhoto, setCompressingPhoto] = useState(false);
  const [deletingPhotoId, setDeletingPhotoId] = useState<string | null>(null);
  const [photoError, setPhotoError] = useState<string | null>(null);

  // Notify parent FrontDeskView whenever the modal open state changes
  useEffect(() => {
    onModalOpenChange?.(editingEntry !== null);
  }, [editingEntry, onModalOpenChange]);

  // Trap keyboard focus inside the Organiser Taken-Home Repair Modal when open
  const modalRef = useDialogFocusTrap({
    isOpen: editingEntry !== null,
    onClose: () => {
      if (!submitting) {
        closeEditModal();
      }
    },
  });

  // Automatically hydrate private/customer PII for unresolved taken-home entries
  useEffect(() => {
    let cancelled = false;
    // Identify unresolved entries whose customer PII has not yet been fetched
    const unresolvedToFetch = entries.filter((entry) => {
      if (!isUnresolvedTakenHomeItem(entry.repairItem)) return false;
      const key = `${entry.sessionId}/${entry.repairItem.id}`;
      return !(key in customerPiiByKey) && !loadingPiiByKey[key];
    });

    if (unresolvedToFetch.length === 0) return;

    // Mark keys as loading and fetch each private/customer document in parallel
    const nextLoading: Record<string, boolean> = {};
    for (const entry of unresolvedToFetch) {
      nextLoading[`${entry.sessionId}/${entry.repairItem.id}`] = true;
    }
    setLoadingPiiByKey((prev) => ({ ...prev, ...nextLoading }));

    // Point-read private/customer documents for all newly discovered unresolved entries
    void Promise.all(
      unresolvedToFetch.map(async (entry) => {
        const key = `${entry.sessionId}/${entry.repairItem.id}`;
        const pii = await getPrivateCustomerData(entry.sessionId, entry.repairItem.id);
        return { key, pii };
      })
    ).then((results) => {
      if (cancelled) return;
      // Store fetched PrivateCustomerData records in component state
      setCustomerPiiByKey((prev) => {
        const updated = { ...prev };
        for (const res of results) {
          updated[res.key] = res.pii;
        }
        return updated;
      });
      // Clear per-item loading flags once point reads complete
      setLoadingPiiByKey((prev) => {
        const updated = { ...prev };
        for (const res of results) {
          delete updated[res.key];
        }
        return updated;
      });
    });

    // Cancel state updates if the panel unmounts before reads settle
    return () => {
      cancelled = true;
    };
  }, [entries, customerPiiByKey, loadingPiiByKey]);

  // Compute unresolved and resolved counts and filter/sort visible rows
  const unresolvedCount = entries.filter((e) => isUnresolvedTakenHomeItem(e.repairItem)).length;
  const resolvedCount = entries.filter((e) => isResolvedTakenHomeItem(e.repairItem)).length;
  const visibleEntries = sortAndFilterTakenHomeEntries(entries, {
    searchTerm,
    includeResolved: showResolved,
    customerPiiByRepairKey: customerPiiByKey,
  });

  /**
   * Opens the Organiser Taken-Home Repair Modal pre-populated with the item's fields
   * and loads any saved item photos on demand.
   */
  const openEditModal = async (entry: TakenHomeRepairEntry) => {
    const r = entry.repairItem;
    setEditingEntry(entry);
    // Hydrate fixer name and default outcome to FIXED when opening an unresolved item
    setFixerName(r.repair?.fixerName || r.takenHome?.fixerName || '');
    setOutcome(
      r.repair?.outcome && r.repair.outcome !== 'TAKEN_HOME'
        ? r.repair.outcome
        : 'FIXED'
    );
    // Hydrate repair duration, weight, diagnosis, notes, and parts used
    setRepairTimeMinutes(r.repair?.repairTimeMinutes ?? 30);
    setWeightKg(r.item.weightKg !== undefined ? String(r.item.weightKg) : '');
    setDiagnosis(r.repair?.diagnosis || '');
    setRepairNotes(r.repair?.repairNotes || '');
    setPartsUsed(r.repair?.partsUsed || '');
    // Clear modal error and staged/existing photo queues before fetching photos
    setSubmitError(null);
    setStagedPhotos([]);
    setExistingPhotos([]);
    setPhotoError(null);

    // Point-fetch existing saved photos if photoCount > 0
    if ((r.repair?.photoCount ?? 0) > 0) {
      try {
        const photos = await fetchRepairPhotos(entry.sessionId, r.id);
        setExistingPhotos(photos);
      } catch {
        setExistingPhotos([]);
      }
    }
  };

  /**
   * Closes the Organiser Taken-Home Repair Modal and resets all modal form state.
   */
  const closeEditModal = () => {
    // Clear active entry, form inputs, and photo staging queues
    setEditingEntry(null);
    setSubmitError(null);
    setExistingPhotos([]);
    setStagedPhotos([]);
    setPhotoError(null);
  };

  /**
   * Compresses newly selected image files on-device and stages them for atomic save.
   */
  const handlePhotoFileSelect = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const selectedFiles = Array.from(e.target.files || []);
    // Reset file input value so a removed file can be chosen again
    e.target.value = '';
    if (selectedFiles.length === 0) return;

    setPhotoError(null);
    const remainingSlots = MAX_PHOTOS_PER_REPAIR - (existingPhotos.length + stagedPhotos.length);
    if (remainingSlots <= 0) {
      setPhotoError(`Maximum of ${MAX_PHOTOS_PER_REPAIR} photos allowed per repair item.`);
      return;
    }

    // Compress each image file within remaining capacity
    const filesToProcess = selectedFiles.slice(0, remainingSlots);
    setCompressingPhoto(true);
    try {
      const uploaderLabel = fixerName.trim() || organizerEmail || 'Organiser';
      const newlyCompressed: Array<Omit<RepairPhoto, 'id'>> = [];
      // Run client-side canvas compression for each selected image
      for (const file of filesToProcess) {
        const compressed = await compressRepairPhoto(file, uploaderLabel);
        newlyCompressed.push(compressed);
      }
      setStagedPhotos((prev) => [...prev, ...newlyCompressed]);
    } catch (err: unknown) {
      // Surface compression error in the modal alert banner
      const message = err instanceof Error ? err.message : 'Failed to compress photo.';
      setPhotoError(message);
    } finally {
      setCompressingPhoto(false);
    }
  };

  /**
   * Deletes an already-saved item photo directly from the modal and decrements `photoCount`.
   */
  const handleDeleteSavedPhoto = async (photo: RepairPhoto) => {
    if (!editingEntry) return;
    setDeletingPhotoId(photo.id);
    setPhotoError(null);
    try {
      // Atomically delete photo doc and decrement parent repair.photoCount
      await deleteRepairPhoto(
        editingEntry.sessionId,
        editingEntry.repairItem.id,
        photo.id,
        existingPhotos.length
      );
      // Remove deleted photo from local modal state and refresh parent list
      setExistingPhotos((prev) => prev.filter((p) => p.id !== photo.id));
      await onRefresh();
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Failed to delete saved photo.';
      setPhotoError(message);
    } finally {
      setDeletingPhotoId(null);
    }
  };

  /**
   * Submits the organiser's interim update (`TAKEN_HOME`) or final completion
   * (`FIXED`, `PARTIAL`, `ADVICE_GIVEN`, `UNFIXABLE`).
   */
  const handleSubmitModal = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editingEntry) return;
    if (!fixerName.trim()) {
      setSubmitError('Please enter the volunteer fixer name.');
      return;
    }

    setSubmitting(true);
    setSubmitError(null);
    try {
      // Parse optional weightKg and execute atomic Firestore update + optional GDPR scrub
      const parsedWeight = parseFloat(weightKg);
      const { piiRedacted } = await submitOrganiserTakenHomeUpdate({
        sessionId: editingEntry.sessionId,
        repairId: editingEntry.repairItem.id,
        fixerName: fixerName.trim(),
        outcome,
        repairTimeMinutes,
        // Forward diagnostic notes, parts, weight, and organiser audit metadata
        diagnosis,
        repairNotes,
        partsUsed,
        weightKg: !Number.isNaN(parsedWeight) && parsedWeight > 0 ? parsedWeight : undefined,
        existingTakenHome: editingEntry.repairItem.takenHome,
        organizerEmail: organizerEmail || undefined,
        existingPhotoCount: existingPhotos.length,
        newPhotos: stagedPhotos,
      });

      // Immediately reflect redacted PII in local state when resolved
      if (piiRedacted) {
        const key = `${editingEntry.sessionId}/${editingEntry.repairItem.id}`;
        setCustomerPiiByKey((prev) => ({
          ...prev,
          // Replace cached customer PII with redacted placeholder
          [key]: {
            firstName: '[REDACTED]',
            agreedToTerms: true,
            termsVersion: 'redacted',
            redactedAt: Date.now(),
          },
        }));
      }

      // Close modal and refresh cross-session entries
      closeEditModal();
      await onRefresh();
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Failed to save repair record.';
      setSubmitError(message);
    } finally {
      setSubmitting(false);
    }
  };

  // Resolve modal submit button label without nested ternaries
  let submitButtonLabel = 'Complete Repair & Redact PII';
  if (submitting) {
    submitButtonLabel = 'Saving...';
  } else if (outcome === 'TAKEN_HOME') {
    submitButtonLabel = 'Save Interim Progress Notes';
  }

  /**
   * Renders table body rows (loading, empty, or populated taken-home entries) without nested ternaries.
   */
  const renderTableRows = (): React.ReactNode => {
    // Show loading spinner row while cross-session queries are in flight
    if (loading) {
      return (
        <tr>
          <td colSpan={6} className="py-8 text-center text-slate-600">
            <RefreshCw className="h-6 w-6 animate-spin mx-auto mb-2 text-brand-600" aria-hidden="true" />
            Loading taken home items...
          </td>
        </tr>
      );
    }

    // Show empty state row when no unresolved or matching items exist
    if (visibleEntries.length === 0) {
      return (
        <tr>
          <td colSpan={6} className="py-8 text-center text-slate-600">
            {showResolved
              ? 'No unresolved or resolved taken-home items match the current search.'
              : 'No unresolved taken-home items currently out with volunteers.'}
          </td>
        </tr>
      );
    }

    // Render each visible TakenHomeRepairEntry row
    return visibleEntries.map((entry) => {
      const r = entry.repairItem;
      const key = `${entry.sessionId}/${r.id}`;
      const isUnresolved = isUnresolvedTakenHomeItem(r);
      const displayFixerName = r.repair?.fixerName || r.takenHome?.fixerName || '—';
      // Match volunteer fixer against the Volunteer Register and look up hydrated customer PII
      const matchedVolunteer = matchVolunteerByFixerName(displayFixerName, volunteers);
      const pii = customerPiiByKey[key];
      const isLoadingPii = Boolean(loadingPiiByKey[key]);
      const piiRedacted = isCustomerPiiRedacted(pii);

      // Render table row with subtle background styling for resolved historical items
      return (
        <tr
          key={key}
          className={`transition-colors ${
            isUnresolved ? 'hover:bg-slate-50/80' : 'bg-slate-50/60 text-slate-600'
          }`}
        >
          {/* Column 1: Session Metadata, Card #, and Reference Token */}
          <td className="py-3.5 px-4 whitespace-nowrap align-top">
            <div className="font-bold text-slate-900 text-xs">{entry.sessionName}</div>
            <div className="text-xs font-mono text-slate-600">{entry.sessionDate}</div>
            {/* Physical card token badge and alphanumeric reference token */}
            <div className="mt-1.5 flex items-center gap-2">
              {r.cardNumber ? (
                <CardToken number={r.cardNumber} size="sm" dimmed={!isUnresolved} />
              ) : null}
              <span className="font-mono font-bold text-xs text-slate-700">
                {r.referenceToken}
              </span>
            </div>
          </td>

          {/* Column 2: Item Brand/Model, Fault, and Diagnostic Notes */}
          <td className="py-3.5 px-4 align-top max-w-xs">
            <div className="font-bold text-slate-900">{r.item.brandModel}</div>
            <div className="text-xs text-slate-600 mt-0.5">{r.item.faultDescription}</div>
            {/* Category and power type badges */}
            <div className="mt-1.5 flex flex-wrap items-center gap-1.5 text-[11px] text-slate-600">
              <span className="px-2 py-0.5 rounded bg-slate-100 font-semibold">
                {r.item.category}
              </span>
              <span className="px-2 py-0.5 rounded bg-slate-100 font-semibold">
                {r.item.powerType.replace(/_/g, ' ')}
              </span>
              {/* Optional logged repair time and weight pills */}
              {r.repair?.repairTimeMinutes ? (
                <span className="px-2 py-0.5 rounded bg-slate-100 font-mono">
                  {r.repair.repairTimeMinutes}m
                </span>
              ) : null}
              {r.item.weightKg ? (
                <span className="px-2 py-0.5 rounded bg-slate-100 font-mono">
                  {r.item.weightKg} kg
                </span>
              ) : null}
            </div>
            {/* Fixer diagnosis and notes */}
            {(r.repair?.diagnosis || r.repair?.repairNotes) && (
              <div className="mt-2 p-2 rounded-xl bg-slate-50 border border-slate-200 text-xs text-slate-700 space-y-0.5">
                {r.repair?.diagnosis && (
                  <div>
                    <strong className="text-slate-900">Diagnosis:</strong>{' '}
                    {r.repair.diagnosis}
                  </div>
                )}
                {/* Render repair action notes if present */}
                {r.repair?.repairNotes && (
                  <div>
                    <strong className="text-slate-900">Notes:</strong>{' '}
                    {r.repair.repairNotes}
                  </div>
                )}
              </div>
            )}
          </td>

          {/* Column 3: Volunteer Fixer Name & Matched Contact Details */}
          <td className="py-3.5 px-4 align-top text-xs">
            <div className="font-bold text-slate-900">{displayFixerName}</div>
            {matchedVolunteer ? (
              <div className="mt-1 space-y-1 text-slate-700">
                {/* Clickable volunteer phone link */}
                {matchedVolunteer.phone && (
                  <div className="flex items-center gap-1.5">
                    <Phone className="h-3.5 w-3.5 text-emerald-700 flex-shrink-0" aria-hidden="true" />
                    <a
                      href={`tel:${matchedVolunteer.phone}`}
                      className="font-mono font-semibold text-emerald-900 underline underline-offset-2"
                    >
                      {matchedVolunteer.phone}
                    </a>
                  </div>
                )}
                {/* Clickable volunteer email link */}
                {matchedVolunteer.email && (
                  <div className="flex items-center gap-1.5">
                    <Mail className="h-3.5 w-3.5 text-emerald-700 flex-shrink-0" aria-hidden="true" />
                    <a
                      href={`mailto:${matchedVolunteer.email}`}
                      className="text-emerald-900 underline underline-offset-2 break-all"
                    >
                      {matchedVolunteer.email}
                    </a>
                  </div>
                )}
              </div>
            ) : (
              /* Fallback label when fixer name does not match a registered volunteer */
              <div className="text-slate-600 mt-0.5 italic">
                Not matched in Volunteer Register
              </div>
            )}
          </td>

          {/* Column 4: Segregated Customer Contact Details (private/customer) */}
          <td className="py-3.5 px-4 align-top text-xs">
            {renderCustomerContactCell(isLoadingPii, piiRedacted, pii)}
          </td>

          {/* Column 5: Lifecycle Status & Repair Outcome */}
          <td className="py-3.5 px-4 align-top whitespace-nowrap text-xs space-y-1.5">
            <div>
              <StatusBadge status={r.status} size="sm" />
            </div>
            {/* Outcome badge pill */}
            <div>
              <span
                className={`inline-block px-2 py-0.5 rounded border text-[11px] font-bold ${getOutcomeBadgeClasses(
                  r.repair?.outcome
                )}`}
              >
                {formatOutcomeLabel(r.repair?.outcome)}
              </span>
            </div>
            {/* Resolution date caption if resolved */}
            {r.takenHome?.resolvedAt && (
              <div className="text-[11px] text-slate-600 font-mono">
                Resolved: {formatDateShort(r.takenHome.resolvedAt)}
              </div>
            )}
          </td>

          {/* Column 6: Row Actions (Photos + Update / Complete Repair) */}
          <td className="py-3.5 px-4 align-top text-right whitespace-nowrap space-x-2">
            {(r.repair?.photoCount ?? 0) > 0 && (
              /* Button to open PhotoViewerModal for this item */
              <button
                type="button"
                onClick={() => onOpenPhotoViewer(entry.sessionId, r)}
                title={`View or download ${r.repair?.photoCount} item photo${
                  r.repair?.photoCount === 1 ? '' : 's'
                }`}
                aria-label={`View photos for ${r.item.brandModel}`}
                className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-xl bg-blue-50 border border-blue-200 text-blue-900 text-xs font-bold hover:bg-blue-100 transition-colors cursor-pointer"
              >
                <Camera className="h-3.5 w-3.5 text-blue-700" aria-hidden="true" />
                <span>{r.repair?.photoCount}</span>
              </button>
            )}

            {/* Button to open the Organiser Taken-Home Repair Modal */}
            <button
              type="button"
              onClick={() => {
                void openEditModal(entry);
              }}
              className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-bold transition-colors shadow-sm cursor-pointer ${
                isUnresolved
                  ? 'bg-emerald-800 text-white hover:bg-emerald-900'
                  : 'bg-white border border-slate-300 text-slate-800 hover:bg-slate-50'
              }`}
            >
              {/* Wrench icon and contextual action label */}
              <Wrench className="h-3.5 w-3.5" aria-hidden="true" />
              <span>{isUnresolved ? 'Complete / Update' : 'Edit Record'}</span>
            </button>
          </td>
        </tr>
      );
    });
  };

  return (
    <div className="space-y-6 my-6">
      {/* Top Summary Banner & Filter Bar */}
      <div className="bg-white rounded-3xl border border-slate-200 p-6 shadow-sm space-y-4">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          {/* Header icon, title, and GDPR retention explanation */}
          <div className="flex items-start gap-3">
            <div className="h-11 w-11 rounded-2xl bg-sky-100 text-sky-900 flex items-center justify-center flex-shrink-0">
              <Home className="h-5 w-5" aria-hidden="true" />
            </div>
            {/* Panel heading and UK GDPR deferred retention subtitle */}
            <div>
              <h3 className="text-lg font-black text-slate-900">
                Items Taken Home by Volunteers ({unresolvedCount} Open)
              </h3>
              <p className="text-xs sm:text-sm text-slate-600">
                Customer contact details are retained strictly for unresolved Taken Home items and automatically redacted (`[REDACTED]`) as soon as you complete the repair record.
              </p>
            </div>
          </div>

          {/* Resolved History Toggle & Refresh Button */}
          <div className="flex flex-wrap items-center gap-2">
            {/* Toggle button to show or hide resolved taken-home items */}
            <button
              type="button"
              aria-pressed={showResolved}
              onClick={() => setShowResolved((prev) => !prev)}
              // Highlight button in emerald when resolved history is visible
              className={`inline-flex items-center gap-1.5 px-3.5 py-2 rounded-xl text-xs font-bold border transition-colors cursor-pointer ${
                showResolved
                  ? 'bg-emerald-100 border-emerald-300 text-emerald-900'
                  : 'bg-slate-50 border-slate-200 text-slate-700 hover:bg-slate-100'
              }`}
            >
              <CheckCircle2 className="h-3.5 w-3.5" aria-hidden="true" />
              <span>Show Resolved History ({resolvedCount})</span>
            </button>

            {/* Manual refresh button */}
            <button
              type="button"
              onClick={() => {
                void onRefresh();
              }}
              disabled={loading}
              // Trigger cross-session Firestore reload on click
              className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-xl border border-slate-200 bg-white text-slate-700 text-xs font-bold hover:bg-slate-50 disabled:opacity-50 transition-colors cursor-pointer"
            >
              <RefreshCw className={`h-3.5 w-3.5 ${loading ? 'animate-spin' : ''}`} aria-hidden="true" />
              <span>Refresh</span>
            </button>
          </div>
        </div>

        {/* Autofill-safe Search Input (Issue #28 compliant) */}
        <div className="relative">
          <Search className="h-4 w-4 absolute left-3.5 top-3 text-slate-400" aria-hidden="true" />
          <label htmlFor="taken-home-search" className="sr-only">
            Search taken home items by item, reference token, volunteer fixer, session, or customer
          </label>
          {/* Search input with autofill and password manager suppression */}
          <input
            type="text"
            id="taken-home-search"
            name="taken-home-search"
            aria-label="Search taken home items by item, reference token, volunteer fixer, session, or customer"
            autoComplete="off"
            autoCorrect="off"
            // Suppress browser credit-card and password manager autofill popups on organiser tablets
            autoCapitalize="off"
            spellCheck={false}
            data-1p-ignore={true}
            data-lpignore="true"
            data-bwignore="true"
            data-form-type="other"
            // Controlled search query and focus ring styling
            placeholder="Search by item, token (e.g. REF-A38F), item #, volunteer fixer, session, or customer..."
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            className="w-full pl-10 pr-4 py-2.5 rounded-xl border border-slate-200 bg-slate-50 text-sm text-slate-800 focus:bg-white focus:outline-none focus:ring-2 focus:ring-brand-500"
          />
        </div>
      </div>

      {/* Taken Home Items Table */}
      <div className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm">
            {/* Accessible table column headers with scope="col" */}
            <thead className="bg-slate-50 border-b border-slate-200 text-xs font-bold text-slate-600 uppercase tracking-wider">
              <tr>
                <th scope="col" className="py-3 px-4">Session &amp; Token</th>
                <th scope="col" className="py-3 px-4">Item &amp; Notes</th>
                <th scope="col" className="py-3 px-4">Volunteer Fixer</th>
                <th scope="col" className="py-3 px-4">Customer Contact</th>
                <th scope="col" className="py-3 px-4">Status &amp; Outcome</th>
                <th scope="col" className="py-3 px-4 text-right">Actions</th>
              </tr>
            </thead>
            {/* Render loading, empty, or populated table rows */}
            <tbody className="divide-y divide-slate-100 font-medium">
              {renderTableRows()}
            </tbody>
          </table>
        </div>
      </div>

      {/* Organiser Taken-Home Repair Completion / Interim Update Modal */}
      {editingEntry && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4 overflow-y-auto">
          {/* Focus-trapped modal dialog container */}
          <div
            ref={modalRef}
            role="dialog"
            aria-modal="true"
            aria-labelledby="organiser-taken-home-modal-title"
            tabIndex={-1}
            className="w-full max-w-2xl rounded-3xl bg-white p-6 sm:p-8 shadow-2xl border border-slate-200 my-8 space-y-5 max-h-[90vh] overflow-y-auto"
          >
            {/* Modal Header */}
            <div className="flex items-start justify-between gap-4 pb-4 border-b border-slate-200">
              <div className="flex items-center gap-3">
                {editingEntry.repairItem.cardNumber ? (
                  <CardToken number={editingEntry.repairItem.cardNumber} size="md" />
                ) : null}
                {/* Modal title and session/token subtitle */}
                <div>
                  <h3
                    id="organiser-taken-home-modal-title"
                    className="text-lg sm:text-xl font-black text-slate-900"
                  >
                    Manage Taken Home Repair: {editingEntry.repairItem.item.brandModel}
                  </h3>
                  <p className="text-xs text-slate-600 font-mono mt-0.5">
                    {editingEntry.sessionName} ({editingEntry.sessionDate}) • Token:{' '}
                    {editingEntry.repairItem.referenceToken}
                  </p>
                </div>
              </div>
              {/* Close modal icon button */}
              <button
                type="button"
                onClick={closeEditModal}
                aria-label="Close taken home repair modal"
                className="p-1.5 rounded-xl text-slate-600 hover:bg-slate-100 cursor-pointer"
              >
                <X className="h-5 w-5" aria-hidden="true" />
              </button>
            </div>

            {/* Customer Fault Summary */}
            <div className="bg-slate-50 p-3.5 rounded-2xl border border-slate-200 text-xs sm:text-sm">
              <span className="text-xs font-bold text-slate-600 uppercase block mb-0.5">
                Reported Fault
              </span>
              <p className="text-slate-800 font-medium">
                {editingEntry.repairItem.item.faultDescription}
              </p>
            </div>

            {/* Organiser Repair Form */}
            <form onSubmit={handleSubmitModal} className="space-y-5">
              {/* Outcome Selection Group */}
              <div>
                <span
                  id="organiser-taken-home-outcome-label"
                  className="block text-xs font-bold text-slate-800 uppercase tracking-wider mb-2"
                >
                  Repair Outcome / Disposition <span className="text-rose-600">*</span>
                </span>
                {/* Accessible button group for selecting final or interim disposition */}
                <div
                  role="group"
                  aria-labelledby="organiser-taken-home-outcome-label"
                  className="grid grid-cols-1 sm:grid-cols-2 gap-2.5"
                >
                  {/* Final Outcome: FIXED */}
                  <button
                    type="button"
                    aria-pressed={outcome === 'FIXED'}
                    onClick={() => setOutcome('FIXED')}
                    // Highlight emerald border when FIXED is selected
                    className={`p-3 rounded-2xl border-2 text-left transition-all cursor-pointer ${
                      outcome === 'FIXED'
                        ? 'border-emerald-700 bg-emerald-50 text-emerald-950'
                        : 'border-slate-200 hover:border-slate-300 text-slate-700'
                    }`}
                  >
                    <div className="font-bold flex items-center gap-1.5 text-emerald-900 text-xs sm:text-sm">
                      <CheckCircle2 className="h-4 w-4 text-emerald-700" aria-hidden="true" />
                      Fixed / Repaired (Complete &amp; Redact PII)
                    </div>
                  </button>

                  {/* Final Outcome: PARTIAL */}
                  <button
                    type="button"
                    aria-pressed={outcome === 'PARTIAL'}
                    onClick={() => setOutcome('PARTIAL')}
                    // Highlight blue border when PARTIAL is selected
                    className={`p-3 rounded-2xl border-2 text-left transition-all cursor-pointer ${
                      outcome === 'PARTIAL'
                        ? 'border-blue-700 bg-blue-50 text-blue-950'
                        : 'border-slate-200 hover:border-slate-300 text-slate-700'
                    }`}
                  >
                    <div className="font-bold flex items-center gap-1.5 text-blue-900 text-xs sm:text-sm">
                      <Wrench className="h-4 w-4 text-blue-700" aria-hidden="true" />
                      Partially Fixed (Complete &amp; Redact PII)
                    </div>
                  </button>

                  {/* Final Outcome: ADVICE_GIVEN */}
                  <button
                    type="button"
                    aria-pressed={outcome === 'ADVICE_GIVEN'}
                    onClick={() => setOutcome('ADVICE_GIVEN')}
                    // Highlight purple border when ADVICE_GIVEN is selected
                    className={`p-3 rounded-2xl border-2 text-left transition-all cursor-pointer ${
                      outcome === 'ADVICE_GIVEN'
                        ? 'border-purple-700 bg-purple-50 text-purple-950'
                        : 'border-slate-200 hover:border-slate-300 text-slate-700'
                    }`}
                  >
                    <div className="font-bold flex items-center gap-1.5 text-purple-900 text-xs sm:text-sm">
                      <HelpCircle className="h-4 w-4 text-purple-700" aria-hidden="true" />
                      Advice Given (Complete &amp; Redact PII)
                    </div>
                  </button>

                  {/* Final Outcome: UNFIXABLE */}
                  <button
                    type="button"
                    aria-pressed={outcome === 'UNFIXABLE'}
                    onClick={() => setOutcome('UNFIXABLE')}
                    // Highlight rose border when UNFIXABLE is selected
                    className={`p-3 rounded-2xl border-2 text-left transition-all cursor-pointer ${
                      outcome === 'UNFIXABLE'
                        ? 'border-rose-700 bg-rose-50 text-rose-950'
                        : 'border-slate-200 hover:border-slate-300 text-slate-700'
                    }`}
                  >
                    <div className="font-bold flex items-center gap-1.5 text-rose-900 text-xs sm:text-sm">
                      <XCircle className="h-4 w-4 text-rose-700" aria-hidden="true" />
                      Unfixable / End of Life (Complete &amp; Redact PII)
                    </div>
                  </button>

                  {/* Interim Progress Update: TAKEN_HOME */}
                  <button
                    type="button"
                    aria-pressed={outcome === 'TAKEN_HOME'}
                    onClick={() => setOutcome('TAKEN_HOME')}
                    // Highlight sky border when interim TAKEN_HOME is selected
                    className={`sm:col-span-2 p-3 rounded-2xl border-2 text-left transition-all cursor-pointer ${
                      outcome === 'TAKEN_HOME'
                        ? 'border-sky-700 bg-sky-50 text-sky-950'
                        : 'border-slate-200 hover:border-slate-300 text-slate-700'
                    }`}
                  >
                    <div className="font-bold flex items-center gap-1.5 text-sky-900 text-xs sm:text-sm">
                      <Home className="h-4 w-4 text-sky-700" aria-hidden="true" />
                      Still Taken Home — Save Interim Progress Notes Only (Keep Open &amp; Retain Customer Contact)
                    </div>
                  </button>
                </div>
              </div>

              {/* Contextual UK GDPR & Analytics Notice */}
              {outcome !== 'TAKEN_HOME' ? (
                <div
                  role="status"
                  className="p-3.5 rounded-2xl bg-emerald-50 border border-emerald-200 text-emerald-950 text-xs leading-relaxed flex items-start gap-2.5"
                >
                  {/* Shield icon and GDPR scrubbing notice */}
                  <ShieldCheck className="h-4 w-4 text-emerald-800 flex-shrink-0 mt-0.5" aria-hidden="true" />
                  <span>
                    <strong>Final Resolution &amp; UK GDPR Scrub:</strong> Saving with outcome{' '}
                    <strong>{outcome}</strong> will mark this item as <strong>COMPLETED</strong>,
                    automatically scrub the customer&apos;s name and phone number to{' '}
                    <code className="font-mono bg-emerald-100 px-1 py-0.5 rounded">[REDACTED]</code>,
                    and recalculate the parent session&apos;s community impact analytics.
                  </span>
                </div>
              ) : (
                /* Interim progress notice explaining customer contact retention */
                <div
                  role="status"
                  className="p-3.5 rounded-2xl bg-sky-50 border border-sky-200 text-sky-950 text-xs leading-relaxed"
                >
                  <strong>Interim Progress Update:</strong> This item will remain in{' '}
                  <strong>TAKEN_HOME</strong> status and customer contact details will remain available
                  to organisers until the repair is completed.
                </div>
              )}

              {/* Volunteer Fixer Name, Time Spent, and Weight */}
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 pt-2 border-t border-slate-100">
                <div>
                  {/* Volunteer fixer name label */}
                  <label
                    htmlFor="organiser-taken-home-fixer"
                    className="block text-xs font-bold text-slate-700 mb-1"
                  >
                    Volunteer Fixer Name <span className="text-rose-600">*</span>
                  </label>
                  {/* Volunteer fixer name text input */}
                  <input
                    id="organiser-taken-home-fixer"
                    type="text"
                    required
                    value={fixerName}
                    onChange={(e) => setFixerName(e.target.value)}
                    placeholder="e.g. Dave Smith"
                    className="w-full px-3 py-2 rounded-xl border border-slate-300 text-sm text-slate-900"
                  />
                </div>

                <div>
                  {/* Repair time in minutes label */}
                  <label
                    htmlFor="organiser-taken-home-minutes"
                    className="block text-xs font-bold text-slate-700 mb-1 flex items-center gap-1"
                  >
                    <Clock className="h-3.5 w-3.5 text-slate-600" aria-hidden="true" />
                    Time Spent (mins)
                  </label>
                  {/* Repair time numeric input */}
                  <input
                    id="organiser-taken-home-minutes"
                    type="number"
                    min={5}
                    max={600}
                    value={repairTimeMinutes}
                    onChange={(e) => setRepairTimeMinutes(parseInt(e.target.value, 10) || 15)}
                    className="w-full px-3 py-2 rounded-xl border border-slate-300 text-sm font-mono font-bold text-slate-900"
                  />
                </div>

                <div>
                  {/* Diverted landfill weight in kg label */}
                  <label
                    htmlFor="organiser-taken-home-weight"
                    className="block text-xs font-bold text-slate-700 mb-1 flex items-center gap-1"
                  >
                    <Scale className="h-3.5 w-3.5 text-slate-600" aria-hidden="true" />
                    Weight Diverted (kg)
                  </label>
                  {/* Diverted landfill weight numeric input */}
                  <input
                    id="organiser-taken-home-weight"
                    type="number"
                    step="0.1"
                    min="0"
                    placeholder="e.g. 1.5"
                    value={weightKg}
                    onChange={(e) => setWeightKg(e.target.value)}
                    className="w-full px-3 py-2 rounded-xl border border-slate-300 text-sm font-mono font-bold text-slate-900"
                  />
                </div>
              </div>

              {/* Diagnosis, Repair Notes, and Parts Used */}
              <div className="space-y-3 pt-2 border-t border-slate-100">
                <div>
                  {/* Diagnosis label */}
                  <label
                    htmlFor="organiser-taken-home-diagnosis"
                    className="block text-xs font-bold text-slate-700 mb-1"
                  >
                    Diagnosis / Root Cause
                  </label>
                  {/* Diagnosis text input */}
                  <input
                    id="organiser-taken-home-diagnosis"
                    type="text"
                    value={diagnosis}
                    onChange={(e) => setDiagnosis(e.target.value)}
                    placeholder="e.g. Replacement thermal fuse ordered and fitted."
                    className="w-full px-3.5 py-2 rounded-xl border border-slate-300 text-sm text-slate-900"
                  />
                </div>

                <div>
                  {/* Repair actions and interim notes label */}
                  <label
                    htmlFor="organiser-taken-home-notes"
                    className="block text-xs font-bold text-slate-700 mb-1"
                  >
                    Repair Actions &amp; Progress Notes
                  </label>
                  {/* Repair actions textarea */}
                  <textarea
                    id="organiser-taken-home-notes"
                    rows={2}
                    value={repairNotes}
                    onChange={(e) => setRepairNotes(e.target.value)}
                    placeholder="e.g. Tested at home, returned to customer on 20 Nov."
                    className="w-full px-3.5 py-2 rounded-xl border border-slate-300 text-sm text-slate-900"
                  />
                </div>

                <div>
                  {/* Parts used label */}
                  <label
                    htmlFor="organiser-taken-home-parts"
                    className="block text-xs font-bold text-slate-700 mb-1"
                  >
                    Parts / Materials Used
                  </label>
                  {/* Parts used text input */}
                  <input
                    id="organiser-taken-home-parts"
                    type="text"
                    value={partsUsed}
                    onChange={(e) => setPartsUsed(e.target.value)}
                    placeholder="e.g. 1x thermal cutout fuse"
                    className="w-full px-3.5 py-2 rounded-xl border border-slate-300 text-sm text-slate-900"
                  />
                </div>
              </div>

              {/* Optional Item Photos Section */}
              <div className="space-y-3 pt-2 border-t border-slate-100">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  {/* Photo upload label */}
                  <label
                    htmlFor="organiser-taken-home-photo-upload"
                    className="block text-xs font-bold text-slate-800 uppercase tracking-wider flex items-center gap-1.5"
                  >
                    <Camera className="h-4 w-4 text-blue-700" aria-hidden="true" />
                    Item Photos ({existingPhotos.length + stagedPhotos.length} / {MAX_PHOTOS_PER_REPAIR})
                  </label>

                  {/* Hidden file input triggered by Add Item Photo button */}
                  <input
                    id="organiser-taken-home-photo-upload"
                    ref={fileInputRef}
                    type="file"
                    accept="image/*"
                    multiple
                    onChange={handlePhotoFileSelect}
                    className="hidden"
                  />

                  {/* Add Item Photo button rendered when capacity remains */}
                  {canAddMorePhotos(existingPhotos.length, stagedPhotos.length) && (
                    <button
                      type="button"
                      disabled={compressingPhoto || submitting}
                      onClick={() => fileInputRef.current?.click()}
                      className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-blue-50 border border-blue-200 text-blue-900 text-xs font-bold hover:bg-blue-100 disabled:opacity-50 cursor-pointer"
                    >
                      <Camera className="h-3.5 w-3.5 text-blue-700" aria-hidden="true" />
                      <span>{compressingPhoto ? 'Compressing...' : 'Add Item Photo'}</span>
                    </button>
                  )}
                </div>

                {/* Photo compression or deletion error alert */}
                {photoError && (
                  <div
                    role="alert"
                    className="p-2.5 rounded-xl bg-rose-50 border border-rose-200 text-rose-900 text-xs font-semibold flex items-center gap-2"
                  >
                    <AlertTriangle className="h-4 w-4 text-rose-700 flex-shrink-0" aria-hidden="true" />
                    <span>{photoError}</span>
                  </div>
                )}

                {/* Saved and newly staged photo cards grid */}
                {(existingPhotos.length > 0 || stagedPhotos.length > 0) && (
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                    {existingPhotos.map((photo, idx) => (
                      <div
                        key={photo.id}
                        className="flex items-center justify-between gap-2 p-2 rounded-xl border border-slate-200 bg-slate-50"
                      >
                        {/* Saved photo thumbnail and file size */}
                        <div className="flex items-center gap-2.5 min-w-0">
                          <img
                            src={photo.dataUrl}
                            alt={`Saved item photo ${idx + 1}`}
                            className="h-12 w-12 rounded-lg object-cover border border-slate-200 bg-slate-900 flex-shrink-0"
                          />
                          {/* Saved badge and kilobyte size caption */}
                          <div className="min-w-0">
                            <span className="inline-block px-1.5 py-0.5 rounded bg-emerald-100 text-emerald-900 text-[10px] font-bold uppercase">
                              Saved
                            </span>
                            <p className="text-xs text-slate-600 font-mono truncate">
                              {formatPhotoSizeKb(photo.sizeBytes)}
                            </p>
                          </div>
                        </div>
                        {/* View and delete saved photo buttons */}
                        <div className="flex items-center gap-1">
                          <button
                            type="button"
                            onClick={() =>
                              onOpenPhotoViewer(editingEntry.sessionId, editingEntry.repairItem)
                            }
                            aria-label={`View saved photo ${idx + 1}`}
                            className="p-1.5 rounded-lg bg-white border border-slate-200 text-slate-700 hover:bg-slate-100 cursor-pointer"
                          >
                            <Eye className="h-3.5 w-3.5 text-blue-700" aria-hidden="true" />
                          </button>
                          {/* Delete saved photo button */}
                          <button
                            type="button"
                            disabled={deletingPhotoId === photo.id}
                            onClick={() => {
                              void handleDeleteSavedPhoto(photo);
                            }}
                            aria-label={`Delete saved photo ${idx + 1}`}
                            className="p-1.5 rounded-lg bg-white border border-rose-200 text-rose-700 hover:bg-rose-50 disabled:opacity-50 cursor-pointer"
                          >
                            <Trash2 className="h-3.5 w-3.5" aria-hidden="true" />
                          </button>
                        </div>
                      </div>
                    ))}

                    {/* Newly staged photos awaiting atomic batch commit */}
                    {stagedPhotos.map((staged, idx) => (
                      <div
                        key={`staged-${idx}`}
                        className="flex items-center justify-between gap-2 p-2 rounded-xl border border-blue-200 bg-blue-50/50"
                      >
                        {/* Staged photo thumbnail and size badge */}
                        <div className="flex items-center gap-2.5 min-w-0">
                          <img
                            src={staged.dataUrl}
                            alt={`Staged item photo ${idx + 1}`}
                            className="h-12 w-12 rounded-lg object-cover border border-blue-200 bg-slate-900 flex-shrink-0"
                          />
                          <div className="min-w-0">
                            <span className="inline-block px-1.5 py-0.5 rounded bg-blue-100 text-blue-900 text-[10px] font-bold uppercase">
                              New • {formatPhotoSizeKb(staged.sizeBytes)}
                            </span>
                          </div>
                        </div>
                        {/* Remove staged photo button */}
                        <button
                          type="button"
                          onClick={() =>
                            setStagedPhotos((prev) => prev.filter((_, i) => i !== idx))
                          }
                          aria-label={`Remove staged photo ${idx + 1}`}
                          className="p-1.5 rounded-lg bg-white border border-rose-200 text-rose-700 hover:bg-rose-50 cursor-pointer"
                        >
                          <X className="h-3.5 w-3.5" aria-hidden="true" />
                        </button>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              {/* Form submission error alert */}
              {submitError && (
                <div
                  role="alert"
                  className="p-3 rounded-xl bg-rose-50 border border-rose-200 text-rose-900 text-xs font-bold"
                >
                  {submitError}
                </div>
              )}

              {/* Modal Footer Buttons */}
              <div className="flex justify-end gap-3 pt-4 border-t border-slate-100">
                <button
                  type="button"
                  disabled={submitting}
                  onClick={closeEditModal}
                  className="px-4 py-2.5 rounded-xl border border-slate-300 text-xs sm:text-sm font-bold text-slate-700 hover:bg-slate-50 cursor-pointer"
                >
                  Cancel
                </button>
                {/* Submit button for interim update or final completion */}
                <button
                  type="submit"
                  disabled={submitting || compressingPhoto}
                  className="px-5 py-2.5 rounded-xl bg-emerald-800 text-white text-xs sm:text-sm font-bold hover:bg-emerald-900 disabled:opacity-50 shadow-sm cursor-pointer"
                >
                  {submitButtonLabel}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};
