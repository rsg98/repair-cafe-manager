import React, { useState, useEffect } from 'react';
import { 
  Hammer, 
  Search, 
  CheckCircle2, 
  Clock, 
  Scale, 
  Wrench, 
  Home, 
  HelpCircle, 
  XCircle
} from 'lucide-react';
import { Session, RepairItem, RepairOutcome } from '../types';
import { useVolunteerPin } from '../hooks/useVolunteerPin';
import { getRepairByCardNumber, submitRepairRecord } from '../services/repairService';
import { CardToken } from '../components/common/CardToken';
import { StatusBadge } from '../components/common/StatusBadge';
import { SafetyBanner } from '../components/common/SafetyBanner';
import { PinModal } from '../components/common/PinModal';

interface FixerStationViewProps {
  session: Session | null;
}

export const FixerStationView: React.FC<FixerStationViewProps> = ({ session }) => {
  const { isUnlocked, unlock, error: pinError } = useVolunteerPin(session);

  // Volunteer persistent settings
  const [fixerName, setFixerName] = useState(() => localStorage.getItem('fixer_volunteer_name') || '');

  // Card search
  const [searchCardNumber, setSearchCardNumber] = useState('');
  const [searching, setSearching] = useState(false);
  const [currentItem, setCurrentItem] = useState<RepairItem | null>(null);
  const [searchMessage, setSearchMessage] = useState<string | null>(null);

  // Repair form state
  const [outcome, setOutcome] = useState<RepairOutcome>('FIXED');
  const [repairTimeMinutes, setRepairTimeMinutes] = useState<number>(30);
  const [weightKg, setWeightKg] = useState<string>('1.5');
  const [diagnosis, setDiagnosis] = useState('');
  const [repairNotes, setRepairNotes] = useState('');
  const [partsUsed, setPartsUsed] = useState('');
  const [submittingRepair, setSubmittingRepair] = useState(false);
  const [successBanner, setSuccessBanner] = useState<string | null>(null);

  useEffect(() => {
    localStorage.setItem('fixer_volunteer_name', fixerName);
  }, [fixerName]);

  const handleSearchCard = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!session) return;
    const num = parseInt(searchCardNumber, 10);
    if (isNaN(num)) return;

    setSearching(true);
    setSearchMessage(null);
    setSuccessBanner(null);

    try {
      const item = await getRepairByCardNumber(session.id, num);
      if (!item) {
        setSearchMessage(`No item found assigned to Card #${num}.`);
        setCurrentItem(null);
      } else {
        setCurrentItem(item);
        if (item.item.weightKg) {
          setWeightKg(String(item.item.weightKg));
        }
      }
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : "Error searching card";
      setSearchMessage(message);
    } finally {
      setSearching(false);
    }
  };

  const handleSubmitRepair = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!session || !currentItem) return;
    if (!fixerName.trim()) {
      alert("Please enter your name as the volunteer fixer.");
      return;
    }

    setSubmittingRepair(true);
    try {
      const isMains = currentItem.item.powerType === 'MAINS_240V';
      const nextStatus = await submitRepairRecord({
        sessionId: session.id,
        repairId: currentItem.id,
        fixerName: fixerName.trim(),
        outcome,
        repairTimeMinutes,
        diagnosis: diagnosis.trim(),
        repairNotes: repairNotes.trim(),
        partsUsed: partsUsed.trim(),
        weightKg: parseFloat(weightKg) || undefined,
        isMainsPower: isMains
      });

      let statusMsg = `Repair record submitted for Card #${currentItem.cardNumber}. Outcome: ${outcome}.`;
      if (nextStatus === 'WAITING_PAT2') {
        statusMsg += " Item routed to PAT Station for final post-repair safety certification.";
      } else if (nextStatus === 'READY_FOR_COLLECTION') {
        statusMsg += " Item routed to Front Desk for customer collection.";
      }

      setSuccessBanner(statusMsg);
      setCurrentItem(null);
      setSearchCardNumber('');
      setDiagnosis('');
      setRepairNotes('');
      setPartsUsed('');
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : "Error saving repair";
      alert(message);
    } finally {
      setSubmittingRepair(false);
    }
  };

  return (
    <div className="max-w-4xl mx-auto px-4 my-6">
      {/* Station PIN Gate */}
      <PinModal
        isOpen={!isUnlocked}
        stationName="Volunteer Fixer Station"
        onVerify={unlock}
        error={pinError}
      />

      {/* Station Header */}
      <div className="bg-white rounded-3xl p-6 sm:p-8 border border-slate-200 shadow-sm mb-6">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pb-6 border-b border-slate-100">
          <div className="flex items-center gap-3">
            <div className="h-12 w-12 rounded-2xl bg-blue-100 text-blue-800 flex items-center justify-center">
              <Hammer className="h-6 w-6" />
            </div>
            <div>
              <h2 className="text-xl sm:text-2xl font-black text-slate-900">
                Volunteer Fixer Station
              </h2>
              <p className="text-xs sm:text-sm text-slate-500">
                Log diagnosis, repairs, parts, duration, and outcomes
              </p>
            </div>
          </div>

          <div className="text-xs">
            <input
              type="text"
              placeholder="Your Name (e.g. Alice)"
              value={fixerName}
              onChange={(e) => setFixerName(e.target.value)}
              className="px-3.5 py-2 rounded-xl border border-slate-300 font-semibold text-slate-800 focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
          </div>
        </div>

        {/* Card Number Lookup */}
        <form onSubmit={handleSearchCard} className="mt-6 flex gap-3">
          <div className="relative flex-1">
            <Search className="h-5 w-5 absolute left-3.5 top-3.5 text-slate-400" />
            <input
              type="number"
              placeholder="Enter Physical Card Number (#1..#100)..."
              value={searchCardNumber}
              onChange={(e) => setSearchCardNumber(e.target.value)}
              className="w-full pl-11 pr-4 py-3 rounded-2xl border border-slate-300 text-base font-mono font-bold focus:outline-none focus:ring-2 focus:ring-blue-500 shadow-inner"
            />
          </div>
          <button
            type="submit"
            disabled={searching || !searchCardNumber}
            className="px-6 py-3 rounded-2xl bg-blue-600 text-white font-bold text-sm hover:bg-blue-700 active:bg-blue-800 disabled:opacity-50 transition-colors shadow-sm"
          >
            {searching ? "Finding..." : "Find Item"}
          </button>
        </form>

        {searchMessage && (
          <div className="mt-4 p-3 rounded-xl bg-blue-50 border border-blue-200 text-blue-900 text-sm font-medium">
            {searchMessage}
          </div>
        )}

        {successBanner && (
          <div className="mt-4 p-4 rounded-xl bg-emerald-50 border border-emerald-200 text-emerald-900 text-sm font-bold flex items-center gap-2">
            <CheckCircle2 className="h-5 w-5 text-emerald-600 flex-shrink-0" />
            <span>{successBanner}</span>
          </div>
        )}
      </div>

      {/* Active Repair Card Form */}
      {currentItem && (
        <div className="bg-white rounded-3xl p-6 sm:p-8 border-2 border-blue-400 shadow-md animate-fade-in space-y-6">
          {/* Card Header */}
          <div className="flex flex-wrap items-center justify-between gap-4 pb-4 border-b border-slate-200">
            <div className="flex items-center gap-3">
              <CardToken number={currentItem.cardNumber} size="lg" />
              <div>
                <h3 className="text-xl font-black text-slate-900">
                  {currentItem.item.brandModel}
                </h3>
                <p className="text-xs text-slate-500 font-mono">
                  Token: {currentItem.referenceToken} • Category: {currentItem.item.category} • Power: {currentItem.item.powerType}
                </p>
              </div>
            </div>

            <StatusBadge status={currentItem.status} size="md" />
          </div>

          {/* Safety Warning from PAT 1 if applicable */}
          <SafetyBanner 
            outcome={currentItem.patInitial?.outcome} 
            cautionNotes={currentItem.patInitial?.cautionNotes} 
          />

          <div className="bg-slate-50 p-4 rounded-2xl border border-slate-200 text-sm">
            <span className="text-xs font-bold text-slate-500 uppercase block mb-1">Customer Fault Description</span>
            <p className="text-slate-800 font-medium">{currentItem.item.faultDescription}</p>
          </div>

          {/* Fixer Form */}
          <form onSubmit={handleSubmitRepair} className="space-y-6">
            {/* Outcome Selection */}
            <div>
              <label className="block text-xs font-bold text-slate-800 uppercase tracking-wider mb-2">
                Repair Outcome <span className="text-rose-500">*</span>
              </label>

              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                <button
                  type="button"
                  onClick={() => setOutcome('FIXED')}
                  className={`p-3.5 rounded-2xl border-2 text-left transition-all ${
                    outcome === 'FIXED'
                      ? 'border-emerald-600 bg-emerald-50 text-emerald-950 shadow-sm'
                      : 'border-slate-200 hover:border-slate-300 text-slate-700'
                  }`}
                >
                  <div className="font-bold flex items-center gap-1.5 text-emerald-900 text-sm">
                    <CheckCircle2 className="h-4 w-4 text-emerald-600" />
                    Fixed / Repaired
                  </div>
                  <p className="text-xs mt-1 text-slate-600">
                    Fully operational. {currentItem.item.powerType === 'MAINS_240V' ? 'Goes to PAT 2.' : 'Ready for pickup.'}
                  </p>
                </button>

                <button
                  type="button"
                  onClick={() => setOutcome('PARTIAL')}
                  className={`p-3.5 rounded-2xl border-2 text-left transition-all ${
                    outcome === 'PARTIAL'
                      ? 'border-blue-600 bg-blue-50 text-blue-950 shadow-sm'
                      : 'border-slate-200 hover:border-slate-300 text-slate-700'
                  }`}
                >
                  <div className="font-bold flex items-center gap-1.5 text-blue-900 text-sm">
                    <Wrench className="h-4 w-4 text-blue-600" />
                    Partially Fixed
                  </div>
                  <p className="text-xs mt-1 text-slate-600">
                    Usable with minor limitation or needs user cleaning.
                  </p>
                </button>

                <button
                  type="button"
                  onClick={() => setOutcome('ADVICE_GIVEN')}
                  className={`p-3.5 rounded-2xl border-2 text-left transition-all ${
                    outcome === 'ADVICE_GIVEN'
                      ? 'border-purple-600 bg-purple-50 text-purple-950 shadow-sm'
                      : 'border-slate-200 hover:border-slate-300 text-slate-700'
                  }`}
                >
                  <div className="font-bold flex items-center gap-1.5 text-purple-900 text-sm">
                    <HelpCircle className="h-4 w-4 text-purple-600" />
                    Advice Given
                  </div>
                  <p className="text-xs mt-1 text-slate-600">
                    Recommended replacement part or specialized repair guidance.
                  </p>
                </button>

                <button
                  type="button"
                  onClick={() => setOutcome('UNFIXABLE')}
                  className={`p-3.5 rounded-2xl border-2 text-left transition-all ${
                    outcome === 'UNFIXABLE'
                      ? 'border-rose-600 bg-rose-50 text-rose-950 shadow-sm'
                      : 'border-slate-200 hover:border-slate-300 text-slate-700'
                  }`}
                >
                  <div className="font-bold flex items-center gap-1.5 text-rose-900 text-sm">
                    <XCircle className="h-4 w-4 text-rose-600" />
                    Unfixable / End of Life
                  </div>
                  <p className="text-xs mt-1 text-slate-600">
                    Sealed unit, missing critical IC, or cost/safety prohibitive.
                  </p>
                </button>

                <button
                  type="button"
                  onClick={() => setOutcome('TAKEN_HOME')}
                  className={`p-3.5 rounded-2xl border-2 text-left transition-all ${
                    outcome === 'TAKEN_HOME'
                      ? 'border-sky-600 bg-sky-50 text-sky-950 shadow-sm'
                      : 'border-slate-200 hover:border-slate-300 text-slate-700'
                  }`}
                >
                  <div className="font-bold flex items-center gap-1.5 text-sky-900 text-sm">
                    <Home className="h-4 w-4 text-sky-600" />
                    Taken Home to Finish
                  </div>
                  <p className="text-xs mt-1 text-slate-600">
                    Private agreement between volunteer & visitor. Releases cafe custody.
                  </p>
                </button>
              </div>
            </div>

            {/* Repair Duration (Minutes) & Weight */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-6 pt-4 border-t border-slate-100">
              {/* Repair Time Selector (As requested: simplified repairTime in minutes) */}
              <div>
                <label className="block text-xs font-bold text-slate-700 mb-2 flex items-center gap-1">
                  <Clock className="h-4 w-4 text-slate-500" />
                  Estimated Time Spent (Minutes)
                </label>
                <div className="flex gap-2">
                  {[15, 30, 45, 60].map((mins) => (
                    <button
                      key={mins}
                      type="button"
                      onClick={() => setRepairTimeMinutes(mins)}
                      className={`flex-1 py-2 rounded-xl text-xs font-bold border transition-all ${
                        repairTimeMinutes === mins
                          ? 'bg-blue-600 text-white border-blue-700 shadow-sm'
                          : 'bg-slate-100 text-slate-700 border-slate-200 hover:bg-slate-200'
                      }`}
                    >
                      {mins}m
                    </button>
                  ))}
                  <input
                    type="number"
                    min={5}
                    max={240}
                    value={repairTimeMinutes}
                    onChange={(e) => setRepairTimeMinutes(parseInt(e.target.value, 10) || 15)}
                    className="w-16 text-center text-xs font-bold font-mono py-2 rounded-xl border border-slate-300"
                    title="Custom minutes"
                  />
                </div>
              </div>

              {/* Item Weight for Landfill Diversion Metrics */}
              <div>
                <label className="block text-xs font-bold text-slate-700 mb-2 flex items-center gap-1">
                  <Scale className="h-4 w-4 text-slate-500" />
                  Item Weight Diverted (kg)
                </label>
                <input
                  type="number"
                  step="0.1"
                  min="0.1"
                  placeholder="e.g. 1.8"
                  value={weightKg}
                  onChange={(e) => setWeightKg(e.target.value)}
                  className="w-full px-3.5 py-2 rounded-xl border border-slate-300 text-sm font-mono font-bold"
                />
              </div>
            </div>

            {/* Diagnosis & Notes */}
            <div className="space-y-4 pt-4 border-t border-slate-100">
              <div>
                <label className="block text-xs font-bold text-slate-700 mb-1">
                  Diagnosis / What was the root cause?
                </label>
                <input
                  type="text"
                  placeholder="e.g. Blown thermal fuse; corroded contact; gummed up grease in gears."
                  value={diagnosis}
                  onChange={(e) => setDiagnosis(e.target.value)}
                  className="w-full px-3.5 py-2.5 rounded-xl border border-slate-300 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
              </div>

              <div>
                <label className="block text-xs font-bold text-slate-700 mb-1">
                  Repair Actions & Notes
                </label>
                <textarea
                  rows={2}
                  placeholder="e.g. Desoldered broken switch, lubricated drive motor, replaced internal wiring with high-temp silicone wire."
                  value={repairNotes}
                  onChange={(e) => setRepairNotes(e.target.value)}
                  className="w-full px-3.5 py-2.5 rounded-xl border border-slate-300 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
              </div>

              <div>
                <label className="block text-xs font-bold text-slate-700 mb-1">
                  Parts / Materials Used (if any)
                </label>
                <input
                  type="text"
                  placeholder="e.g. 10A microswitch, 1x heat shrink tubing, 13A UK plug top."
                  value={partsUsed}
                  onChange={(e) => setPartsUsed(e.target.value)}
                  className="w-full px-3.5 py-2.5 rounded-xl border border-slate-300 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
              </div>
            </div>

            <div className="flex justify-end gap-3 pt-4 border-t border-slate-100">
              <button
                type="button"
                onClick={() => setCurrentItem(null)}
                className="px-5 py-2.5 rounded-xl border border-slate-300 text-sm font-semibold text-slate-700 hover:bg-slate-50"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={submittingRepair}
                className="px-6 py-2.5 rounded-xl bg-blue-600 text-white text-sm font-bold hover:bg-blue-700 disabled:opacity-50 shadow-sm"
              >
                {submittingRepair ? "Submitting..." : "Submit Repair Record"}
              </button>
            </div>
          </form>
        </div>
      )}
    </div>
  );
};
