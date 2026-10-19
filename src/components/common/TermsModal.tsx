import React, { useState, useEffect, useCallback } from 'react';
import { X, ShieldCheck, Loader2, AlertCircle, RefreshCw } from 'lucide-react';
import { cafeConfig } from '../../config/cafe.config';
import { MarkdownViewer } from './MarkdownViewer';

interface TermsModalProps {
  isOpen: boolean;
  onClose: () => void;
  onAccept?: () => void;
}

// Module-level cache so fetched terms persist across modal open/close without refetching
let cachedTermsText: string | null = null;

const FALLBACK_TERMS_SUMMARY = `### ${cafeConfig.cafeName} Terms & House Rules (Summary)

1. **Free & Voluntary Basis:** Work carried out in the Repair Café is performed free of charge on a voluntary basis by repair experts. New materials or parts may be charged separately (at cost), and voluntary donations are appreciated.
2. **Safety Testing (PAT):** All mains-powered (240V) electrical appliances must undergo safety inspection before and after repair. Devices deemed unsafe will not be energised.
3. **Liability:** Visitors offer broken items for repair at their own risk. Organisers and repair experts offer no guarantee and are not liable for any loss or if repaired objects subsequently fail to work properly.
4. **Repairing & Unrepairable Items:** ONE broken item per person will be examined at a time during busy periods. Repair experts are not obliged to reassemble disassembled appliances that cannot be repaired, and visitors are responsible for the tidy removal of items that could not be repaired.
5. **Home Repairs & Collection:** If a repairer offers to complete a repair at home, the repairer and customer must exchange contact details and neither the Repair Café nor the repairer assume responsibility for safe-keeping.
6. **Photos, Video & Data Protection:** By attending, you consent to photos or videos taken being used in social media and publicity. Personal contact details are collected solely for on-day queue management and will be redacted following the session.`;

export const TermsModal: React.FC<TermsModalProps> = ({ isOpen, onClose, onAccept }) => {
  const [content, setContent] = useState<string>(cachedTermsText || '');
  const [loading, setLoading] = useState<boolean>(!cachedTermsText);
  const [error, setError] = useState<string | null>(null);

  const fetchTerms = useCallback(async () => {
    const source = cafeConfig.termsAndConditions;
    const isUrlOrPath =
      source.startsWith('/') ||
      source.startsWith('http://') ||
      source.startsWith('https://') ||
      source.endsWith('.md');

    if (!isUrlOrPath) {
      setContent(source);
      cachedTermsText = source;
      setLoading(false);
      return;
    }

    setLoading(true);
    setError(null);

    try {
      const response = await fetch(source);
      if (!response.ok) {
        throw new Error(`HTTP ${response.status} ${response.statusText}`);
      }
      const text = await response.text();
      setContent(text);
      cachedTermsText = text;
    } catch (err) {
      console.error('Failed to load terms document:', err);
      setError('Could not load the detailed terms document from the server.');
      // If we don't have cached content, provide the summary fallback
      if (!cachedTermsText) {
        setContent(FALLBACK_TERMS_SUMMARY);
      }
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (isOpen && !content) {
      fetchTerms();
    }
  }, [isOpen, content, fetchTerms]);

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4">
      <div className="w-full max-w-2xl rounded-2xl bg-white p-6 shadow-2xl border border-slate-200 flex flex-col max-h-[90vh]">
        {/* Header */}
        <div className="flex items-center justify-between pb-3 border-b border-slate-200">
          <div className="flex items-center gap-2">
            <ShieldCheck className="h-6 w-6 text-brand-700" />
            <div>
              <h3 className="text-lg font-bold text-slate-900 leading-none">
                {cafeConfig.cafeName} Terms & House Rules
              </h3>
              <p className="text-xs text-slate-500 mt-1">
                Version {cafeConfig.termsVersion} • Legal Agreement & Safety Code
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="rounded-full p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-600 transition-colors"
            title="Close"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        {/* Modal Body */}
        <div className="my-4 overflow-y-auto pr-2 text-sm text-slate-700 space-y-3 leading-relaxed flex-1">
          {loading ? (
            <div className="py-12 flex flex-col items-center justify-center text-slate-500 gap-3">
              <Loader2 className="h-8 w-8 animate-spin text-brand-600" />
              <p className="text-sm font-medium">Loading terms & conditions...</p>
            </div>
          ) : (
            <>
              {error && (
                <div className="p-3.5 bg-amber-50 border border-amber-200 rounded-xl text-amber-900 text-xs sm:text-sm flex items-start gap-2.5 mb-3">
                  <AlertCircle className="h-5 w-5 text-amber-600 shrink-0 mt-0.5" />
                  <div className="flex-1">
                    <p className="font-semibold">{error}</p>
                    <p className="mt-0.5 text-amber-700">Displaying offline summary below.</p>
                  </div>
                  <button
                    type="button"
                    onClick={fetchTerms}
                    className="flex items-center gap-1 px-2.5 py-1 bg-amber-100 hover:bg-amber-200 text-amber-900 rounded-lg text-xs font-semibold shrink-0"
                  >
                    <RefreshCw className="h-3.5 w-3.5" />
                    Retry
                  </button>
                </div>
              )}
              <MarkdownViewer content={content} />
            </>
          )}
        </div>

        {/* Modal Footer */}
        <div className="pt-3 border-t border-slate-200 flex items-center justify-between gap-3">
          <div className="text-xs text-slate-500 hidden sm:block">
            Acceptance is required to register an item for repair.
          </div>
          <div className="flex justify-end gap-3 w-full sm:w-auto">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 rounded-lg border border-slate-300 text-sm font-semibold text-slate-700 hover:bg-slate-50 transition-colors"
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
                className="px-5 py-2 rounded-lg bg-brand-600 text-sm font-bold text-white hover:bg-brand-700 active:bg-brand-800 shadow-sm transition-colors"
              >
                I Agree & Understand
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};
