// @vitest-environment happy-dom
import React, { useState, act } from 'react';
import { createRoot, Root } from 'react-dom/client';
import { MemoryRouter } from 'react-router-dom';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

vi.mock('../src/services/firebase', () => ({
  app: {},
  db: {},
  auth: {},
  googleAuthProvider: {},
  functions: {},
}));

import {
  useDialogFocusTrap,
  resetDialogStackForTesting,
} from '../src/hooks/useDialogFocusTrap';
import { RouteTitleSynchronizer } from '../src/App';
import { cafeConfig } from '../src/config/cafe.config';
import { UnsavedWorkProvider } from '../src/context/UnsavedWorkContext';
import { PinModal, resolvePinKeyInput } from '../src/components/common/PinModal';

const SingleDialogHarness: React.FC = () => {
  const [open, setOpen] = useState(false);
  const dialogRef = useDialogFocusTrap({
    isOpen: open,
    onClose: () => setOpen(false),
  });

  return (
    <div>
      <button
        id="open-dialog-trigger"
        type="button"
        onClick={() => setOpen(true)}
      >
        Open Dialog
      </button>
      {open && (
        <div
          ref={dialogRef}
          role="dialog"
          aria-modal="true"
          aria-labelledby="harness-dialog-title"
          tabIndex={-1}
        >
          <h2 id="harness-dialog-title">Test Modal</h2>
          <input id="dialog-first-input" type="text" />
          <button id="dialog-middle-btn" type="button">
            Action
          </button>
          <button
            id="dialog-last-btn"
            type="button"
            onClick={() => setOpen(false)}
          >
            Close
          </button>
        </div>
      )}
    </div>
  );
};

const StackedDialogHarness: React.FC = () => {
  const [parentOpen, setParentOpen] = useState(true);
  const [childOpen, setChildOpen] = useState(true);

  const parentRef = useDialogFocusTrap({
    isOpen: parentOpen,
    onClose: () => setParentOpen(false),
  });

  const childRef = useDialogFocusTrap({
    isOpen: childOpen,
    onClose: () => setChildOpen(false),
  });

  return (
    <div>
      {parentOpen && (
        <div
          ref={parentRef}
          id="parent-dialog"
          role="dialog"
          aria-modal="true"
          aria-labelledby="parent-title"
          tabIndex={-1}
        >
          <h2 id="parent-title">Parent Dialog</h2>
          <button id="parent-btn" type="button">
            Parent Button
          </button>
        </div>
      )}
      {childOpen && (
        <div
          ref={childRef}
          id="child-dialog"
          role="dialog"
          aria-modal="true"
          aria-labelledby="child-title"
          tabIndex={-1}
        >
          <h2 id="child-title">Child Dialog</h2>
          <button id="child-btn-1" type="button">
            Child First
          </button>
          <button id="child-btn-2" type="button">
            Child Last
          </button>
        </div>
      )}
    </div>
  );
};

describe('WCAG 2.2 Level AA Keyboard, Focus Trap & Route Title Behaviour', () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    resetDialogStackForTesting();
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(async () => {
    await act(async () => {
      root.unmount();
    });
    container.remove();
    resetDialogStackForTesting();
  });

  it('traps Tab / Shift+Tab inside an open dialog, closes on Escape, and restores focus to the trigger (WCAG 2.1.2, 2.4.3)', async () => {
    await act(async () => {
      root.render(<SingleDialogHarness />);
    });

    const trigger = container.querySelector<HTMLButtonElement>('#open-dialog-trigger')!;
    trigger.focus();
    expect(document.activeElement).toBe(trigger);

    // Open the modal dialog
    await act(async () => {
      trigger.click();
    });

    const firstInput = container.querySelector<HTMLInputElement>('#dialog-first-input')!;
    const lastBtn = container.querySelector<HTMLButtonElement>('#dialog-last-btn')!;

    // Initial focus moves to the first focusable element inside the dialog
    expect(document.activeElement).toBe(firstInput);

    // Shift+Tab from the first element wraps to the last element
    await act(async () => {
      document.dispatchEvent(
        new KeyboardEvent('keydown', { key: 'Tab', shiftKey: true, bubbles: true })
      );
    });
    expect(document.activeElement).toBe(lastBtn);

    // Tab from the last element wraps back to the first element
    await act(async () => {
      document.dispatchEvent(
        new KeyboardEvent('keydown', { key: 'Tab', shiftKey: false, bubbles: true })
      );
    });
    expect(document.activeElement).toBe(firstInput);

    // Pressing Escape closes the dialog and restores focus to the trigger button
    await act(async () => {
      document.dispatchEvent(
        new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })
      );
    });
    expect(container.querySelector('[role="dialog"]')).toBeNull();
    expect(document.activeElement).toBe(trigger);
  });

  it('isolates Escape and Tab handling to the topmost stacked modal and returns focus to parent modal on close', async () => {
    await act(async () => {
      root.render(<StackedDialogHarness />);
    });

    const parentBtn = container.querySelector<HTMLButtonElement>('#parent-btn')!;
    const childBtn1 = container.querySelector<HTMLButtonElement>('#child-btn-1')!;
    const childBtn2 = container.querySelector<HTMLButtonElement>('#child-btn-2')!;

    // Child dialog is topmost so its first button holds focus
    expect(document.activeElement).toBe(childBtn1);

    // Shift+Tab wraps within the child dialog
    await act(async () => {
      document.dispatchEvent(
        new KeyboardEvent('keydown', { key: 'Tab', shiftKey: true, bubbles: true })
      );
    });
    expect(document.activeElement).toBe(childBtn2);

    // Escape closes only the child dialog while keeping the parent dialog open and focused
    await act(async () => {
      document.dispatchEvent(
        new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })
      );
    });
    expect(container.querySelector('#child-dialog')).toBeNull();
    expect(container.querySelector('#parent-dialog')).not.toBeNull();
    expect(document.activeElement).toBe(parentBtn);
  });

  it('synchronises document.title across all 5 station routes via RouteTitleSynchronizer (WCAG 2.4.2)', async () => {
    const routeExpectations: Array<[string, string]> = [
      ['/register', `Check-In Item | ${cafeConfig.cafeName}`],
      ['/frontdesk', `Front Desk Board | ${cafeConfig.cafeName}`],
      ['/pat', `PAT Safety Station | ${cafeConfig.cafeName}`],
      ['/fixer', `Volunteer Fixer Station | ${cafeConfig.cafeName}`],
      ['/reports', `Community Impact Reports | ${cafeConfig.cafeName}`],
    ];

    for (const [route, expectedTitle] of routeExpectations) {
      await act(async () => {
        root.render(
          <MemoryRouter key={route} initialEntries={[route]}>
            <RouteTitleSynchronizer />
          </MemoryRouter>
        );
      });
      expect(document.title).toBe(expectedTitle);
    }
  });

  it('supports physical keyboard PIN entry, Backspace, Enter submission, and Escape dismissal in PinModal (WCAG 2.1.1)', async () => {
    // Pure key resolver unit checks
    expect(resolvePinKeyInput('48', '2')).toEqual({ type: 'DIGIT', nextPin: '482' });
    expect(resolvePinKeyInput('482', 'Backspace')).toEqual({ type: 'BACKSPACE', nextPin: '48' });
    expect(resolvePinKeyInput('482', 'Delete')).toEqual({ type: 'CLEAR', nextPin: '' });
    expect(resolvePinKeyInput('4829', 'Enter')).toEqual({ type: 'SUBMIT', nextPin: '4829' });
    expect(resolvePinKeyInput('48', '2', { metaKey: true })).toEqual({ type: 'IGNORE', nextPin: '48' });

    const onVerify = vi.fn().mockResolvedValue(true);
    const onClose = vi.fn();

    await act(async () => {
      root.render(
        <UnsavedWorkProvider>
          <PinModal
            isOpen={true}
            stationName="PAT Safety Station"
            onVerify={onVerify}
            onClose={onClose}
          />
        </UnsavedWorkProvider>
      );
    });

    // Type 4 digits using physical keyboard events
    for (const digit of ['4', '8', '2', '9']) {
      await act(async () => {
        window.dispatchEvent(new KeyboardEvent('keydown', { key: digit, bubbles: true }));
      });
    }

    expect(container.textContent).toContain('4 of 4 digits entered');

    // Press Enter to submit the 4-digit PIN
    await act(async () => {
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    });
    expect(onVerify).toHaveBeenCalledWith('4829');

    // Press Escape to dismiss the dialog
    await act(async () => {
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    });
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});
