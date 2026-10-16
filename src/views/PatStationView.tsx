import React, { useState, useEffect, useMemo } from 'react';
import { 
  Zap, 
  Search, 
  CheckCircle2, 
  AlertTriangle, 
  ShieldAlert, 
  Sliders,
  Check,
  ShieldCheck,
  BookOpen
} from 'lucide-react';
import { Session, RepairItem, ApplianceClass, PatInitialOutcome, PatFinalOutcome } from '../types';
import { useVolunteerPin } from '../hooks/useVolunteerPin';
import { getRepairByCardNumber, submitPatInitial, submitPatFinal } from '../services/repairService';
import { getQualifiedPatTesters } from '../services/volunteerService';
import { CardToken } from '../components/common/CardToken';
import { StatusBadge } from '../components/common/StatusBadge';
import { PinModal } from '../components/common/PinModal';
import { PoliciesModal } from '../components/common/PoliciesModal';

interface PatStationViewProps {
  session: Session | null;
}

export const PatStationView: React.FC<PatStationViewProps> = ({ session }) => {
  // Enforce daily 4-digit volunteer PIN gate
  const { isUnlocked, unlock, error: pinError } = useVolunteerPin(session);

  // Volunteer persistent settings stored in localStorage
  const [testerName, setTesterName] = useState(() => localStorage.getItem('pat_tester_name') || '');
  const [instrumentSerial, setInstrumentSerial] = useState(() => localStorage.getItem('pat_instrument_serial') || '');
  const [showPoliciesModal, setShowPoliciesModal] = useState(false);

  // Filter session's attending volunteers to only those qualified for PAT testing
  const qualifiedTesters = useMemo(
    () => getQualifiedPatTesters(session?.attendingVolunteers || []),
    [session?.attendingVolunteers]
  );

  // Card search state
  const [searchCardNumber, setSearchCardNumber] = useState('');
  const [searching, setSearching] = useState(false);
  const [currentItem, setCurrentItem] = useState<RepairItem | null>(null);
  const [searchMessage, setSearchMessage] = useState<string | null>(null);

  // PAT electrical inspection form fields
  const [visualPass, setVisualPass] = useState(true);
  const [applianceClass, setApplianceClass] = useState<ApplianceClass>('CLASS_I');
  const [fuseRatingAmps, setFuseRatingAmps] = useState<3 | 5 | 13 | 'OTHER'>(13);
  const [testVoltageVolts, setTestVoltageVolts] = useState<250 | 500>(500);
  const [earthContinuityOhms, setEarthContinuityOhms] = useState<string>('0.05');
  const [insulationResistanceMOhms, setInsulationResistanceMOhms] = useState<string>('20.0');
  const [initialOutcome, setInitialOutcome] = useState<PatInitialOutcome>('PASS');
  const [finalOutcome, setFinalOutcome] = useState<PatFinalOutcome>('PASS');
  const [cautionNotes, setCautionNotes] = useState('');
  const [submittingTest, setSubmittingTest] = useState(false);
  const [successBanner, setSuccessBanner] = useState<string | null>(null);

  // Validate cached testerName against the active session's PAT-qualified roster
  useEffect(() => {
    if (session && testerName && !qualifiedTesters.some((v) => v.name === testerName)) {
      setTesterName('');
    }
  }, [session, qualifiedTesters, testerName]);

  // Save tester name selection to localStorage
  useEffect(() => {
    localStorage.setItem('pat_tester_name', testerName);
  }, [testerName]);

  // Save PAT instrument serial number to localStorage
  useEffect(() => {
    localStorage.setItem('pat_instrument_serial', instrumentSerial);
  }, [instrumentSerial]);

  // Look up a repair item by its physical card number (#1..#N)
  const handleSearchCard = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!session) return;
    const num = parseInt(searchCardNumber, 10);
    if (isNaN(num)) return;

    setSearching(true);
    setSearchMessage(null);
    setSuccessBanner(null);

    try {
      // Point query by cardNumber to stay within Firebase Free Tier guardrails
      const item = await getRepairByCardNumber(session.id, num);
      if (!item) {
        setSearchMessage(`No item found assigned to Card #${num}.`);
        setCurrentItem(null);
      } else {
        setCurrentItem(item);
        if (item.item.applianceClass && item.item.applianceClass !== 'NOT_APPLICABLE') {
          setApplianceClass(item.item.applianceClass);
        }
      }
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : "Error searching item";
      setSearchMessage(message);
    } finally {
      setSearching(false);
    }
  };

  // Submit Pre-Repair (PAT 1) electrical safety screening results
  const handleSubmitPatInitial = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!session || !currentItem) return;
    if (!testerName.trim() || !instrumentSerial.trim()) {
      alert("Please select your PAT tester name and enter the PAT instrument serial number.");
      return;
    }

    setSubmittingTest(true);
    try {
      // Record PAT 1 measurements and transition item to next lifecycle state
      const nextStatus = await submitPatInitial({
        sessionId: session.id,
        repairId: currentItem.id,
        testerName: testerName.trim(),
        instrumentSerial: instrumentSerial.trim(),
        visualPass,
        fuseRatingAmps,
        testVoltageVolts,
        earthContinuityOhms: applianceClass === 'CLASS_I' && !isNaN(parseFloat(earthContinuityOhms)) ? parseFloat(earthContinuityOhms) : undefined,
        insulationResistanceMOhms: parseFloat(insulationResistanceMOhms) || 0,
        outcome: initialOutcome,
        cautionNotes: cautionNotes.trim() || undefined
      });

      setSuccessBanner(`Initial PAT test recorded for Card #${currentItem.cardNumber}. Item moved to ${nextStatus}.`);
      setCurrentItem(null);
      setSearchCardNumber('');
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : "Error saving PAT record";
      alert(message);
    } finally {
      setSubmittingTest(false);
    }
  };

  // Submit Post-Repair (PAT 2) electrical safety certification results
  const handleSubmitPatFinal = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!session || !currentItem) return;
    if (!testerName.trim() || !instrumentSerial.trim()) {
      alert("Please select your PAT tester name and enter the PAT instrument serial number.");
      return;
    }

    setSubmittingTest(true);
    try {
      // Record PAT 2 measurements and route to READY_FOR_COLLECTION or back to WAITING_REPAIR
      const nextStatus = await submitPatFinal({
        sessionId: session.id,
        repairId: currentItem.id,
        testerName: testerName.trim(),
        instrumentSerial: instrumentSerial.trim(),
        visualPass,
        fuseRatingAmps,
        earthContinuityOhms: applianceClass === 'CLASS_I' && !isNaN(parseFloat(earthContinuityOhms)) ? parseFloat(earthContinuityOhms) : undefined,
        insulationResistanceMOhms: parseFloat(insulationResistanceMOhms) || 0,
        outcome: finalOutcome,
        certificateNotes: cautionNotes.trim() || undefined
      });

      setSuccessBanner(`Final PAT certification recorded for Card #${currentItem.cardNumber}. Item moved to ${nextStatus}.`);
      setCurrentItem(null);
      setSearchCardNumber('');
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : "Error certifying PAT test";
      alert(message);
    } finally {
      setSubmittingTest(false);
    }
  };

  // Determine whether the loaded item is in the post-repair PAT 2 stage
  const isPat2 = currentItem?.status === 'WAITING_PAT2' || currentItem?.status === 'IN_PAT2';

  return (
    <div className="max-w-4xl mx-auto px-4 my-6">
      {/* Station PIN Gate */}
      <PinModal
        isOpen={!isUnlocked}
        stationName="PAT Safety Testing Station"
        onVerify={unlock}
        error={pinError}
      />

      {/* Station Header */}
      <div className="bg-white rounded-3xl p-6 sm:p-8 border border-slate-200 shadow-sm mb-6">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pb-6 border-b border-slate-100">
          <div className="flex items-center gap-3">
            <div className="h-12 w-12 rounded-2xl bg-amber-100 text-amber-800 flex items-center justify-center">
              <Zap className="h-6 w-6" />
            </div>
            <div>
              <h2 className="text-xl sm:text-2xl font-black text-slate-900">
                PAT Electrical Safety Station
              </h2>
              <p className="text-xs sm:text-sm text-slate-500">
                Pre-repair safety screening (PAT 1) and post-repair certification (PAT 2)
              </p>
            </div>
          </div>

          {/* Qualified PAT Tester Dropdown, Instrument Serial, & Policies Button */}
          <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-2 text-xs">
            {/* Qualified PAT Tester Selector */}
            <select
              aria-label="Select PAT Tester"
              value={testerName}
              onChange={(e) => setTesterName(e.target.value)}
              className="px-3 py-2 rounded-xl border border-slate-300 bg-white font-semibold text-slate-800 focus:outline-none focus:ring-2 focus:ring-amber-500"
            >
              {/* Default placeholder option reflecting PAT qualification availability */}
              <option value="">
                {qualifiedTesters.length === 0
                  ? 'No PAT-Trained Volunteers Checked In'
                  : 'Select PAT Tester...'}
              </option>
              {/* Render only PAT-trained attending volunteers */}
              {qualifiedTesters.map((v) => (
                <option key={v.id} value={v.name}>
                  {v.name}{!v.inducted ? ' (Induction Pending)' : ''}
                </option>
              ))}
            </select>
            {/* Instrument serial number input */}
            <input
              type="text"
              placeholder="PAT Instrument S/N"
              value={instrumentSerial}
              onChange={(e) => setInstrumentSerial(e.target.value)}
              className="px-3 py-2 rounded-xl border border-slate-300 font-mono text-slate-600 focus:outline-none focus:ring-2 focus:ring-amber-500"
            />
            {/* Quick-access button to view Repair Café policies */}
            <button
              type="button"
              onClick={() => setShowPoliciesModal(true)}
              className="inline-flex items-center justify-center gap-1.5 px-3 py-2 rounded-xl border border-slate-200 bg-slate-50 text-slate-700 font-bold hover:bg-slate-100 transition-colors"
              title="View Repair Café Policies"
            >
              <BookOpen className="h-3.5 w-3.5 text-amber-700" />
              Policies
            </button>
          </div>
        </div>

        {/* Warning banner when no PAT-trained volunteers are checked in to the active session */}
        {session && qualifiedTesters.length === 0 && (
          <div className="mt-4 p-3 rounded-xl bg-amber-50 border border-amber-200 text-amber-900 text-xs font-bold flex items-center gap-2">
            <AlertTriangle className="h-4 w-4 text-amber-600 flex-shrink-0" />
            <span>No PAT-trained volunteers checked in — ask Front Desk to update session attendance</span>
          </div>
        )}

        {/* Card Number Point-Lookup Form */}
        <form onSubmit={handleSearchCard} className="mt-6 flex gap-3">
          <div className="relative flex-1">
            <Search className="h-5 w-5 absolute left-3.5 top-3.5 text-slate-400" />
            {/* Numeric card number input */}
            <input
              type="number"
              placeholder="Enter Physical Card Number (#1..#100)..."
              value={searchCardNumber}
              onChange={(e) => setSearchCardNumber(e.target.value)}
              className="w-full pl-11 pr-4 py-3 rounded-2xl border border-slate-300 text-base font-mono font-bold focus:outline-none focus:ring-2 focus:ring-amber-500 shadow-inner"
            />
          </div>
          {/* Submit button for card lookup */}
          <button
            type="submit"
            disabled={searching || !searchCardNumber}
            className="px-6 py-3 rounded-2xl bg-amber-600 text-white font-bold text-sm hover:bg-amber-700 active:bg-amber-800 disabled:opacity-50 transition-colors shadow-sm"
          >
            {searching ? "Finding..." : "Find Item"}
          </button>
        </form>

        {/* Display lookup warning or informational message */}
        {searchMessage && (
          <div className="mt-4 p-3 rounded-xl bg-amber-50 border border-amber-200 text-amber-900 text-sm font-medium">
            {searchMessage}
          </div>
        )}

        {/* Display PAT record submission confirmation banner */}
        {successBanner && (
          <div className="mt-4 p-4 rounded-xl bg-emerald-50 border border-emerald-200 text-emerald-900 text-sm font-bold flex items-center gap-2">
            <CheckCircle2 className="h-5 w-5 text-emerald-600 flex-shrink-0" />
            <span>{successBanner}</span>
          </div>
        )}
      </div>

      {/* Item Active Inspection & Test Form */}
      {currentItem && (
        <div className="bg-white rounded-3xl p-6 sm:p-8 border-2 border-amber-300 shadow-md animate-fade-in space-y-6">
          {/* Card Summary Header */}
          <div className="flex flex-wrap items-center justify-between gap-4 pb-4 border-b border-slate-200">
            <div className="flex items-center gap-3">
              <CardToken number={currentItem.cardNumber} size="lg" />
              <div>
                {/* Item brand and model title */}
                <h3 className="text-xl font-black text-slate-900">
                  {currentItem.item.brandModel}
                </h3>
                <p className="text-xs text-slate-500 font-mono">
                  Token: {currentItem.referenceToken} • Power: {currentItem.item.powerType}
                </p>
              </div>
            </div>

            {/* Current lifecycle status and PAT stage indicator */}
            <div className="flex items-center gap-2">
              <StatusBadge status={currentItem.status} size="md" />
              <span className="text-xs font-bold uppercase tracking-wide bg-amber-100 text-amber-900 px-3 py-1 rounded-lg border border-amber-300">
                {isPat2 ? "PAT 2 (Post-Repair)" : "PAT 1 (Pre-Repair)"}
              </span>
            </div>
          </div>

          {/* Reported customer fault description */}
          <div className="bg-slate-50 p-4 rounded-2xl border border-slate-200 text-sm">
            <span className="text-xs font-bold text-slate-500 uppercase block mb-1">Reported Fault</span>
            <p className="text-slate-800 font-medium">{currentItem.item.faultDescription}</p>
          </div>

          {/* Test Parameters */}
          <form onSubmit={isPat2 ? handleSubmitPatFinal : handleSubmitPatInitial} className="space-y-6">
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
              {/* Appliance insulation class selector */}
              <div>
                <label className="block text-xs font-bold text-slate-700 mb-1">
                  Appliance Class
                </label>
                <select
                  value={applianceClass}
                  onChange={(e) => setApplianceClass(e.target.value as ApplianceClass)}
                  className="w-full px-3.5 py-2.5 rounded-xl border border-slate-300 bg-white text-sm font-semibold"
                >
                  {/* Standard BS 1363 / IET appliance classes */}
                  <option value="CLASS_I">Class I (Earthed Metal chassis)</option>
                  <option value="CLASS_II">Class II (Double Insulated ⧈)</option>
                  <option value="LEADS_ADAPTER">Detachable Lead / Power Adapter</option>
                  <option value="CLASS_III">Class III (SELV / Low Voltage)</option>
                </select>
              </div>

              {/* BS 1363 Plug Fuse Rating selector */}
              <div>
                <label className="block text-xs font-bold text-slate-700 mb-1">
                  BS 1363 Plug Fuse Rating
                </label>
                <select
                  value={fuseRatingAmps}
                  onChange={(e) => {
                    const val = e.target.value;
                    setFuseRatingAmps(val === 'OTHER' ? 'OTHER' : (parseInt(val, 10) as 3 | 5 | 13));
                  }}
                  className="w-full px-3.5 py-2.5 rounded-xl border border-slate-300 bg-white text-sm font-semibold"
                >
                  {/* UK standard plug fuse ratings */}
                  <option value="3">3 Amp (Table lamps, radios, clocks)</option>
                  <option value="5">5 Amp (Small electronics)</option>
                  <option value="13">13 Amp (Kettles, toasters, irons)</option>
                  <option value="OTHER">Other / Unknown</option>
                </select>
              </div>

              {/* DC Test Voltage selector */}
              <div>
                <label className="block text-xs font-bold text-slate-700 mb-1">
                  DC Test Voltage
                </label>
                <select
                  value={testVoltageVolts}
                  onChange={(e) => setTestVoltageVolts(parseInt(e.target.value, 10) as 250 | 500)}
                  className="w-full px-3.5 py-2.5 rounded-xl border border-slate-300 bg-white text-sm font-semibold"
                >
                  {/* 500V standard vs 250V Surge-protected / SMPS */}
                  <option value="500">500V DC (Standard Appliances)</option>
                  <option value="250">250V DC (Sensitive Electronics / SMPS)</option>
                </select>
              </div>
            </div>

            {/* Test Measurements */}
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 pt-4 border-t border-slate-100">
              {/* Visual inspection pass/fail toggle */}
              <div>
                <label className="block text-xs font-bold text-slate-700 mb-1">
                  Visual Inspection Check
                </label>
                <button
                  type="button"
                  onClick={() => setVisualPass(!visualPass)}
                  className={`w-full py-2.5 px-3 rounded-xl border font-bold text-sm flex items-center justify-center gap-2 ${
                    visualPass 
                      ? 'bg-emerald-100 text-emerald-900 border-emerald-300' 
                      : 'bg-rose-100 text-rose-900 border-rose-300'
                  }`}
                >
                  {/* Render check icon when visual inspection passes */}
                  {visualPass ? <Check className="h-4 w-4" /> : null}
                  {visualPass ? 'Visual Passed' : 'Visual Failed'}
                </button>
              </div>

              {/* Earth Continuity measurement input (required for Class I) */}
              {applianceClass === 'CLASS_I' && (
                <div>
                  <label className="block text-xs font-bold text-slate-700 mb-1">
                    Earth Continuity (Ω)
                  </label>
                  <input
                    type="number"
                    step="0.01"
                    placeholder="≤ 0.10 Ω"
                    value={earthContinuityOhms}
                    onChange={(e) => setEarthContinuityOhms(e.target.value)}
                    className="w-full px-3.5 py-2 rounded-xl border border-slate-300 font-mono font-bold text-sm"
                  />
                  {/* Threshold guidance for Class I earth bond */}
                  <span className="text-[10px] text-slate-500">Threshold: ≤ 0.10 Ω + lead</span>
                </div>
              )}

              {/* Insulation Resistance measurement input */}
              <div>
                <label className="block text-xs font-bold text-slate-700 mb-1">
                  Insulation Resistance (MΩ)
                </label>
                <input
                  type="number"
                  step="0.1"
                  placeholder="≥ 2.0 MΩ"
                  value={insulationResistanceMOhms}
                  onChange={(e) => setInsulationResistanceMOhms(e.target.value)}
                  className="w-full px-3.5 py-2 rounded-xl border border-slate-300 font-mono font-bold text-sm"
                />
                {/* Threshold guidance for Class I and Class II insulation */}
                <span className="text-[10px] text-slate-500">Threshold: ≥ 1.0 MΩ (Class I) / ≥ 2.0 MΩ (Class II)</span>
              </div>
            </div>

            {/* Outcome Selection */}
            <div className="pt-4 border-t border-slate-100">
              <label className="block text-xs font-bold text-slate-800 uppercase tracking-wider mb-2">
                {isPat2 ? "Final Safety Certification Outcome" : "Initial Screening Outcome"}
              </label>

              {/* PAT 1 vs PAT 2 outcome buttons */}
              {!isPat2 ? (
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  {/* Outcome: PASS */}
                  <button
                    type="button"
                    onClick={() => setInitialOutcome('PASS')}
                    className={`p-4 rounded-2xl border-2 text-left transition-all ${
                      initialOutcome === 'PASS'
                        ? 'border-emerald-600 bg-emerald-50 text-emerald-950 shadow-sm'
                        : 'border-slate-200 hover:border-slate-300 text-slate-700'
                    }`}
                  >
                    {/* PASS header and description */}
                    <div className="font-bold flex items-center gap-1.5">
                      <CheckCircle2 className="h-5 w-5 text-emerald-600" />
                      PASS: Safe for Inspection
                    </div>
                    <p className="text-xs mt-1 text-slate-600">
                      Visual, earth, and insulation tests pass. Safe to route to volunteer repairers.
                    </p>
                  </button>

                  {/* Outcome: FAIL_REPAIRABLE_CORD */}
                  <button
                    type="button"
                    onClick={() => setInitialOutcome('FAIL_REPAIRABLE_CORD')}
                    className={`p-4 rounded-2xl border-2 text-left transition-all ${
                      initialOutcome === 'FAIL_REPAIRABLE_CORD'
                        ? 'border-amber-500 bg-amber-50 text-amber-950 shadow-sm'
                        : 'border-slate-200 hover:border-slate-300 text-slate-700'
                    }`}
                  >
                    {/* FAIL_REPAIRABLE_CORD header and description */}
                    <div className="font-bold flex items-center gap-1.5 text-amber-900">
                      <AlertTriangle className="h-5 w-5 text-amber-600" />
                      FAIL: Repairable Cord / Plug Defect
                    </div>
                    <p className="text-xs mt-1 text-slate-600">
                      Cord or plug defect only. Fixers may repair power lead, but MUST re-test post repair.
                    </p>
                  </button>

                  {/* Outcome: DANGER_DO_NOT_ENERGIZE */}
                  <button
                    type="button"
                    onClick={() => setInitialOutcome('DANGER_DO_NOT_ENERGIZE')}
                    className={`p-4 rounded-2xl border-2 text-left transition-all ${
                      initialOutcome === 'DANGER_DO_NOT_ENERGIZE'
                        ? 'border-rose-600 bg-rose-50 text-rose-950 shadow-sm'
                        : 'border-slate-200 hover:border-slate-300 text-slate-700'
                    }`}
                  >
                    {/* DANGER_DO_NOT_ENERGIZE header and description */}
                    <div className="font-bold flex items-center gap-1.5 text-rose-900">
                      <ShieldAlert className="h-5 w-5 text-rose-600" />
                      DANGER: Fatal / Catastrophic Hazard
                    </div>
                    <p className="text-xs mt-1 text-slate-600">
                      Lethal shock/fire hazard. Immediately quarantined and marked Unfixable.
                    </p>
                  </button>

                  {/* Outcome: UNTESTABLE */}
                  <button
                    type="button"
                    onClick={() => setInitialOutcome('UNTESTABLE')}
                    className={`p-4 rounded-2xl border-2 text-left transition-all ${
                      initialOutcome === 'UNTESTABLE'
                        ? 'border-slate-500 bg-slate-100 text-slate-900 shadow-sm'
                        : 'border-slate-200 hover:border-slate-300 text-slate-700'
                    }`}
                  >
                    {/* UNTESTABLE header and description */}
                    <div className="font-bold flex items-center gap-1.5 text-slate-800">
                      <Sliders className="h-5 w-5 text-slate-500" />
                      UNTESTABLE: Custom / Missing Power Cord
                    </div>
                    <p className="text-xs mt-1 text-slate-600">
                      Cannot be safely powered up at PAT station. Flagged for inspection only.
                    </p>
                  </button>
                </div>
              ) : (
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  {/* PAT 2 Outcome: PASS */}
                  <button
                    type="button"
                    onClick={() => setFinalOutcome('PASS')}
                    className={`p-4 rounded-2xl border-2 text-left transition-all ${
                      finalOutcome === 'PASS'
                        ? 'border-emerald-600 bg-emerald-50 text-emerald-950 shadow-sm'
                        : 'border-slate-200 hover:border-slate-300 text-slate-700'
                    }`}
                  >
                    {/* PAT 2 PASS header and description */}
                    <div className="font-bold flex items-center gap-1.5 text-emerald-900">
                      <ShieldCheck className="h-5 w-5 text-emerald-600" />
                      PASS: Certified Safe for Collection
                    </div>
                    <p className="text-xs mt-1 text-slate-600">
                      Appliance passes all safety requirements. Ready for customer pickup.
                    </p>
                  </button>

                  {/* PAT 2 Outcome: FAIL */}
                  <button
                    type="button"
                    onClick={() => setFinalOutcome('FAIL')}
                    className={`p-4 rounded-2xl border-2 text-left transition-all ${
                      finalOutcome === 'FAIL'
                        ? 'border-rose-600 bg-rose-50 text-rose-950 shadow-sm'
                        : 'border-slate-200 hover:border-slate-300 text-slate-700'
                    }`}
                  >
                    {/* PAT 2 FAIL header and description */}
                    <div className="font-bold flex items-center gap-1.5 text-rose-900">
                      <AlertTriangle className="h-5 w-5 text-rose-600" />
                      FAIL: Post-Repair Safety Failure
                    </div>
                    <p className="text-xs mt-1 text-slate-600">
                      Appliance fails test after repair. Returned to repairer for remediation.
                    </p>
                  </button>
                </div>
              )}
            </div>

            {/* PAT Notes & Certificate Remarks input */}
            <div>
              <label className="block text-xs font-bold text-slate-700 mb-1">
                PAT Notes & Certificate Remarks
              </label>
              <textarea
                rows={2}
                placeholder="e.g. Earth bond tested on toaster chassis screw; insulation resistance >20MΩ; fitted new 13A BS1362 fuse."
                value={cautionNotes}
                onChange={(e) => setCautionNotes(e.target.value)}
                className="w-full px-3.5 py-2.5 rounded-xl border border-slate-300 text-sm focus:outline-none focus:ring-2 focus:ring-amber-500"
              />
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
              {/* Submit PAT 1 or PAT 2 safety record */}
              <button
                type="submit"
                disabled={submittingTest}
                className="px-6 py-2.5 rounded-xl bg-amber-600 text-white text-sm font-bold hover:bg-amber-700 disabled:opacity-50 shadow-sm"
              >
                {submittingTest ? "Recording Safety Test..." : "Submit PAT Record"}
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
