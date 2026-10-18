import React, { useState, useEffect } from 'react';
import {
  Zap,
  X,
  AlertTriangle,
  Trash2,
  CheckCircle2
} from 'lucide-react';
import { PatInstrument, PatInstrumentInput } from '../../types';
import { cafeConfig } from '../../config/cafe.config';
import {
  createPatInstrument,
  updatePatInstrument,
  deletePatInstrument,
  isPatInstrumentCalibrationOverdue
} from '../../services/patInstrumentService';

/**
 * Props for the PAT Instrument Management Modal (`PatInstrumentModal.tsx`, Issue #27).
 */
export interface PatInstrumentModalProps {
  // Controls whether the modal dialog is visible
  isOpen: boolean;
  // Determines whether the modal is adding a new instrument or editing an existing one
  mode: 'add' | 'edit';
  // Instrument record being edited when mode === 'edit'
  initialInstrument?: PatInstrument | null;
  // Current list of registered instruments used for duplicate serial number checks
  existingInstruments: PatInstrument[];
  // Callback invoked when the modal is dismissed without saving
  onClose: () => void;
  // Callback invoked after an instrument is created or updated
  onSaved: (savedInstrument: PatInstrument, mode: 'add' | 'edit') => void;
  // Callback invoked after an existing instrument is deleted/retired
  onDeleted?: (deletedInstrumentId: string) => void;
}

/**
 * Returns today's local calendar date formatted as `YYYY-MM-DD` for default date inputs.
 */
function getTodayIsoDateString(): string {
  // Format local year, month, and day with zero padding
  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, '0');
  const day = String(now.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

/**
 * Modal dialog allowing PAT-qualified volunteers at `/pat` to add a new PAT testing
 * instrument, edit an existing instrument's display name or calibration date, or
 * retire/delete an instrument from the dropdown list (Issue #27).
 */
export const PatInstrumentModal: React.FC<PatInstrumentModalProps> = ({
  isOpen,
  mode,
  initialInstrument,
  existingInstruments,
  onClose,
  onSaved,
  onDeleted
}) => {
  // Controlled form state for PAT instrument metadata
  const [displayName, setDisplayName] = useState('');
  const [manufacturer, setManufacturer] = useState('');
  const [model, setModel] = useState('');
  const [serialNumber, setSerialNumber] = useState('');
  const [lastCalibratedDate, setLastCalibratedDate] = useState(getTodayIsoDateString);
  const [notes, setNotes] = useState('');

  // Submission, deletion confirmation, and error banner state
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Hydrate or reset form fields whenever the modal opens or switches between add/edit modes
  useEffect(() => {
    if (!isOpen) return;
    setError(null);
    setConfirmingDelete(false);

    // Populate existing instrument values in edit mode, or clear for add mode
    if (mode === 'edit' && initialInstrument) {
      setDisplayName(initialInstrument.displayName);
      setManufacturer(initialInstrument.manufacturer);
      setModel(initialInstrument.model || '');
      setSerialNumber(initialInstrument.serialNumber);
      setLastCalibratedDate(initialInstrument.lastCalibratedDate);
      setNotes(initialInstrument.notes || '');
    } else {
      // Reset fields to blank defaults and today's calendar date for Add mode
      setDisplayName('');
      setManufacturer('');
      setModel('');
      setSerialNumber('');
      setLastCalibratedDate(getTodayIsoDateString());
      setNotes('');
    }
  }, [isOpen, mode, initialInstrument]);

  // Do not render DOM nodes when the modal is closed
  if (!isOpen) return null;

  // Check whether the currently entered calibration date is older than cafeConfig.patTesterServiceIntervalMonths
  const serviceIntervalMonths = cafeConfig.patTesterServiceIntervalMonths;
  const isEnteredDateOverdue =
    lastCalibratedDate.trim().length > 0 &&
    isPatInstrumentCalibrationOverdue(lastCalibratedDate, serviceIntervalMonths);

  // Validate and persist the PAT instrument to Firestore
  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setSaving(true);

    // Assemble trimmed input payload for service validation and persistence
    const inputPayload: PatInstrumentInput = {
      displayName,
      manufacturer,
      model: model.trim() || undefined,
      serialNumber,
      lastCalibratedDate,
      notes: notes.trim() || undefined
    };

    try {
      // Branch between creating a new instrument or updating the selected instrument
      if (mode === 'edit' && initialInstrument) {
        const updated = await updatePatInstrument(initialInstrument.id, inputPayload, {
          existingCreatedAt: initialInstrument.createdAt,
          existingInstruments
        });
        onSaved(updated, 'edit');
      } else {
        const created = await createPatInstrument(inputPayload, existingInstruments);
        onSaved(created, 'add');
      }
    } catch (err: unknown) {
      // Surface validation or Firestore errors inside the modal banner
      const message = err instanceof Error ? err.message : 'Failed to save PAT instrument.';
      setError(message);
    } finally {
      setSaving(false);
    }
  };

  // Delete / retire the current PAT instrument from the active dropdown registry
  const handleConfirmDelete = async () => {
    if (!initialInstrument || !onDeleted) return;
    setError(null);
    setDeleting(true);

    try {
      // Remove the instrument document from patInstruments/{id}
      await deletePatInstrument(initialInstrument.id);
      onDeleted(initialInstrument.id);
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Failed to delete PAT instrument.';
      setError(message);
    } finally {
      setDeleting(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/60 backdrop-blur-xs p-4 overflow-y-auto"
      role="dialog"
      aria-modal="true"
      aria-labelledby="pat-instrument-modal-title"
    >
      {/* Modal Container */}
      <div className="bg-white rounded-3xl max-w-lg w-full p-6 sm:p-8 shadow-2xl border border-slate-200 animate-fade-in my-8">
        {/* Modal Header */}
        <div className="flex items-start justify-between gap-4 pb-4 border-b border-slate-100">
          <div className="flex items-center gap-3">
            <div className="h-11 w-11 rounded-2xl bg-amber-100 text-amber-800 flex items-center justify-center flex-shrink-0">
              <Zap className="h-5 w-5" />
            </div>
            <div>
              {/* Dynamic Add vs Edit modal heading */}
              <h3 id="pat-instrument-modal-title" className="text-lg font-black text-slate-900">
                {mode === 'edit' ? 'Edit PAT Testing Instrument' : 'Add New PAT Testing Instrument'}
              </h3>
              <p className="text-xs text-slate-500">
                Serial numbers are recorded on repair items for audit traceability.
              </p>
            </div>
          </div>

          {/* Close Modal Button */}
          <button
            type="button"
            onClick={onClose}
            aria-label="Close PAT instrument modal"
            className="p-1.5 rounded-xl text-slate-400 hover:text-slate-700 hover:bg-slate-100 transition-colors"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        {/* Error Banner */}
        {error && (
          <div className="mt-4 p-3 rounded-xl bg-rose-50 border border-rose-200 text-rose-800 text-xs font-bold flex items-center gap-2">
            <AlertTriangle className="h-4 w-4 text-rose-600 flex-shrink-0" />
            <span>{error}</span>
          </div>
        )}

        {/* PAT Instrument Form */}
        <form onSubmit={handleSave} className="mt-5 space-y-4">
          {/* Display Name input (friendly mutable label) */}
          <div>
            <label htmlFor="pat-inst-display-name" className="block text-xs font-bold text-slate-700 mb-1">
              Display Name <span className="text-rose-500">*</span>
            </label>
            {/* Friendly mutable display label for the PAT instrument */}
            <input
              id="pat-inst-display-name"
              type="text"
              required
              maxLength={100}
              placeholder="e.g. Richard's Tester"
              value={displayName}
              onChange={(e) => setDisplayName(e.target.value)}
              className="w-full px-3.5 py-2.5 rounded-xl border border-slate-300 text-sm font-semibold text-slate-800 focus:outline-none focus:ring-2 focus:ring-amber-500"
            />
          </div>

          {/* Manufacturer & Optional Model row */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            {/* Manufacturer input */}
            <div>
              <label htmlFor="pat-inst-manufacturer" className="block text-xs font-bold text-slate-700 mb-1">
                Manufacturer <span className="text-rose-500">*</span>
              </label>
              {/* Required manufacturer brand name */}
              <input
                id="pat-inst-manufacturer"
                type="text"
                required
                maxLength={100}
                placeholder="e.g. Seaward, Kewtech"
                value={manufacturer}
                onChange={(e) => setManufacturer(e.target.value)}
                className="w-full px-3.5 py-2.5 rounded-xl border border-slate-300 text-sm text-slate-800 focus:outline-none focus:ring-2 focus:ring-amber-500"
              />
            </div>

            {/* Optional Model input */}
            <div>
              <label htmlFor="pat-inst-model" className="block text-xs font-bold text-slate-700 mb-1">
                Model <span className="text-slate-400 font-normal">(Optional)</span>
              </label>
              {/* Optional hardware model identifier */}
              <input
                id="pat-inst-model"
                type="text"
                maxLength={100}
                placeholder="e.g. PrimeTest 100"
                value={model}
                onChange={(e) => setModel(e.target.value)}
                className="w-full px-3.5 py-2.5 rounded-xl border border-slate-300 text-sm text-slate-800 focus:outline-none focus:ring-2 focus:ring-amber-500"
              />
            </div>
          </div>

          {/* Serial Number & Last Service / Calibration Date row */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            {/* Constant Serial Number input */}
            <div>
              <label htmlFor="pat-inst-serial" className="block text-xs font-bold text-slate-700 mb-1">
                Serial Number <span className="text-rose-500">*</span>
              </label>
              {/* Immutable manufacturer serial number stored on RepairItem */}
              <input
                id="pat-inst-serial"
                type="text"
                required
                maxLength={100}
                autoComplete="off"
                spellCheck={false}
                placeholder="e.g. SW-90421"
                value={serialNumber}
                onChange={(e) => setSerialNumber(e.target.value)}
                className="w-full px-3.5 py-2.5 rounded-xl border border-slate-300 font-mono text-sm font-bold text-slate-800 focus:outline-none focus:ring-2 focus:ring-amber-500"
              />
            </div>

            {/* Last Service / Calibration Date input */}
            <div>
              <label htmlFor="pat-inst-calibrated-date" className="block text-xs font-bold text-slate-700 mb-1">
                Last Service / Calibration Date <span className="text-rose-500">*</span>
              </label>
              {/* ISO YYYY-MM-DD calibration date input */}
              <input
                id="pat-inst-calibrated-date"
                type="date"
                required
                value={lastCalibratedDate}
                onChange={(e) => setLastCalibratedDate(e.target.value)}
                className="w-full px-3.5 py-2.5 rounded-xl border border-slate-300 font-mono text-sm text-slate-800 focus:outline-none focus:ring-2 focus:ring-amber-500"
              />
            </div>
          </div>

          {/* Live Calibration Status Feedback inside Modal */}
          {lastCalibratedDate && (
            <div
              className={`p-3 rounded-xl border text-xs font-medium flex items-center gap-2 ${
                isEnteredDateOverdue
                  ? 'bg-amber-50 border-amber-300 text-amber-900'
                  : 'bg-emerald-50 border-emerald-200 text-emerald-900'
              }`}
            >
              {/* Render overdue warning or valid interval badge */}
              {isEnteredDateOverdue ? (
                <>
                  <AlertTriangle className="h-4 w-4 text-amber-600 flex-shrink-0" />
                  <span>
                    Service date is older than {serviceIntervalMonths} months. An amber overdue warning will be shown when selected.
                  </span>
                </>
              ) : (
                <>
                  <CheckCircle2 className="h-4 w-4 text-emerald-600 flex-shrink-0" />
                  <span>
                    Within the {serviceIntervalMonths}-month calibration interval.
                  </span>
                </>
              )}
            </div>
          )}

          {/* Optional Notes textarea */}
          <div>
            <label htmlFor="pat-inst-notes" className="block text-xs font-bold text-slate-700 mb-1">
              Notes <span className="text-slate-400 font-normal">(Optional)</span>
            </label>
            <textarea
              id="pat-inst-notes"
              rows={2}
              maxLength={500}
              placeholder="e.g. Includes IEC cloverleaf adapter and earth bond probe."
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              className="w-full px-3.5 py-2 rounded-xl border border-slate-300 text-sm text-slate-800 focus:outline-none focus:ring-2 focus:ring-amber-500"
            />
          </div>

          {/* Delete / Retire Confirmation Panel (Edit mode only) */}
          {mode === 'edit' && initialInstrument && onDeleted && confirmingDelete && (
            <div className="p-4 rounded-2xl bg-rose-50 border border-rose-200 space-y-3">
              <p className="text-xs font-bold text-rose-900">
                Remove &ldquo;{initialInstrument.displayName}&rdquo; (S/N: {initialInstrument.serialNumber}) from the PAT instrument dropdown?
              </p>
              <p className="text-xs text-rose-800">
                Past repair records using S/N <span className="font-mono font-bold">{initialInstrument.serialNumber}</span> will retain their recorded serial number.
              </p>
              <div className="flex justify-end gap-2">
                {/* Cancel deletion */}
                <button
                  type="button"
                  onClick={() => setConfirmingDelete(false)}
                  disabled={deleting}
                  className="px-3 py-1.5 rounded-lg border border-slate-300 bg-white text-xs font-bold text-slate-700 hover:bg-slate-50"
                >
                  Keep Instrument
                </button>
                {/* Confirm deletion */}
                <button
                  type="button"
                  onClick={handleConfirmDelete}
                  disabled={deleting}
                  className="px-3 py-1.5 rounded-lg bg-rose-600 text-white text-xs font-bold hover:bg-rose-700 disabled:opacity-50"
                >
                  {deleting ? 'Removing...' : 'Confirm Remove'}
                </button>
              </div>
            </div>
          )}

          {/* Modal Footer Actions */}
          <div className="flex items-center justify-between gap-3 pt-4 border-t border-slate-100">
            {/* Retire/Delete Trigger Button in Edit Mode */}
            <div>
              {mode === 'edit' && initialInstrument && onDeleted && !confirmingDelete && (
                <button
                  type="button"
                  onClick={() => setConfirmingDelete(true)}
                  className="inline-flex items-center gap-1.5 px-3 py-2 rounded-xl text-rose-700 hover:bg-rose-50 text-xs font-bold transition-colors"
                >
                  <Trash2 className="h-4 w-4" />
                  Remove Instrument
                </button>
              )}
            </div>

            {/* Cancel and Save Buttons */}
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={onClose}
                disabled={saving || deleting}
                className="px-4 py-2.5 rounded-xl border border-slate-300 text-xs font-bold text-slate-700 hover:bg-slate-50"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={saving || deleting}
                className="px-5 py-2.5 rounded-xl bg-amber-600 text-white text-xs font-bold hover:bg-amber-700 disabled:opacity-50 shadow-xs"
              >
                {saving
                  ? 'Saving...'
                  : mode === 'edit'
                    ? 'Save Changes'
                    : 'Add Instrument'}
              </button>
            </div>
          </div>
        </form>
      </div>
    </div>
  );
};
