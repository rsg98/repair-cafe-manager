import React, { useState } from 'react';
import { KeyRound, X } from 'lucide-react';

interface PinModalProps {
  isOpen: boolean;
  stationName: string;
  onVerify: (pin: string) => Promise<boolean>;
  onClose?: () => void;
  error?: string | null;
}

export const PinModal: React.FC<PinModalProps> = ({
  isOpen,
  stationName,
  onVerify,
  onClose,
  error
}) => {
  const [pin, setPin] = useState<string>('');
  const [submitting, setSubmitting] = useState<boolean>(false);
  const [localError, setLocalError] = useState<string | null>(null);

  if (!isOpen) return null;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (pin.length !== 4) {
      setLocalError("Please enter the 4-digit session PIN.");
      return;
    }

    setSubmitting(true);
    setLocalError(null);
    const success = await onVerify(pin);
    setSubmitting(false);
    if (!success) {
      setPin('');
    }
  };

  const handleDigit = (digit: string) => {
    if (pin.length < 4) {
      setPin(prev => prev + digit);
    }
  };

  const handleBackspace = () => {
    setPin(prev => prev.slice(0, -1));
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4">
      <div className="w-full max-w-sm rounded-2xl bg-white p-6 shadow-2xl border border-slate-200">
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

        <p className="mt-3 text-sm text-slate-600 text-center">
          Enter today&apos;s 4-digit volunteer PIN to access the <strong>{stationName}</strong>. Ask the Front Desk if you need the code.
        </p>

        {/* PIN dots display */}
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

        {(error || localError) && (
          <p className="mt-4 text-center text-sm font-semibold text-rose-600">
            {error || localError}
          </p>
        )}

        {/* Numeric On-Screen Keypad for community hall tablets */}
        <div className="mt-6 grid grid-cols-3 gap-2.5">
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
          <button
            type="button"
            onClick={handleBackspace}
            className="h-12 rounded-xl bg-slate-100 text-sm font-semibold text-slate-700 active:bg-slate-200 transition-colors shadow-sm"
          >
            Del
          </button>
          <button
            type="button"
            onClick={() => handleDigit('0')}
            className="h-12 rounded-xl bg-slate-100 text-xl font-semibold text-slate-800 active:bg-slate-200 transition-colors shadow-sm"
          >
            0
          </button>
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
