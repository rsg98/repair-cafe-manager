import React from 'react';
import { X, ShieldCheck } from 'lucide-react';
import { cafeConfig } from '../../config/cafe.config';

interface TermsModalProps {
  isOpen: boolean;
  onClose: () => void;
  onAccept?: () => void;
}

export const TermsModal: React.FC<TermsModalProps> = ({ isOpen, onClose, onAccept }) => {
  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4">
      <div className="w-full max-w-lg rounded-2xl bg-white p-6 shadow-2xl border border-slate-200 flex flex-col max-h-[90vh]">
        <div className="flex items-center justify-between pb-3 border-b border-slate-200">
          <div className="flex items-center gap-2">
            <ShieldCheck className="h-6 w-6 text-brand-700" />
            <h3 className="text-lg font-bold text-slate-900">{cafeConfig.cafeName} Terms & House Rules</h3>
          </div>
          <button 
            onClick={onClose} 
            className="rounded-full p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-600"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        <div className="my-4 overflow-y-auto pr-2 text-sm text-slate-700 space-y-3 leading-relaxed">
          <div className="whitespace-pre-line font-sans">
            {cafeConfig.termsAndConditions}
          </div>
        </div>

        <div className="pt-3 border-t border-slate-200 flex justify-end gap-3">
          <button
            type="button"
            onClick={onClose}
            className="px-4 py-2 rounded-lg border border-slate-300 text-sm font-semibold text-slate-700 hover:bg-slate-50"
          >
            Close
          </button>
          {onAccept && (
            <button
              type="button"
              onClick={() => {
                onAccept();
                onClose();
              }}
              className="px-5 py-2 rounded-lg bg-brand-600 text-sm font-bold text-white hover:bg-brand-700 shadow-sm"
            >
              I Agree & Understand
            </button>
          )}
        </div>
      </div>
    </div>
  );
};
