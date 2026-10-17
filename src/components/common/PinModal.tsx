import React, { useState } from 'react';
import { KeyRound, X } from 'lucide-react';
import { useRegisterUnsavedWork } from '../../context/UnsavedWorkContext';

// Props for the touch-friendly 4-digit daily session PIN unlock dialog
interface PinModalProps {
  // Whether the PIN modal overlay should be displayed
  isOpen: boolean;
  // Human-readable name of the station being unlocked (e.g. "PAT Safety Station")
  stationName: string;
  // Async callback that verifies the 4-digit PIN against the session hash
  onVerify: (pin: string) => Promise<boolean>;
  // Optional close handler when dismissing the modal
  onClose?: () => void;
  // Optional verification error message returned by the parent hook
  error?: string | null;
}

/**
 * Touch-first 4-digit numeric keypad modal used by volunteer stations (`/pat` and `/fixer`)
 * to authenticate against the active session's daily PIN without requiring Google accounts.
 */
export const PinModal: React.FC<PinModalProps> = ({
  isOpen,
  stationName,
  onVerify,
  onClose,
  error
}) => {
  // Track typed 4-digit PIN, verification progress, and local validation errors
  const [pin, setPin] = useState<string>('');
  const [submitting, setSubmitting] = useState<boolean>(false);
  const [localError, setLocalError] = useState<string | null>(null);

  // Prevent automatic PWA reload while a volunteer is actively typing or verifying their PIN
  useRegisterUnsavedWork(isOpen && (pin.length > 0 || submitting), 'pin-modal');

  // Do not render modal DOM when already unlocked or closed
  if (!isOpen) return null;

  // Validate 4-digit length and invoke the parent PIN verification handler
  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (pin.length !== 4) {
      setLocalError("Please enter the 4-digit session PIN.");
      return;
    }

    // Lock keypad while verifying PIN hash and minting volunteer custom token
    setSubmitting(true);
    setLocalError(null);
    const success = await onVerify(pin);
    setSubmitting(false);
    // Clear typed digits if the PIN was rejected so the volunteer can retry cleanly
    if (!success) {
      setPin('');
    }
  };

  // Append a single numeric digit (up to 4 digits maximum)
  const handleDigit = (digit: string) => {
    if (pin.length < 4) {
      setPin(prev => prev + digit);
    }
  };

  // Remove the last entered digit when the volunteer taps 'Del'
  const handleBackspace = () => {
    setPin(prev => prev.slice(0, -1));
  };

  return (
    // Full-screen translucent backdrop locking interaction with the underlying station view
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4">
      <div className="w-full max-w-sm rounded-2xl bg-white p-6 shadow-2xl border border-slate-200">
        {/* Modal Header with key icon and optional close button */}
        <div className="flex items-center justify-between pb-4 border-b border-slate-100">
          <div className="flex items-center gap-2">
            <KeyRound className="h-6 w-6 text-brand-700" />
            <h3 className="text-lg font-bold text-slate-800">Volunteer Unlock</h3>
          </div>
          {onClose && (
            <button 
              onClick={onClose} 
              className="rounded-full p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-600"
            >
              <X className="h-5 w-5" />
            </button>
          )}
        </div>

        {/* Instructions directing volunteers to the Front Desk if they need today's PIN */}
        <p className="mt-3 text-sm text-slate-600 text-center">
          Enter today&apos;s 4-digit volunteer PIN to access the <strong>{stationName}</strong>. Ask the Front Desk if you need the code.
        </p>

        {/* 4-box masked PIN progress indicator */}
        <div className="mt-6 flex justify-center gap-4">
          {[0, 1, 2, 3].map((idx) => {
            const hasDigit = pin.length > idx;
            return (
              <div
                key={idx}
                className={`w-12 h-14 rounded-xl border-2 flex items-center justify-center text-2xl font-mono font-bold transition-all ${
                  hasDigit
                    ? 'border-brand-600 bg-brand-50 text-brand-900 shadow-sm'
                    : 'border-slate-200 bg-slate-50 text-slate-400'
                }`}
              >
                {hasDigit ? '•' : ''}
              </div>
            );
          })}
        </div>

        {/* Display server verification error or local length validation error */}
        {(error || localError) && (
          <p className="mt-4 text-center text-sm font-semibold text-rose-600">
            {error || localError}
          </p>
        )}

        {/* Numeric On-Screen Keypad for community hall tablets */}
        <div className="mt-6 grid grid-cols-3 gap-2.5">
          {/* Digits 1 through 9 */}
          {['1', '2', '3', '4', '5', '6', '7', '8', '9'].map((d) => (
            <button
              key={d}
              type="button"
              onClick={() => handleDigit(d)}
              className="h-12 rounded-xl bg-slate-100 text-xl font-semibold text-slate-800 active:bg-slate-200 transition-colors shadow-sm"
            >
              {d}
            </button>
          ))}
          {/* Backspace button to delete the last digit */}
          <button
            type="button"
            onClick={handleBackspace}
            className="h-12 rounded-xl bg-slate-100 text-sm font-semibold text-slate-700 active:bg-slate-200 transition-colors shadow-sm"
          >
            Del
          </button>
          {/* Digit 0 button */}
          <button
            type="button"
            onClick={() => handleDigit('0')}
            className="h-12 rounded-xl bg-slate-100 text-xl font-semibold text-slate-800 active:bg-slate-200 transition-colors shadow-sm"
          >
            0
          </button>
          {/* Submit PIN button (enabled once all 4 digits are entered) */}
          <button
            type="button"
            disabled={pin.length !== 4 || submitting}
            onClick={handleSubmit}
            className="h-12 rounded-xl bg-brand-600 text-base font-bold text-white active:bg-brand-700 disabled:opacity-40 transition-colors shadow-sm"
          >
            {submitting ? '...' : 'OK'}
          </button>
        </div>
      </div>
    </div>
  );
};
