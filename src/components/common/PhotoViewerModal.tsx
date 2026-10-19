/**
 * @file src/components/common/PhotoViewerModal.tsx
 *
 * Shared Item Photo Lightbox, Download, and Deletion Modal (GitHub Issue #4).
 *
 * Used by both the Volunteer Fixer Station (`/fixer`) and the Front Desk Live Board
 * (`/frontdesk`) to inspect compressed item photos on demand via point reads (`getDocs`),
 * download photos with clean filenames, or atomically delete individual photos.
 */

import React, { useEffect, useState } from 'react';
import {
  Camera,
  Download,
  Trash2,
  X,
  RefreshCw,
  AlertTriangle,
  ChevronLeft,
  ChevronRight,
} from 'lucide-react';
import { RepairItem, RepairPhoto } from '../../types';
import { useDialogFocusTrap } from '../../hooks/useDialogFocusTrap';
import { fetchRepairPhotos, deleteRepairPhoto } from '../../services/repairService';
import {
  formatPhotoSizeKb,
  generatePhotoDownloadFilename,
} from '../../utils/imageCompression';

/**
 * Props for the shared `PhotoViewerModal` component.
 */
export interface PhotoViewerModalProps {
  isOpen: boolean;
  onClose: () => void;
  sessionId: string;
  repairItem: RepairItem;
  // Optional pre-loaded photos from FixerStationView to avoid a redundant Firestore read
  initialPhotos?: RepairPhoto[];
  initialIndex?: number;
  // Callback invoked whenever a photo is deleted so parent state stays in sync
  onPhotosChange?: (remainingPhotos: RepairPhoto[]) => void;
}

/**
 * Modal component that displays full-size compressed item photos, metadata,
 * one-click download links, and two-step atomic photo deletion.
 *
 * Architectural Note: Kept as a single cohesive modal component (>50 lines) so
 * keyboard/carousel navigation, point-read loading, and two-step delete confirmation
 * share local state without prop drilling.
 */
export const PhotoViewerModal: React.FC<PhotoViewerModalProps> = ({
  isOpen,
  onClose,
  sessionId,
  repairItem,
  initialPhotos,
  initialIndex = 0,
  onPhotosChange,
}) => {
  // Loaded photos and currently selected carousel index
  const [photos, setPhotos] = useState<RepairPhoto[]>(initialPhotos ?? []);
  const [activeIndex, setActiveIndex] = useState<number>(initialIndex);
  // Async loading, deletion, and confirmation states
  const [loading, setLoading] = useState<boolean>(false);
  const [deleting, setDeleting] = useState<boolean>(false);
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const dialogRef = useDialogFocusTrap({ isOpen, onClose });

  // Load or synchronise photos when the modal opens
  useEffect(() => {
    if (!isOpen) {
      setConfirmDeleteId(null);
      setError(null);
      return;
    }

    // Reset active index and clear transient error/delete prompts on open
    setActiveIndex(Math.max(0, initialIndex));
    setConfirmDeleteId(null);
    setError(null);

    // Reuse pre-loaded photos when provided by FixerStationView (0 extra Firestore reads)
    if (initialPhotos) {
      setPhotos(initialPhotos);
      return;
    }

    // Perform an on-demand point read when opened from FrontDeskView
    let cancelled = false;
    setLoading(true);

    fetchRepairPhotos(sessionId, repairItem.id)
      .then((loaded) => {
        if (!cancelled) {
          setPhotos(loaded);
          setActiveIndex(0);
        }
      })
      .catch((err) => {
        // Surface fetch errors if the component is still mounted
        if (!cancelled) {
          setError(err instanceof Error ? err.message : 'Failed to load item photos.');
        }
      })
      .finally(() => {
        if (!cancelled) {
          setLoading(false);
        }
      });

    // Guard against setting state after modal unmount
    return () => {
      cancelled = true;
    };
  }, [isOpen, sessionId, repairItem.id, initialPhotos, initialIndex]);

  if (!isOpen) return null;

  // Clamp activeIndex so deleting the last photo never causes an out-of-bounds read
  const safeIndex = Math.min(activeIndex, Math.max(0, photos.length - 1));
  const activePhoto: RepairPhoto | undefined = photos[safeIndex];

  // Handle atomic deletion of the currently viewed photo
  const handleDeletePhoto = async (photo: RepairPhoto) => {
    setDeleting(true);
    setError(null);
    try {
      // Atomically delete photo doc and decrement parent repair.photoCount via writeBatch
      await deleteRepairPhoto(sessionId, repairItem.id, photo.id, photos.length);
      const remaining = photos.filter((p) => p.id !== photo.id);
      setPhotos(remaining);
      setConfirmDeleteId(null);

      // Clamp index to remaining photos and notify parent view
      setActiveIndex(Math.min(safeIndex, Math.max(0, remaining.length - 1)));
      onPhotosChange?.(remaining);

      // Automatically close modal once the last photo on the item has been deleted
      if (remaining.length === 0) {
        onClose();
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to delete photo.');
    } finally {
      setDeleting(false);
    }
  };

  return (
    <div
      ref={dialogRef}
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm p-4 overflow-y-auto"
      role="dialog"
      aria-modal="true"
      aria-labelledby="photo-viewer-modal-title"
      tabIndex={-1}
    >
      {/* Modal card container */}
      <div className="w-full max-w-xl rounded-3xl bg-white p-5 sm:p-6 shadow-2xl border border-slate-200 my-8">
        {/* Header with item details and close button */}
        <div className="flex items-start justify-between gap-3 pb-3 border-b border-slate-100">
          <div className="flex items-center gap-2.5">
            <div className="h-10 w-10 rounded-xl bg-brand-50 text-brand-700 flex items-center justify-center flex-shrink-0">
              <Camera className="h-5 w-5" aria-hidden="true" />
            </div>
            {/* Item title, card number, and reference token subtitle */}
            <div>
              <h3 id="photo-viewer-modal-title" className="text-base sm:text-lg font-bold text-slate-900">
                Item Photos {photos.length > 0 && `(${safeIndex + 1} of ${photos.length})`}
              </h3>
              <p className="text-xs text-slate-500">
                <strong>{repairItem.item.brandModel}</strong>{' '}
                {repairItem.cardNumber ? `• Card #${repairItem.cardNumber}` : ''} • {repairItem.referenceToken}
              </p>
            </div>
          </div>
          {/* Top-right modal close button */}
          <button
            type="button"
            onClick={onClose}
            aria-label="Close photo viewer"
            className="p-2 rounded-xl text-slate-600 hover:text-slate-800 hover:bg-slate-100 transition-colors"
          >
            <X className="h-5 w-5" aria-hidden="true" />
          </button>
        </div>

        {/* Error alert banner */}
        {error && (
          <div
            role="alert"
            className="mt-3 p-3 rounded-xl bg-rose-50 border border-rose-200 text-xs font-semibold text-rose-800 flex items-center gap-2"
          >
            <AlertTriangle className="h-4 w-4 text-rose-600 flex-shrink-0" aria-hidden="true" />
            <span>{error}</span>
          </div>
        )}

        {/* Body: Loading spinner, empty state, or active photo preview */}
        {loading ? (
          <div className="py-16 text-center text-slate-500">
            <RefreshCw className="h-7 w-7 animate-spin mx-auto mb-2 text-brand-600" aria-hidden="true" />
            <p className="text-xs font-semibold">Loading item photos...</p>
          </div>
        ) : !activePhoto ? (
          <div className="py-12 text-center text-slate-500">
            <Camera className="h-8 w-8 mx-auto mb-2 text-slate-300" aria-hidden="true" />
            <p className="text-sm font-semibold text-slate-700">No photos attached to this item</p>
          </div>
        ) : (
          <div className="mt-4 space-y-4">
            {/* Full-size compressed image frame with prev/next arrows if 2 photos */}
            <div className="relative rounded-2xl bg-slate-900 overflow-hidden flex items-center justify-center min-h-[240px] max-h-[420px]">
              <img
                src={activePhoto.dataUrl}
                alt={`${repairItem.item.brandModel} photo ${safeIndex + 1}`}
                className="max-h-[420px] w-auto object-contain"
              />

              {/* Previous / Next carousel controls when multiple photos exist */}
              {photos.length > 1 && (
                <>
                  {/* Previous photo button */}
                  <button
                    type="button"
                    onClick={() => {
                      setConfirmDeleteId(null);
                      setActiveIndex((prev) => (prev > 0 ? prev - 1 : photos.length - 1));
                    }}
                    aria-label="Previous photo"
                    title="Previous photo"
                    className="absolute left-2.5 top-1/2 -translate-y-1/2 p-2 rounded-full bg-black/60 text-white hover:bg-black/80 transition-colors"
                  >
                    <ChevronLeft className="h-5 w-5" aria-hidden="true" />
                  </button>
                  {/* Next photo button */}
                  <button
                    type="button"
                    onClick={() => {
                      setConfirmDeleteId(null);
                      setActiveIndex((prev) => (prev < photos.length - 1 ? prev + 1 : 0));
                    }}
                    aria-label="Next photo"
                    title="Next photo"
                    className="absolute right-2.5 top-1/2 -translate-y-1/2 p-2 rounded-full bg-black/60 text-white hover:bg-black/80 transition-colors"
                  >
                    <ChevronRight className="h-5 w-5" aria-hidden="true" />
                  </button>
                </>
              )}
            </div>

            {/* Thumbnail switcher when 2 photos are present */}
            {photos.length > 1 && (
              <div className="flex items-center justify-center gap-2.5">
                {photos.map((p, idx) => (
                  // Individual thumbnail selector button
                  <button
                    key={p.id}
                    type="button"
                    aria-label={`Select photo ${idx + 1}`}
                    aria-pressed={idx === safeIndex}
                    onClick={() => {
                      setConfirmDeleteId(null);
                      setActiveIndex(idx);
                    }}
                    className={`h-14 w-14 rounded-xl overflow-hidden border-2 transition-all ${
                      idx === safeIndex
                        ? 'border-brand-600 ring-2 ring-brand-200'
                        : 'border-slate-200 opacity-60 hover:opacity-100'
                    }`}
                  >
                    {/* Thumbnail preview image */}
                    <img
                      src={p.dataUrl}
                      alt={`Thumbnail ${idx + 1}`}
                      className="h-full w-full object-cover"
                    />
                  </button>
                ))}
              </div>
            )}

            {/* Metadata bar showing volunteer uploader, dimensions, KB size, and EXIF status */}
            <div className="flex flex-wrap items-center justify-between gap-2 px-3.5 py-2.5 rounded-xl bg-slate-50 border border-slate-200 text-xs text-slate-600">
              <div>
                Uploaded by <strong className="text-slate-800">{activePhoto.uploadedBy || 'Volunteer Fixer'}</strong>
              </div>
              <div className="font-mono text-[11px] text-slate-500">
                {activePhoto.width}×{activePhoto.height}px • {formatPhotoSizeKb(activePhoto.sizeBytes)} • EXIF Stripped
              </div>
            </div>

            {/* Action buttons: Download & Two-Step Delete Confirmation */}
            {confirmDeleteId === activePhoto.id ? (
              <div className="p-3.5 rounded-2xl bg-rose-50 border border-rose-200 flex flex-col sm:flex-row items-center justify-between gap-3">
                <span className="text-xs font-bold text-rose-900">
                  Permanently delete Photo {safeIndex + 1} from this repair record?
                </span>
                {/* Cancel or Confirm Delete button group */}
                <div className="flex items-center gap-2 w-full sm:w-auto">
                  <button
                    type="button"
                    disabled={deleting}
                    onClick={() => setConfirmDeleteId(null)}
                    className="flex-1 sm:flex-initial px-3 py-1.5 rounded-xl border border-slate-300 bg-white text-xs font-semibold text-slate-700 hover:bg-slate-50"
                  >
                    Cancel
                  </button>
                  {/* Execute atomic batch deletion */}
                  <button
                    type="button"
                    disabled={deleting}
                    onClick={() => handleDeletePhoto(activePhoto)}
                    className="flex-1 sm:flex-initial px-3.5 py-1.5 rounded-xl bg-rose-600 text-xs font-bold text-white hover:bg-rose-700 disabled:opacity-50"
                  >
                    {deleting ? 'Deleting...' : 'Confirm Delete'}
                  </button>
                </div>
              </div>
            ) : (
              <div className="flex flex-wrap items-center justify-between gap-2 pt-1">
                {/* Prompt for two-step photo deletion */}
                <button
                  type="button"
                  onClick={() => setConfirmDeleteId(activePhoto.id)}
                  className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-xl border border-rose-200 bg-rose-50/70 text-rose-700 hover:bg-rose-100 text-xs font-bold transition-colors"
                >
                  <Trash2 className="h-4 w-4" />
                  Delete Photo
                </button>

                {/* Download photo link and Close modal button */}
                <div className="flex items-center gap-2">
                  <a
                    href={activePhoto.dataUrl}
                    download={generatePhotoDownloadFilename(
                      repairItem.cardNumber,
                      repairItem.referenceToken,
                      safeIndex,
                      activePhoto.mimeType
                    )}
                    className="inline-flex items-center gap-1.5 px-4 py-2 rounded-xl bg-brand-600 text-white hover:bg-brand-700 text-xs font-bold shadow-sm transition-colors"
                  >
                    <Download className="h-4 w-4" />
                    Download Photo
                  </a>
                  {/* Secondary Close button */}
                  <button
                    type="button"
                    onClick={onClose}
                    className="px-4 py-2 rounded-xl border border-slate-300 text-xs font-semibold text-slate-700 hover:bg-slate-50"
                  >
                    Close
                  </button>
                </div>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
};
