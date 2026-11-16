import React from 'react';

/**
 * Props for the shared {@link ModalBackdrop} layout component.
 */
export interface ModalBackdropProps {
  /** Modal dialog card element (carrying `role="dialog"`, `aria-modal="true"`, `ref`, and `my-auto`). */
  children: React.ReactNode;
  /** Optional custom backdrop colour/blur utility classes (defaults to `"bg-black/60 backdrop-blur-sm"`). */
  backdropClassName?: string;
}

/**
 * Mobile-safe modal overlay and viewport scroll container (Issue #45, WCAG 1.3.4, 1.4.4, 1.4.10).
 *
 * Separates the fixed translucent backdrop from a dedicated block-level `overflow-y-auto` scroll
 * container wrapping a `min-h-full items-start` flex row:
 * - When a dialog card (`my-auto`) is shorter than the viewport, positive vertical free space is
 *   distributed equally to its top and bottom auto margins so it centres cleanly.
 * - When a dialog card exceeds the viewport height (e.g. mobile iOS portrait/landscape or 200%+
 *   browser zoom), the `min-h-full` flex wrapper expands to fit the card, `my-auto` resolves to
 *   `0`, and `items-start` anchors the top of the dialog at `scrollTop = 0` so top content is
 *   never clipped into unscrollable negative flex coordinates.
 */
export const ModalBackdrop: React.FC<ModalBackdropProps> = ({
  children,
  backdropClassName = 'bg-black/60 backdrop-blur-sm',
}) => {
  return (
    <div className="fixed inset-0 z-50">
      {/* Static dimmed/blurred backdrop kept separate from scroll layer for smooth iOS compositing */}
      <div
        className={`fixed inset-0 ${backdropClassName}`}
        aria-hidden="true"
      />
      {/* Dedicated native block scroll container preventing scroll chaining to underlying page */}
      <div
        data-modal-scroll-container="true"
        className="fixed inset-0 overflow-y-auto overscroll-contain"
      >
        {/* Safe flex wrapper that centres via child `my-auto` when short and grows downward when tall */}
        <div className="flex min-h-full items-start justify-center px-4 pt-[max(1rem,env(safe-area-inset-top))] pb-[max(1.5rem,env(safe-area-inset-bottom))] sm:px-6 sm:pt-8 sm:pb-8">
          {children}
        </div>
      </div>
    </div>
  );
};
