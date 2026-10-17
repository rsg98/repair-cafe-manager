import React, { useState, useEffect, useMemo } from 'react';
import { 
  Hammer, 
  Search, 
  CheckCircle2, 
  Clock, 
  Scale, 
  Wrench, 
  Home, 
  HelpCircle, 
  XCircle,
  BookOpen,
  AlertTriangle,
  X
} from 'lucide-react';
import { Session, RepairItem, RepairOutcome } from '../types';
import { useVolunteerPin } from '../hooks/useVolunteerPin';
import { useRegisterUnsavedWork } from '../context/UnsavedWorkContext';
import { getRepairByCardNumber, submitRepairRecord } from '../services/repairService';
import { CardToken } from '../components/common/CardToken';
import { StatusBadge } from '../components/common/StatusBadge';
import { SafetyBanner } from '../components/common/SafetyBanner';
import { PinModal } from '../components/common/PinModal';
import { PoliciesModal } from '../components/common/PoliciesModal';

interface FixerStationViewProps {
  session: Session | null;
}

export const FixerStationView: React.FC<FixerStationViewProps> = ({ session }) => {
  // Enforce daily 4-digit volunteer PIN gate
  const { isUnlocked, unlock, error: pinError } = useVolunteerPin(session);

  // Volunteer persistent settings stored in localStorage
  const [fixerName, setFixerName] = useState(() => localStorage.getItem('fixer_volunteer_name') || '');
  const [showPoliciesModal, setShowPoliciesModal] = useState(false);

  // Sort active session's attending volunteers alphabetically for the Fixer dropdown
  const attendingVolunteers = useMemo(
    () => [...(session?.attendingVolunteers || [])].sort((a, b) => a.name.localeCompare(b.name)),
    [session?.attendingVolunteers]
  );

  // Card search state
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

  // Prevent automatic PWA reload while a repair record, card lookup, or routing confirmation banner is active
  const isFixerDirty =
    currentItem !== null ||
    searchCardNumber.trim().length > 0 ||
    searching ||
    submittingRepair ||
    showPoliciesModal ||
    successBanner !== null;
  useRegisterUnsavedWork(isFixerDirty, 'fixer-station-view');

  // Validate cached fixerName against the active session's attending volunteer roster
  useEffect(() => {
    if (session && fixerName && !attendingVolunteers.some((v) => v.name === fixerName)) {
      setFixerName('');
    }
  }, [session, attendingVolunteers, fixerName]);

  // Persist selected fixer name to localStorage
  useEffect(() => {
    localStorage.setItem('fixer_volunteer_name', fixerName);
  }, [fixerName]);

  // Point lookup of a repair item by its physical Card Number (#1..#N)
  const handleSearchCard = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!session) return;
    const num = parseInt(searchCardNumber, 10);
    if (isNaN(num)) return;

    setSearching(true);
    setSearchMessage(null);
    setSuccessBanner(null);

    try {
      // Execute targeted query by cardNumber to stay within Free Tier read guardrails
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

  // Submit diagnosis, repair time, landfill weight, and outcome for the current item
  const handleSubmitRepair = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!session || !currentItem) return;
    if (!fixerName.trim()) {
      alert("Please select your name from the attending volunteer list.");
      return;
    }

    setSubmittingRepair(true);
    try {
      // Route Mains 240V FIXED/PARTIAL repairs to WAITING_PAT2; others to READY_FOR_COLLECTION
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

      // Build confirmation banner explaining next station routing
      let statusMsg = `Repair record submitted for Card #${currentItem.cardNumber}. Outcome: ${outcome}.`;
      if (nextStatus === 'WAITING_PAT2') {
        statusMsg += " Item routed to PAT Station for final post-repair safety certification.";
      } else if (nextStatus === 'READY_FOR_COLLECTION') {
        statusMsg += " Item routed to Front Desk for customer collection.";
      }

      // Reset form state for the next repair item
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

          {/* Attending Volunteer Dropdown & Policies Reference Button */}
          <div className="flex flex-wrap items-center gap-2 text-xs">
            {/* Attending Volunteer Selector */}
            <select
              aria-label="Select Volunteer Fixer"
              value={fixerName}
              onChange={(e) => setFixerName(e.target.value)}
              className="px-3.5 py-2 rounded-xl border border-slate-300 bg-white font-semibold text-slate-800 focus:outline-none focus:ring-2 focus:ring-blue-500"
            >
              {/* Default placeholder option reflecting checked-in volunteer count */}
              <option value="">
                {attendingVolunteers.length === 0
                  ? 'No Volunteers Checked In Yet'
                  : 'Select Your Name...'}
              </option>
              {/* Render alphabetically sorted attending volunteers */}
              {attendingVolunteers.map((v) => (
                <option key={v.id} value={v.name}>
                  {v.name}{!v.inducted ? ' (Induction Pending)' : ''}
                </option>
              ))}
            </select>
            {/* Quick-access button to view Repair Café policies */}
            <button
              type="button"
              onClick={() => setShowPoliciesModal(true)}
              className="inline-flex items-center gap-1.5 px-3 py-2 rounded-xl border border-slate-200 bg-slate-50 text-slate-700 font-bold hover:bg-slate-100 transition-colors"
              title="View Repair Café Policies"
            >
              <BookOpen className="h-3.5 w-3.5 text-blue-700" />
              Policies
            </button>
          </div>
        </div>

        {/* Warning banner when no volunteers are checked in to the active session */}
        {session && attendingVolunteers.length === 0 && (
          <div className="mt-4 p-3 rounded-xl bg-amber-50 border border-amber-200 text-amber-900 text-xs font-bold flex items-center gap-2">
            <AlertTriangle className="h-4 w-4 text-amber-600 flex-shrink-0" />
            <span>No volunteers checked in — ask Front Desk to update session attendance</span>
          </div>
        )}

        {/* Card Number Lookup */}
        <form onSubmit={handleSearchCard} className="mt-6 flex gap-3">
          <div className="relative flex-1">
            <Search className="h-5 w-5 absolute left-3.5 top-3.5 text-slate-400" />
            {/* Numeric card number input */}
            <input
              type="number"
              placeholder="Enter Physical Card Number (#1..#100)..."
              value={searchCardNumber}
              onChange={(e) => setSearchCardNumber(e.target.value)}
              className="w-full pl-11 pr-4 py-3 rounded-2xl border border-slate-300 text-base font-mono font-bold focus:outline-none focus:ring-2 focus:ring-blue-500 shadow-inner"
            />
          </div>
          {/* Submit button for card lookup */}
          <button
            type="submit"
            disabled={searching || !searchCardNumber}
            className="px-6 py-3 rounded-2xl bg-blue-600 text-white font-bold text-sm hover:bg-blue-700 active:bg-blue-800 disabled:opacity-50 transition-colors shadow-sm"
          >
            {searching ? "Finding..." : "Find Item"}
          </button>
        </form>

        {/* Display lookup warning or informational message */}
        {searchMessage && (
          <div className="mt-4 p-3 rounded-xl bg-blue-50 border border-blue-200 text-blue-900 text-sm font-medium">
            {searchMessage}
          </div>
        )}

        {/* Display repair submission confirmation banner with dismiss button */}
        {successBanner && (
          <div className="mt-4 p-4 rounded-xl bg-emerald-50 border border-emerald-200 text-emerald-900 text-sm font-bold flex items-center justify-between gap-2">
            <div className="flex items-center gap-2">
              <CheckCircle2 className="h-5 w-5 text-emerald-600 flex-shrink-0" />
              <span>{successBanner}</span>
            </div>
            {/* Dismiss button clears the routing banner and releases deferred PWA updates */}
            <button
              type="button"
              onClick={() => setSuccessBanner(null)}
              aria-label="Dismiss confirmation banner"
              className="p-1 rounded-lg text-emerald-700 hover:bg-emerald-100 transition-colors cursor-pointer"
            >
              <X className="h-4 w-4" />
            </button>
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
                {/* Item brand and model title */}
                <h3 className="text-xl font-black text-slate-900">
                  {currentItem.item.brandModel}
                </h3>
                <p className="text-xs text-slate-500 font-mono">
                  Token: {currentItem.referenceToken} • Category: {currentItem.item.category} • Power: {currentItem.item.powerType}
                </p>
              </div>
            </div>

            {/* Current item status badge */}
            <StatusBadge status={currentItem.status} size="md" />
          </div>

          {/* Safety Warning from PAT 1 if applicable */}
          <SafetyBanner 
            outcome={currentItem.patInitial?.outcome} 
            cautionNotes={currentItem.patInitial?.cautionNotes} 
          />

          {/* Customer reported fault description */}
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

              {/* Repair outcome button grid */}
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                {/* Outcome: FIXED */}
                <button
                  type="button"
                  onClick={() => setOutcome('FIXED')}
                  className={`p-3.5 rounded-2xl border-2 text-left transition-all ${
                    outcome === 'FIXED'
                      ? 'border-emerald-600 bg-emerald-50 text-emerald-950 shadow-sm'
                      : 'border-slate-200 hover:border-slate-300 text-slate-700'
                  }`}
                >
                  {/* FIXED label and routing hint */}
                  <div className="font-bold flex items-center gap-1.5 text-emerald-900 text-sm">
                    <CheckCircle2 className="h-4 w-4 text-emerald-600" />
                    Fixed / Repaired
                  </div>
                  <p className="text-xs mt-1 text-slate-600">
                    Fully operational. {currentItem.item.powerType === 'MAINS_240V' ? 'Goes to PAT 2.' : 'Ready for pickup.'}
                  </p>
                </button>

                {/* Outcome: PARTIAL */}
                <button
                  type="button"
                  onClick={() => setOutcome('PARTIAL')}
                  className={`p-3.5 rounded-2xl border-2 text-left transition-all ${
                    outcome === 'PARTIAL'
                      ? 'border-blue-600 bg-blue-50 text-blue-950 shadow-sm'
                      : 'border-slate-200 hover:border-slate-300 text-slate-700'
                  }`}
                >
                  {/* PARTIAL label and description */}
                  <div className="font-bold flex items-center gap-1.5 text-blue-900 text-sm">
                    <Wrench className="h-4 w-4 text-blue-600" />
                    Partially Fixed
                  </div>
                  <p className="text-xs mt-1 text-slate-600">
                    Usable with minor limitation or needs user cleaning.
                  </p>
                </button>

                {/* Outcome: ADVICE_GIVEN */}
                <button
                  type="button"
                  onClick={() => setOutcome('ADVICE_GIVEN')}
                  className={`p-3.5 rounded-2xl border-2 text-left transition-all ${
                    outcome === 'ADVICE_GIVEN'
                      ? 'border-purple-600 bg-purple-50 text-purple-950 shadow-sm'
                      : 'border-slate-200 hover:border-slate-300 text-slate-700'
                  }`}
                >
                  {/* ADVICE_GIVEN label and description */}
                  <div className="font-bold flex items-center gap-1.5 text-purple-900 text-sm">
                    <HelpCircle className="h-4 w-4 text-purple-600" />
                    Advice Given
                  </div>
                  <p className="text-xs mt-1 text-slate-600">
                    Recommended replacement part or specialized repair guidance.
                  </p>
                </button>

                {/* Outcome: UNFIXABLE */}
                <button
                  type="button"
                  onClick={() => setOutcome('UNFIXABLE')}
                  className={`p-3.5 rounded-2xl border-2 text-left transition-all ${
                    outcome === 'UNFIXABLE'
                      ? 'border-rose-600 bg-rose-50 text-rose-950 shadow-sm'
                      : 'border-slate-200 hover:border-slate-300 text-slate-700'
                  }`}
                >
                  {/* UNFIXABLE label and description */}
                  <div className="font-bold flex items-center gap-1.5 text-rose-900 text-sm">
                    <XCircle className="h-4 w-4 text-rose-600" />
                    Unfixable / End of Life
                  </div>
                  <p className="text-xs mt-1 text-slate-600">
                    Sealed unit, missing critical IC, or cost/safety prohibitive.
                  </p>
                </button>

                {/* Outcome: TAKEN_HOME */}
                <button
                  type="button"
                  onClick={() => setOutcome('TAKEN_HOME')}
                  className={`p-3.5 rounded-2xl border-2 text-left transition-all ${
                    outcome === 'TAKEN_HOME'
                      ? 'border-sky-600 bg-sky-50 text-sky-950 shadow-sm'
                      : 'border-slate-200 hover:border-slate-300 text-slate-700'
                  }`}
                >
                  {/* TAKEN_HOME label and custody notice */}
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
                {/* Quick duration buttons and custom minute input */}
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
                  {/* Custom duration numeric input */}
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
                {/* Weight in kg input */}
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
              {/* Root cause diagnosis field */}
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

              {/* Repair actions and notes field */}
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

              {/* Parts and materials used field */}
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

            {/* Form cancellation and submission actions */}
            <div className="flex justify-end gap-3 pt-4 border-t border-slate-100">
              <button
                type="button"
                onClick={() => setCurrentItem(null)}
                className="px-5 py-2.5 rounded-xl border border-slate-300 text-sm font-semibold text-slate-700 hover:bg-slate-50"
              >
                Cancel
              </button>
              {/* Submit repair record button */}
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

      {/* Repair Café Policies Reference Modal */}
      <PoliciesModal
        isOpen={showPoliciesModal}
        onClose={() => setShowPoliciesModal(false)}
      />
    </div>
  );
};
