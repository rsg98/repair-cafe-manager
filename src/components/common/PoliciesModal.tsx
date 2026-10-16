import React, { useState } from 'react';
import { BookOpen, X, ShieldCheck, Calendar, Tag } from 'lucide-react';
import { getPolicies } from '../../services/policyService';
import { PolicyDocument } from '../../types';
import { MarkdownViewer } from './MarkdownViewer';

export interface PoliciesModalProps {
  isOpen: boolean;
  onClose: () => void;
  initialPolicyId?: string;
  inline?: boolean;
}

/**
 * Displays the collection of Repair Café policy Markdown documents (excluding templates)
 * either inside a modal dialog (`inline = false`) or embedded directly in a tab (`inline = true`).
 */
export const PoliciesModal: React.FC<PoliciesModalProps> = ({
  isOpen,
  onClose,
  initialPolicyId,
  inline = false,
}) => {
  // Retrieve all active non-template policies bundled at build time
  const policies: PolicyDocument[] = getPolicies();
  const [selectedPolicyId, setSelectedPolicyId] = useState<string>(
    initialPolicyId || policies[0]?.id || ''
  );

  // Do not render anything when used as a closed modal
  if (!inline && !isOpen) {
    return null;
  }

  // Resolve the currently selected policy document, falling back to the first policy
  const activePolicy =
    policies.find((p) => p.id === selectedPolicyId) || policies[0] || null;

  // Build the shared inner layout for navigating and reading policy documents
  const viewerBody = (
    <div
      className={`bg-white rounded-3xl border border-slate-200 shadow-sm overflow-hidden flex flex-col ${
        inline ? 'min-h-[540px]' : 'w-full max-w-5xl max-h-[88vh] shadow-2xl'
      }`}
    >
      {/* Header bar with title and optional modal close button */}
      <div className="flex items-center justify-between px-6 py-4 border-b border-slate-200 bg-slate-50">
        <div className="flex items-center gap-3">
          <div className="h-10 w-10 rounded-xl bg-emerald-100 text-emerald-800 flex items-center justify-center">
            <BookOpen className="h-5 w-5" />
          </div>
          <div>
            <h3 className="text-lg font-black text-slate-900">
              Repair Café Policies & Induction Pack
            </h3>
            <p className="text-xs text-slate-500">
              Official Health & Safety, Safeguarding, and Data Protection policies for volunteers
            </p>
          </div>
        </div>

        {!inline && (
          <button
            type="button"
            onClick={onClose}
            aria-label="Close policies viewer"
            className="p-2 rounded-xl text-slate-500 hover:text-slate-800 hover:bg-slate-200 transition-colors"
          >
            <X className="h-5 w-5" />
          </button>
        )}
      </div>

      {/* Main split pane: Sidebar list of policies + Markdown document reader */}
      <div className="flex flex-col md:flex-row flex-1 overflow-hidden">
        {/* Policy navigation sidebar */}
        <div className="w-full md:w-72 border-b md:border-b-0 md:border-r border-slate-200 bg-slate-50/70 p-4 space-y-2 overflow-y-auto">
          <span className="text-[11px] font-bold uppercase tracking-wider text-slate-400 px-2 block">
            Active Policies ({policies.length})
          </span>
          {policies.map((policy) => {
            const isSelected = activePolicy?.id === policy.id;
            // Render clickable navigation card for each active policy
            return (
              <button
                key={policy.id}
                type="button"
                onClick={() => setSelectedPolicyId(policy.id)}
                className={`w-full text-left p-3 rounded-2xl border transition-all ${
                  isSelected
                    ? 'bg-white border-emerald-500 shadow-sm text-slate-900'
                    : 'bg-transparent border-transparent hover:bg-slate-100 text-slate-700'
                }`}
              >
                {/* Policy ID and category badge */}
                <div className="flex items-center justify-between gap-2">
                  <span className="text-xs font-mono font-bold text-emerald-700">
                    {policy.id}
                  </span>
                  {policy.category && (
                    <span className="text-[10px] font-bold uppercase tracking-wide px-2 py-0.5 rounded-full bg-slate-200/80 text-slate-700">
                      {policy.category}
                    </span>
                  )}
                </div>
                {/* Policy title and brief summary */}
                <div className="font-bold text-sm mt-1">{policy.title}</div>
                {policy.summary && (
                  <p className="text-xs text-slate-500 mt-1 line-clamp-2">
                    {policy.summary}
                  </p>
                )}
              </button>
            );
          })}
        </div>

        {/* Active policy Markdown content pane */}
        <div className="flex-1 p-6 sm:p-8 overflow-y-auto bg-white">
          {activePolicy ? (
            <div>
              {/* Policy metadata badges */}
              <div className="flex flex-wrap items-center gap-2 pb-4 mb-4 border-b border-slate-100 text-xs text-slate-500">
                <span className="inline-flex items-center gap-1 font-semibold text-emerald-800 bg-emerald-50 px-2.5 py-1 rounded-lg border border-emerald-200">
                  <ShieldCheck className="h-3.5 w-3.5" /> {activePolicy.id}
                </span>
                {activePolicy.category && (
                  <span className="inline-flex items-center gap-1 bg-slate-100 text-slate-700 px-2.5 py-1 rounded-lg font-medium">
                    <Tag className="h-3.5 w-3.5" /> {activePolicy.category}
                  </span>
                )}
                {activePolicy.version && (
                  <span className="bg-slate-100 text-slate-700 px-2.5 py-1 rounded-lg font-mono">
                    v{activePolicy.version}
                  </span>
                )}
                {activePolicy.lastUpdated && (
                  <span className="inline-flex items-center gap-1 text-slate-500">
                    <Calendar className="h-3.5 w-3.5" /> Updated {activePolicy.lastUpdated}
                  </span>
                )}
              </div>

              {/* Rendered Markdown content with YAML frontmatter stripped */}
              <MarkdownViewer content={activePolicy.content} />
            </div>
          ) : (
            <div className="py-12 text-center text-slate-500 text-sm">
              No active policy documents found.
            </div>
          )}
        </div>
      </div>
    </div>
  );

  // Return directly when embedded inside a Front Desk tab
  if (inline) {
    return viewerBody;
  }

  // Wrap in a backdrop overlay when rendered as a modal dialog
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4">
      {viewerBody}
    </div>
  );
};
