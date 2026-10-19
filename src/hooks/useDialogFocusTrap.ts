import React, { useEffect, useRef } from 'react';

/**
 * Options for the `useDialogFocusTrap` accessibility hook (WCAG 2.1.2, 2.4.3, 4.1.2).
 */
export interface UseDialogFocusTrapOptions {
  /** Whether the modal dialog is currently open */
  isOpen: boolean;
  /** Optional callback invoked when the user presses Escape on the topmost dialog */
  onClose?: () => void;
  /** Optional ref to a specific element inside the dialog that should receive initial focus */
  initialFocusRef?: React.RefObject<HTMLElement | null>;
}

/**
 * Selector matching all standard keyboard-focusable interactive elements inside a dialog.
 */
const FOCUSABLE_SELECTOR = [
  'a[href]',
  'button:not([disabled])',
  'input:not([disabled]):not([type="hidden"])',
  'select:not([disabled])',
  'textarea:not([disabled])',
  '[tabindex]:not([tabindex="-1"])',
].join(', ');

/**
 * Module-level stack of active dialog elements so nested modals (e.g. Volunteer Register ->
 * Emergency Contact, or Add Volunteer -> Policies) only trap Tab/Escape on the topmost dialog.
 */
const activeDialogStack: HTMLElement[] = [];

/**
 * Clears the module-level active dialog stack between unit tests.
 */
export function resetDialogStackForTesting(): void {
  activeDialogStack.length = 0;
}

/**
 * Queries all enabled, non-hidden focusable descendants within a dialog container.
 */
function getFocusableElements(container: HTMLElement): HTMLElement[] {
  const nodes = Array.from(container.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR));
  return nodes.filter(
    (el) =>
      !el.hasAttribute('disabled') &&
      el.getAttribute('aria-hidden') !== 'true' &&
      el.getAttribute('aria-disabled') !== 'true'
  );
}

/**
 * Custom React hook providing WCAG 2.2 Level AA modal dialog focus management:
 * 1. Captures the previously focused trigger element prior to dialog opening.
 * 2. Places initial focus inside the dialog (`initialFocusRef` -> `[autofocus]` -> first focusable -> dialog).
 * 3. Traps `Tab` and `Shift+Tab` navigation within the topmost active dialog.
 * 4. Dismisses the topmost active dialog on `Escape` when `onClose` is provided.
 * 5. Restores focus to the invoking element when the dialog closes and the stack empties.
 */
export function useDialogFocusTrap(
  options: UseDialogFocusTrapOptions
): React.RefObject<HTMLDivElement | null> {
  const { isOpen, onClose, initialFocusRef } = options;
  const dialogRef = useRef<HTMLDivElement | null>(null);

  // Store latest callback and initialFocusRef in refs so inline arrow functions passed by
  // callers never re-trigger the main focus effect while the user is typing in an input.
  const onCloseRef = useRef<(() => void) | undefined>(onClose);
  onCloseRef.current = onClose;

  const initialFocusTargetRef = useRef<React.RefObject<HTMLElement | null> | undefined>(
    initialFocusRef
  );
  initialFocusTargetRef.current = initialFocusRef;

  useEffect(() => {
    if (!isOpen) {
      return;
    }

    const dialogEl = dialogRef.current;
    if (!dialogEl) {
      return;
    }

    let isActive = true;
    const previousActiveElement =
      document.activeElement instanceof HTMLElement ? document.activeElement : null;

    if (!activeDialogStack.includes(dialogEl)) {
      activeDialogStack.push(dialogEl);
    }

    const placeInitialFocus = () => {
      if (!isActive || !dialogEl.isConnected) {
        return;
      }
      if (activeDialogStack[activeDialogStack.length - 1] !== dialogEl) {
        return;
      }

      const currentActive = document.activeElement;
      if (
        currentActive instanceof HTMLElement &&
        dialogEl.contains(currentActive) &&
        currentActive !== dialogEl
      ) {
        return;
      }

      const focusables = getFocusableElements(dialogEl);
      const target =
        initialFocusTargetRef.current?.current ??
        dialogEl.querySelector<HTMLElement>('[autofocus], [data-autofocus="true"]') ??
        focusables[0] ??
        dialogEl;

      target.focus();
    };

    // Place focus immediately for synchronous mounts/tests and schedule a microtask fallback
    placeInitialFocus();
    queueMicrotask(placeInitialFocus);

    const handleKeyDown = (event: KeyboardEvent) => {
      // Only intercept keyboard events for the topmost modal dialog in the stack
      if (activeDialogStack[activeDialogStack.length - 1] !== dialogEl) {
        return;
      }

      if (event.key === 'Escape') {
        if (onCloseRef.current) {
          event.preventDefault();
          event.stopPropagation();
          onCloseRef.current();
        }
        return;
      }

      if (event.key === 'Tab') {
        const focusables = getFocusableElements(dialogEl);
        if (focusables.length === 0) {
          event.preventDefault();
          dialogEl.focus();
          return;
        }

        const firstEl = focusables[0];
        const lastEl = focusables[focusables.length - 1];
        const activeEl =
          document.activeElement instanceof HTMLElement ? document.activeElement : null;

        if (event.shiftKey) {
          if (
            !activeEl ||
            !dialogEl.contains(activeEl) ||
            activeEl === dialogEl ||
            activeEl === firstEl
          ) {
            event.preventDefault();
            lastEl.focus();
          }
        } else {
          if (!activeEl || !dialogEl.contains(activeEl) || activeEl === lastEl) {
            event.preventDefault();
            firstEl.focus();
          }
        }
      }
    };

    document.addEventListener('keydown', handleKeyDown);

    return () => {
      isActive = false;
      document.removeEventListener('keydown', handleKeyDown);

      const idx = activeDialogStack.lastIndexOf(dialogEl);
      if (idx !== -1) {
        activeDialogStack.splice(idx, 1);
      }

      if (activeDialogStack.length === 0) {
        if (previousActiveElement && document.body.contains(previousActiveElement)) {
          previousActiveElement.focus();
        }
      } else {
        const nextTopDialog = activeDialogStack[activeDialogStack.length - 1];
        if (nextTopDialog && document.body.contains(nextTopDialog)) {
          const currentActive = document.activeElement;
          if (
            !(currentActive instanceof HTMLElement) ||
            !nextTopDialog.contains(currentActive)
          ) {
            const focusables = getFocusableElements(nextTopDialog);
            if (focusables.length > 0) {
              focusables[0].focus();
            } else {
              nextTopDialog.focus();
            }
          }
        }
      }
    };
  }, [isOpen]);

  return dialogRef;
}
