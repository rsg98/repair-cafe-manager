import React from 'react';
import { RefreshCw, X } from 'lucide-react';

/**
 * Props for the UpdateBanner component.
 */
export interface UpdateBannerProps {
  /** True when a new Service Worker is waiting or a mandatory update is signalled */
  updateAvailable: boolean;
  /** True when the local version is older than the minimum supported version */
  isMandatoryUpdate: boolean;
  /** True when the user has unsaved form input or an active confirmation modal */
  isDirty: boolean;
  /** True when the user clicked "Later" on a non-mandatory update banner */
  bannerDismissed: boolean;
  /** Callback to immediately activate the waiting Service Worker and reload */
  onUpdateNow: () => void;
  /** Callback to dismiss the non-mandatory update banner until work completes */
  onDismiss: () => void;
}

/**
 * Non-blocking top banner displayed when a new app version has finished downloading
 * in the background while the user is actively completing a form or viewing a confirmation token.
 * When `isDirty` is false, `usePwaUpdate` applies the update automatically, so this banner
 * only appears when an automatic reload is deferred to protect in-progress work.
 */
export const UpdateBanner: React.FC<UpdateBannerProps> = ({
  updateAvailable,
  isMandatoryUpdate,
  isDirty,
  bannerDismissed,
  onUpdateNow,
  onDismiss,
}) => {
  // Only render when an update is waiting, work is in progress, and the banner hasn't been dismissed
  const shouldShow =
    updateAvailable && isDirty && (!bannerDismissed || isMandatoryUpdate);

  // Return nothing if no deferred update needs user attention
  if (!shouldShow) {
    return null;
  }

  // Render an accessible status banner at the top of the viewport
  return (
    <div
      role="status"
      aria-live="polite"
      className={`${
        isMandatoryUpdate
          ? 'bg-amber-600 text-white'
          : 'bg-emerald-800 text-white'
      } px-4 py-2.5 text-xs sm:text-sm font-medium shadow-sm transition-colors`}
    >
      {/* Flex container aligning the update message and action buttons */}
      <div className="max-w-7xl mx-auto flex flex-col sm:flex-row items-center justify-between gap-2">
        <div className="flex items-center gap-2 text-center sm:text-left">
          <RefreshCw className="h-4 w-4 shrink-0 animate-spin" aria-hidden="true" />
          <span>
            {isMandatoryUpdate
              ? 'A required app update is ready. It will install automatically once you finish this screen, or you can update now.'
              : 'A new version of the app is ready. It will install automatically as soon as you finish this form, or you can update now.'}
          </span>
        </div>

        {/* Action controls allowing immediate reload or temporary dismissal */}
        <div className="flex items-center gap-2 shrink-0">
          <button
            type="button"
            onClick={onUpdateNow}
            className="px-3 py-1 rounded-lg bg-white text-emerald-900 font-bold hover:bg-emerald-50 transition-colors cursor-pointer shadow-xs"
          >
            Update Now
          </button>

          {/* Allow dismissing the banner only when the update is not mandatory */}
          {!isMandatoryUpdate && (
            <button
              type="button"
              onClick={onDismiss}
              aria-label="Later — dismiss update notice"
              className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg bg-emerald-700/80 text-emerald-100 hover:bg-emerald-700 transition-colors cursor-pointer"
            >
              <span>Later</span>
              <X className="h-3.5 w-3.5" aria-hidden="true" />
            </button>
          )}
        </div>
      </div>
    </div>
  );
};
