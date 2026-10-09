import React from 'react';
import { AlertTriangle, ShieldAlert, AlertCircle, CheckCircle2 } from 'lucide-react';
import { PatInitialOutcome } from '../../types';

interface SafetyBannerProps {
  outcome?: PatInitialOutcome;
  cautionNotes?: string;
}

export const SafetyBanner: React.FC<SafetyBannerProps> = ({ outcome, cautionNotes }) => {
  if (!outcome) return null;

  if (outcome === 'DANGER_DO_NOT_ENERGIZE') {
    return (
      <div className="rounded-lg border-2 border-red-600 bg-red-50 p-4 text-red-950 shadow-sm animate-pulse">
        <div className="flex items-start gap-3">
          <ShieldAlert className="h-6 w-6 text-red-600 flex-shrink-0 mt-0.5" />
          <div>
            <h4 className="font-bold text-base text-red-900 tracking-wide uppercase">
              DANGER: DO NOT ENERGIZE (LETHAL HAZARD)
            </h4>
            <p className="mt-1 text-sm font-medium text-red-800">
              This item failed initial PAT testing with catastrophic safety or insulation failure. 
              Under no circumstances may this item be plugged into mains power.
            </p>
            {cautionNotes && (
              <p className="mt-2 text-sm italic bg-red-100 p-2 rounded border border-red-300">
                PAT Notes: {cautionNotes}
              </p>
            )}
          </div>
        </div>
      </div>
    );
  }

  if (outcome === 'FAIL_REPAIRABLE_CORD') {
    return (
      <div className="rounded-lg border-2 border-amber-500 bg-amber-50 p-4 text-amber-950 shadow-sm">
        <div className="flex items-start gap-3">
          <AlertTriangle className="h-6 w-6 text-amber-600 flex-shrink-0 mt-0.5" />
          <div>
            <h4 className="font-bold text-base text-amber-900 uppercase">
              Electrical Caution: Repairable Cord / Plug Defect
            </h4>
            <p className="mt-1 text-sm text-amber-800">
              The item failed initial PAT testing due to a physical cord or plug fault. Fixers may repair 
              or replace the power flex/plug. <strong>Item MUST be re-tested (PAT 2) after repair before handing to customer.</strong>
            </p>
            {cautionNotes && (
              <p className="mt-2 text-sm italic bg-amber-100 p-2 rounded border border-amber-300">
                PAT Notes: {cautionNotes}
              </p>
            )}
          </div>
        </div>
      </div>
    );
  }

  if (outcome === 'UNTESTABLE') {
    return (
      <div className="rounded-lg border border-slate-400 bg-slate-50 p-4 text-slate-800 shadow-sm">
        <div className="flex items-start gap-3">
          <AlertCircle className="h-6 w-6 text-slate-500 flex-shrink-0 mt-0.5" />
          <div>
            <h4 className="font-bold text-base text-slate-900">
              PAT Status: Untestable at Initial Check
            </h4>
            <p className="mt-1 text-sm text-slate-700">
              Item could not be fully tested (e.g. non-standard connector or missing power brick). 
              Exercise caution during visual inspection.
            </p>
            {cautionNotes && (
              <p className="mt-2 text-sm italic bg-slate-200 p-2 rounded">
                Notes: {cautionNotes}
              </p>
            )}
          </div>
        </div>
      </div>
    );
  }

  if (outcome === 'PASS') {
    return (
      <div className="rounded-lg border border-emerald-300 bg-emerald-50 p-3 text-emerald-950 shadow-sm">
        <div className="flex items-center gap-2">
          <CheckCircle2 className="h-5 w-5 text-emerald-600 flex-shrink-0" />
          <span className="font-medium text-sm text-emerald-900">
            Initial PAT Check Passed. Safe to inspect.
          </span>
        </div>
      </div>
    );
  }

  return null;
};
