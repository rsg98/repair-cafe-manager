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
  BookOpen,
  X,
  Pencil,
  ArrowRight
} from 'lucide-react';
import {
  Session,
  RepairItem,
  PowerType,
  ApplianceClass,
  PatInitialOutcome,
  PatFinalOutcome,
  PatInstrument
} from '../types';
import { cafeConfig } from '../config/cafe.config';
import { useVolunteerPin } from '../hooks/useVolunteerPin';
import { useRegisterUnsavedWork } from '../context/UnsavedWorkContext';
import {
  getRepairByCardNumber,
  submitPatInitial,
  submitPatFinal,
  overrideItemPowerTypeFromPat,
  isPat2StageForItem,
  POWER_TYPE_OPTIONS,
  getPowerTypeLabel,
  REPAIR_ITEM_LOOKUP_INPUT_PROPS
} from '../services/repairService';
import {
  listPatInstruments,
  isPatInstrumentCalibrationOverdue,
  formatPatInstrumentOptionLabel
} from '../services/patInstrumentService';
import { getQualifiedPatTesters } from '../services/volunteerService';
import { CardToken } from '../components/common/CardToken';
import { StatusBadge } from '../components/common/StatusBadge';
import { PinModal } from '../components/common/PinModal';
import { PoliciesModal } from '../components/common/PoliciesModal';
import { PatInstrumentModal } from '../components/pat/PatInstrumentModal';

// Sentinel dropdown option value that triggers the Add New PAT Instrument modal
const ADD_NEW_INSTRUMENT_OPTION = '__ADD_NEW__';

interface PatStationViewProps {
  session: Session | null;
}

/**
 * Station 3: PAT Electrical Safety Station (`/pat`).
 * Supports pre-repair electrical safety screening (PAT 1), post-repair certification (PAT 2),
 * bidirectional Power Type overrides (Issue #23), and PAT testing instrument management
 * with 12-month calibration warnings and immutable serial number traceability (Issue #27).
 */
export const PatStationView: React.FC<PatStationViewProps> = ({ session }) => {
  // Enforce daily 4-digit volunteer PIN gate
  const { isUnlocked, unlock, error: pinError } = useVolunteerPin(session);

  // Volunteer persistent settings stored in localStorage (testerName & constant instrument serialNumber)
  const [testerName, setTesterName] = useState(() => localStorage.getItem('pat_tester_name') || '');
  const [instrumentSerial, setInstrumentSerial] = useState(() => localStorage.getItem('pat_instrument_serial') || '');
  const [showPoliciesModal, setShowPoliciesModal] = useState(false);

  // Registered PAT testing instruments loaded once per unlocked station session (Issue #27)
  const [instruments, setInstruments] = useState<PatInstrument[]>([]);
  const [loadingInstruments, setLoadingInstruments] = useState(false);
  const [instrumentModalState, setInstrumentModalState] = useState<{
    isOpen: boolean;
    mode: 'add' | 'edit';
  }>({ isOpen: false, mode: 'add' });

  // Filter session's attending volunteers to only those qualified for PAT testing
  const qualifiedTesters = useMemo(
    () => getQualifiedPatTesters(session?.attendingVolunteers || []),
    [session?.attendingVolunteers]
  );

  // Resolve the currently selected PAT instrument record by its immutable serial number
  const selectedInstrument = useMemo(
    () => instruments.find((inst) => inst.serialNumber === instrumentSerial) || null,
    [instruments, instrumentSerial]
  );

  // Determine whether the selected PAT instrument is past its configured calibration interval
  const serviceIntervalMonths = cafeConfig.patTesterServiceIntervalMonths;
  const isSelectedInstrumentOverdue = useMemo(
    () =>
      selectedInstrument
        ? isPatInstrumentCalibrationOverdue(
            selectedInstrument.lastCalibratedDate,
            serviceIntervalMonths
          )
        : false,
    [selectedInstrument, serviceIntervalMonths]
  );

  // Card search state
  const [searchCardNumber, setSearchCardNumber] = useState('');
  const [searching, setSearching] = useState(false);
  const [currentItem, setCurrentItem] = useState<RepairItem | null>(null);
  const [searchMessage, setSearchMessage] = useState<string | null>(null);

  // Selected Power Type on the active repair card (supports bidirectional override — Issue #23)
  const [selectedPowerType, setSelectedPowerType] = useState<PowerType>('MAINS_240V');

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

  // Prevent automatic PWA reload while a PAT inspection, card lookup, instrument modal, or banner is active
  const isPatDirty =
    currentItem !== null ||
    searchCardNumber.trim().length > 0 ||
    searching ||
    submittingTest ||
    showPoliciesModal ||
    instrumentModalState.isOpen ||
    successBanner !== null;
  useRegisterUnsavedWork(isPatDirty, 'pat-station-view');

  // Fetch registered PAT instruments once when the station is unlocked via the volunteer PIN
  useEffect(() => {
    if (!isUnlocked) return;
    let cancelled = false;
    setLoadingInstruments(true);

    // One-time getDocs query backed by IndexedDB persistentLocalCache ($0.00 Free Tier safe)
    listPatInstruments()
      .then((loaded) => {
        if (!cancelled) {
          setInstruments(loaded);
        }
      })
      .catch((err) => {
        console.error('Failed to load PAT instruments:', err);
      })
      .finally(() => {
        if (!cancelled) {
          setLoadingInstruments(false);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [isUnlocked]);

  // Offline-safe validation of cached instrumentSerial against loaded PAT instruments
  useEffect(() => {
    if (
      !loadingInstruments &&
      instruments.length > 0 &&
      instrumentSerial &&
      !instruments.some((inst) => inst.serialNumber === instrumentSerial)
    ) {
      setInstrumentSerial('');
    }
  }, [loadingInstruments, instruments, instrumentSerial]);

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

  // Handle PAT instrument dropdown selection or "+ Add New PAT Instrument..." trigger
  const handleInstrumentSelectChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
    const val = e.target.value;
    if (val === ADD_NEW_INSTRUMENT_OPTION) {
      // Open modal in Add mode without overwriting the currently selected instrument serial
      setInstrumentModalState({ isOpen: true, mode: 'add' });
      return;
    }
    setInstrumentSerial(val);
  };

  // Update local PAT instrument registry state when a volunteer adds or edits an instrument
  const handleInstrumentSaved = (saved: PatInstrument) => {
    setInstruments((prev) => {
      // Replace existing record on edit or append on add, then sort alphabetically by displayName
      const filtered = prev.filter((item) => item.id !== saved.id);
      return [...filtered, saved].sort((a, b) => a.displayName.localeCompare(b.displayName));
    });
    // Select the newly saved instrument by its constant serialNumber
    setInstrumentSerial(saved.serialNumber);
    setInstrumentModalState({ isOpen: false, mode: 'add' });
  };

  // Update local PAT instrument registry state when an instrument is removed
  const handleInstrumentDeleted = (deletedId: string) => {
    setInstruments((prev) => {
      const remaining = prev.filter((item) => item.id !== deletedId);
      // Auto-select the sole remaining instrument or clear selection
      setInstrumentSerial(remaining.length === 1 ? remaining[0].serialNumber : '');
      return remaining;
    });
    setInstrumentModalState({ isOpen: false, mode: 'add' });
  };

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
        setSelectedPowerType(item.item.powerType);

        // Hydrate appliance class (defaulting to CLASS_I when unset or NOT_APPLICABLE)
        const nextApplianceClass =
          item.item.applianceClass && item.item.applianceClass !== 'NOT_APPLICABLE'
            ? item.item.applianceClass
            : 'CLASS_I';
        setApplianceClass(nextApplianceClass);

        // Hydrate PAT measurements from PAT 2 or PAT 1 while avoiding cross-card state bleed
        const itemIsPat2 = isPat2StageForItem(item);
        setVisualPass((itemIsPat2 ? item.patFinal?.visualPass : item.patInitial?.visualPass) ?? true);
        setFuseRatingAmps(item.patFinal?.fuseRatingAmps ?? item.patInitial?.fuseRatingAmps ?? 13);
        setTestVoltageVolts(item.patFinal?.testVoltageVolts ?? item.patInitial?.testVoltageVolts ?? 500);
        // Hydrate Earth Continuity and Insulation Resistance strings for controlled numeric inputs
        setEarthContinuityOhms(
          itemIsPat2
            ? String(item.patFinal?.earthContinuityOhms ?? item.patInitial?.earthContinuityOhms ?? '0.05')
            : String(item.patInitial?.earthContinuityOhms ?? '0.05')
        );
        setInsulationResistanceMOhms(
          itemIsPat2
            ? String(item.patFinal?.insulationResistanceMOhms ?? item.patInitial?.insulationResistanceMOhms ?? '20.0')
            : String(item.patInitial?.insulationResistanceMOhms ?? '20.0')
        );
        // Hydrate PAT outcome and stage-appropriate caution/certificate notes
        setInitialOutcome(item.patInitial?.outcome ?? 'PASS');
        setFinalOutcome(item.patFinal?.outcome ?? 'PASS');
        setCautionNotes(
          (itemIsPat2 ? item.patFinal?.certificateNotes : item.patInitial?.cautionNotes) ?? ''
        );
      }
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Error searching item';
      setSearchMessage(message);
    } finally {
      setSearching(false);
    }
  };

  // Override an item's Power Type to a non-mains category and reroute without PAT electrical measurements (Issue #23)
  const handleOverrideNonMainsPowerType = async () => {
    if (!session || !currentItem || selectedPowerType === 'MAINS_240V') return;

    setSubmittingTest(true);
    try {
      // Determine whether this override occurs at PAT 1 or PAT 2
      const itemIsPat2 = isPat2StageForItem(currentItem);
      const nextStatus = await overrideItemPowerTypeFromPat({
        sessionId: session.id,
        repairId: currentItem.id,
        newPowerType: selectedPowerType,
        isPat2Stage: itemIsPat2
      });

      // Show routing confirmation with human-readable power type label
      const powerLabel = getPowerTypeLabel(selectedPowerType);
      setSuccessBanner(
        `Power type updated to ${powerLabel} for Card #${currentItem.cardNumber}. No PAT test required — item moved to ${nextStatus}.`
      );
      setCurrentItem(null);
      setSearchCardNumber('');
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Error updating item power type';
      alert(message);
    } finally {
      setSubmittingTest(false);
    }
  };

  // Submit Pre-Repair (PAT 1) electrical safety screening results
  const handleSubmitPatInitial = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!session || !currentItem) return;
    if (!testerName.trim() || !instrumentSerial.trim()) {
      alert('Please select your PAT tester name and PAT testing instrument.');
      return;
    }

    setSubmittingTest(true);
    try {
      // Record PAT 1 measurements, powerType, applianceClass, and transition item to next lifecycle state
      const nextStatus = await submitPatInitial({
        sessionId: session.id,
        repairId: currentItem.id,
        testerName: testerName.trim(),
        instrumentSerial: instrumentSerial.trim(),
        visualPass,
        fuseRatingAmps,
        testVoltageVolts,
        // Include earthContinuityOhms only for Class I earthed appliances
        earthContinuityOhms:
          applianceClass === 'CLASS_I' && !isNaN(parseFloat(earthContinuityOhms))
            ? parseFloat(earthContinuityOhms)
            : undefined,
        insulationResistanceMOhms: parseFloat(insulationResistanceMOhms) || 0,
        outcome: initialOutcome,
        cautionNotes: cautionNotes.trim() || undefined,
        powerType: 'MAINS_240V',
        applianceClass
      });

      // Clear active card and display PAT 1 routing confirmation banner
      setSuccessBanner(
        `Initial PAT test recorded for Card #${currentItem.cardNumber}. Item moved to ${nextStatus}.`
      );
      setCurrentItem(null);
      setSearchCardNumber('');
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Error saving PAT record';
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
      alert('Please select your PAT tester name and PAT testing instrument.');
      return;
    }

    setSubmittingTest(true);
    try {
      // Record PAT 2 measurements (preserving PAT 1's testerName and instrumentSerial)
      const nextStatus = await submitPatFinal({
        sessionId: session.id,
        repairId: currentItem.id,
        testerName: testerName.trim(),
        instrumentSerial: instrumentSerial.trim(),
        visualPass,
        fuseRatingAmps,
        testVoltageVolts,
        // Include earthContinuityOhms only for Class I earthed appliances
        earthContinuityOhms:
          applianceClass === 'CLASS_I' && !isNaN(parseFloat(earthContinuityOhms))
            ? parseFloat(earthContinuityOhms)
            : undefined,
        insulationResistanceMOhms: parseFloat(insulationResistanceMOhms) || 0,
        outcome: finalOutcome,
        certificateNotes: cautionNotes.trim() || undefined,
        powerType: 'MAINS_240V',
        applianceClass
      });

      // Clear active card and display PAT 2 certification banner
      setSuccessBanner(
        `Final PAT certification recorded for Card #${currentItem.cardNumber}. Item moved to ${nextStatus}.`
      );
      setCurrentItem(null);
      setSearchCardNumber('');
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Error certifying PAT test';
      alert(message);
    } finally {
      setSubmittingTest(false);
    }
  };

  // Determine whether the loaded item is in the post-repair PAT 2 stage or already checked out
  const isPat2 = isPat2StageForItem(currentItem);
  const isTerminalItem =
    currentItem?.status === 'COMPLETED' || currentItem?.status === 'TAKEN_HOME';

  // Determine whether a non-mains item needs a Power Type update / reroute out of the PAT queue
  const needsPowerTypeReroute = Boolean(
    currentItem &&
      selectedPowerType !== 'MAINS_240V' &&
      (selectedPowerType !== currentItem.item.powerType ||
        currentItem.status === 'WAITING_PAT1' ||
        currentItem.status === 'IN_PAT1' ||
        currentItem.status === 'WAITING_PAT2' ||
        currentItem.status === 'IN_PAT2')
  );

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
        <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4 pb-6 border-b border-slate-100">
          <div className="flex items-center gap-3">
            <div className="h-12 w-12 rounded-2xl bg-amber-100 text-amber-800 flex items-center justify-center flex-shrink-0">
              <Zap className="h-6 w-6" />
            </div>
            <div>
              {/* Station title and subtitle */}
              <h2 className="text-xl sm:text-2xl font-black text-slate-900">
                PAT Electrical Safety Station
              </h2>
              <p className="text-xs sm:text-sm text-slate-500">
                Pre-repair safety screening (PAT 1) and post-repair certification (PAT 2)
              </p>
            </div>
          </div>

          {/* Qualified PAT Tester Dropdown, PAT Instrument Dropdown + Edit Button, & Policies Button */}
          <div className="flex flex-col sm:flex-row flex-wrap items-stretch sm:items-center gap-2 text-xs">
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

            {/* PAT Testing Instrument Dropdown & Edit Action (Issue #27) */}
            <div className="flex items-center gap-1.5">
              {/* PAT Instrument dropdown bound to constant hardware serialNumber */}
              <select
                id="pat-instrument-serial"
                aria-label="Select PAT Instrument"
                value={selectedInstrument ? selectedInstrument.serialNumber : ''}
                onChange={handleInstrumentSelectChange}
                className={`flex-1 sm:max-w-xs px-3 py-2 rounded-xl border bg-white font-semibold focus:outline-none focus:ring-2 focus:ring-amber-500 ${
                  isSelectedInstrumentOverdue
                    ? 'border-amber-400 text-amber-900 bg-amber-50/40'
                    : 'border-slate-300 text-slate-800'
                }`}
              >
                {/* Default placeholder option */}
                <option value="">
                  {loadingInstruments
                    ? 'Loading PAT Instruments...'
                    : 'Select PAT Instrument...'}
                </option>
                {/* Render registered PAT instruments with ⚠️ prefix if calibration is overdue */}
                {instruments.map((inst) => (
                  <option key={inst.id} value={inst.serialNumber}>
                    {formatPatInstrumentOptionLabel(inst, serviceIntervalMonths)}
                  </option>
                ))}
                {/* Sentinel option to open the Add New PAT Instrument modal */}
                <option value={ADD_NEW_INSTRUMENT_OPTION}>
                  + Add New PAT Instrument...
                </option>
              </select>

              {/* Edit Button for currently selected PAT instrument */}
              <button
                type="button"
                disabled={!selectedInstrument}
                onClick={() => setInstrumentModalState({ isOpen: true, mode: 'edit' })}
                title={
                  selectedInstrument
                    ? `Edit ${selectedInstrument.displayName} (S/N: ${selectedInstrument.serialNumber})`
                    : 'Select a PAT instrument to edit'
                }
                aria-label="Edit selected PAT instrument"
                className="inline-flex items-center justify-center gap-1 px-2.5 py-2 rounded-xl border border-slate-200 bg-slate-50 text-slate-700 font-bold hover:bg-slate-100 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
              >
                <Pencil className="h-3.5 w-3.5 text-amber-700" />
                <span>Edit</span>
              </button>
            </div>

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

        {/* Non-blocking amber warning banner when selected PAT instrument calibration is overdue (Issue #27) */}
        {selectedInstrument && isSelectedInstrumentOverdue && (
          <div
            role="status"
            className="mt-4 p-3 rounded-xl bg-amber-50 border border-amber-300 text-amber-950 text-xs flex items-start gap-2.5"
          >
            <AlertTriangle className="h-4 w-4 text-amber-600 flex-shrink-0 mt-0.5" />
            {/* Overdue calibration details and inline Edit Modal shortcut */}
            <div className="flex-1">
              <span className="font-bold">Calibration / Service Overdue: </span>
              <span>
                <strong>{selectedInstrument.displayName}</strong> (S/N:{' '}
                <span className="font-mono font-bold">{selectedInstrument.serialNumber}</span>) was
                last serviced on{' '}
                <span className="font-mono font-bold">{selectedInstrument.lastCalibratedDate}</span>{' '}
                (more than {serviceIntervalMonths} months ago). You may continue testing, or{' '}
              </span>
              {/* Quick-action button to open PatInstrumentModal in edit mode */}
              <button
                type="button"
                onClick={() => setInstrumentModalState({ isOpen: true, mode: 'edit' })}
                className="underline font-bold text-amber-900 hover:text-amber-700"
              >
                update its calibration date
              </button>
              <span>.</span>
            </div>
          </div>
        )}

        {/* Warning banner when no PAT-trained volunteers are checked in to the active session */}
        {session && qualifiedTesters.length === 0 && (
          <div className="mt-4 p-3 rounded-xl bg-amber-50 border border-amber-200 text-amber-900 text-xs font-bold flex items-center gap-2">
            <AlertTriangle className="h-4 w-4 text-amber-600 flex-shrink-0" />
            <span>No PAT-trained volunteers checked in — ask Front Desk to update session attendance</span>
          </div>
        )}

        {/* Repair Item Point-Lookup Form (autofill-safe for iOS Safari — Issue #28) */}
        <form onSubmit={handleSearchCard} autoComplete="off" role="search" className="mt-6 flex gap-3">
          <div className="relative flex-1">
            <Search className="h-5 w-5 absolute left-3.5 top-3.5 text-slate-400" />
            {/* Numeric repair item lookup input */}
            <input
              {...REPAIR_ITEM_LOOKUP_INPUT_PROPS}
              id="pat-repair-item-lookup"
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
            {searching ? 'Finding...' : 'Find Item'}
          </button>
        </form>

        {/* Display lookup warning or informational message */}
        {searchMessage && (
          <div className="mt-4 p-3 rounded-xl bg-amber-50 border border-amber-200 text-amber-900 text-sm font-medium">
            {searchMessage}
          </div>
        )}

        {/* Display PAT record or power type override confirmation banner with dismiss button */}
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
                  Token: {currentItem.referenceToken} • Registered Power: {getPowerTypeLabel(currentItem.item.powerType)}
                </p>
              </div>
            </div>

            {/* Current lifecycle status and PAT stage indicator */}
            <div className="flex items-center gap-2">
              <StatusBadge status={currentItem.status} size="md" />
              <span className="text-xs font-bold uppercase tracking-wide bg-amber-100 text-amber-900 px-3 py-1 rounded-lg border border-amber-300">
                {isPat2 ? 'PAT 2 (Post-Repair)' : 'PAT 1 (Pre-Repair)'}
              </span>
            </div>
          </div>

          {/* Reported customer fault description */}
          <div className="bg-slate-50 p-4 rounded-2xl border border-slate-200 text-sm">
            <span className="text-xs font-bold text-slate-500 uppercase block mb-1">Reported Fault</span>
            <p className="text-slate-800 font-medium">{currentItem.item.faultDescription}</p>
          </div>

          {/* Read-Only PAT 1 Summary Card (shown whenever PAT 1 has already been recorded on this item) */}
          {currentItem.patInitial && (
            <div className="bg-amber-50/60 p-4 rounded-2xl border border-amber-200 text-xs space-y-1.5">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span className="font-bold text-amber-950 uppercase tracking-wide">
                  PAT 1 (Pre-Repair) Record
                </span>
                <span className="font-mono font-bold text-amber-900">
                  Outcome: {currentItem.patInitial.outcome}
                </span>
              </div>
              {/* Display PAT 1 operator and hardware serial number for cross-stage audit traceability */}
              <p className="text-slate-700">
                Tester: <strong>{currentItem.patInitial.testerName}</strong> • Instrument S/N:{' '}
                <span className="font-mono font-bold">{currentItem.patInitial.instrumentSerial}</span> • Fuse:{' '}
                <strong>{currentItem.patInitial.fuseRatingAmps}A</strong> • Voltage:{' '}
                <strong>{currentItem.patInitial.testVoltageVolts}V DC</strong> • Insulation:{' '}
                <strong>{currentItem.patInitial.insulationResistanceMOhms} MΩ</strong>
                {currentItem.patInitial.earthContinuityOhms !== undefined
                  ? ` • Earth: ${currentItem.patInitial.earthContinuityOhms} Ω`
                  : ''}
              </p>
              {currentItem.patInitial.cautionNotes && (
                <p className="text-amber-900 italic">
                  Notes: &ldquo;{currentItem.patInitial.cautionNotes}&rdquo;
                </p>
              )}
            </div>
          )}

          {/* Guard against modifying items that have already been checked out or taken home */}
          {isTerminalItem ? (
            <div className="p-5 rounded-2xl bg-slate-100 border border-slate-300 text-sm text-slate-700 flex items-center justify-between gap-4">
              <div>
                <p className="font-bold text-slate-900">
                  This item is already marked as {currentItem.status}.
                </p>
                <p className="text-xs text-slate-600 mt-1">
                  Completed or taken-home items are read-only at the PAT station.
                </p>
              </div>
              <button
                type="button"
                onClick={() => setCurrentItem(null)}
                className="px-4 py-2 rounded-xl border border-slate-300 bg-white text-xs font-bold text-slate-700 hover:bg-slate-50"
              >
                Close
              </button>
            </div>
          ) : (
            <>
              {/* Editable Power Type Selector (Issue #23: supports both Forward and Reverse overrides) */}
              <div className="p-4 rounded-2xl bg-amber-50/40 border border-amber-200">
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                  <div>
                    <label
                      htmlFor="pat-power-type-select"
                      className="block text-xs font-bold text-slate-800 uppercase tracking-wider"
                    >
                      Power Type Classification
                    </label>
                    <p className="text-xs text-slate-600 mt-0.5">
                      If the visitor selected the wrong power option at registration, update it here.
                    </p>
                  </div>

                  {/* Power Type dropdown bound to shared POWER_TYPE_OPTIONS */}
                  <select
                    id="pat-power-type-select"
                    aria-label="Power Type"
                    value={selectedPowerType}
                    onChange={(e) => setSelectedPowerType(e.target.value as PowerType)}
                    className="sm:w-80 px-3.5 py-2.5 rounded-xl border border-amber-300 bg-white text-sm font-bold text-slate-900 focus:outline-none focus:ring-2 focus:ring-amber-500"
                  >
                    {POWER_TYPE_OPTIONS.map((opt) => (
                      <option key={opt.value} value={opt.value}>
                        {opt.label}
                      </option>
                    ))}
                  </select>
                </div>

                {/* Reverse Override Notice: Non-Mains item switched to MAINS_240V at /pat */}
                {selectedPowerType === 'MAINS_240V' &&
                  currentItem.item.powerType !== 'MAINS_240V' && (
                    <div className="mt-3 p-3 rounded-xl bg-amber-100/80 border border-amber-300 text-amber-950 text-xs font-medium flex items-center gap-2">
                      <Zap className="h-4 w-4 text-amber-700 flex-shrink-0" />
                      <span>
                        Submitting this PAT record will update the item&apos;s Power Type from{' '}
                        <strong>{getPowerTypeLabel(currentItem.item.powerType)}</strong> to{' '}
                        <strong>{getPowerTypeLabel('MAINS_240V')}</strong>.
                      </span>
                    </div>
                  )}
              </div>

              {/* Branch 1: Selected Power Type is Non-Mains -> Show Reroute Panel or Non-Mains Info Notice */}
              {selectedPowerType !== 'MAINS_240V' ? (
                needsPowerTypeReroute ? (
                  <div className="p-6 rounded-2xl bg-emerald-50/70 border-2 border-emerald-200 space-y-4">
                    <div className="flex items-start gap-3">
                      <CheckCircle2 className="h-6 w-6 text-emerald-600 flex-shrink-0 mt-0.5" />
                      <div className="space-y-1">
                        <h4 className="text-sm font-black text-emerald-950">
                          240V Mains PAT Test Not Required ({getPowerTypeLabel(selectedPowerType)})
                        </h4>
                        <p className="text-xs text-emerald-900">
                          {isPat2
                            ? 'This item does not use 240V mains power and does not require PAT 2 post-repair electrical certification. Confirming below will update its power type and route it directly to Ready for Collection.'
                            : 'This item does not use 240V mains power and does not require PAT 1 pre-repair electrical testing. Confirming below will update its power type and route it directly to the Waiting Repair queue.'}
                        </p>
                      </div>
                    </div>

                    {/* Action buttons for Non-Mains Power Type Override */}
                    <div className="flex flex-wrap justify-end gap-3 pt-3 border-t border-emerald-200/80">
                      <button
                        type="button"
                        onClick={() => setCurrentItem(null)}
                        disabled={submittingTest}
                        className="px-5 py-2.5 rounded-xl border border-slate-300 bg-white text-sm font-semibold text-slate-700 hover:bg-slate-50"
                      >
                        Cancel
                      </button>
                      <button
                        type="button"
                        onClick={handleOverrideNonMainsPowerType}
                        disabled={submittingTest}
                        className="inline-flex items-center gap-2 px-6 py-2.5 rounded-xl bg-emerald-600 text-white text-sm font-bold hover:bg-emerald-700 disabled:opacity-50 shadow-sm"
                      >
                        <span>
                          {submittingTest
                            ? 'Updating Power Type...'
                            : isPat2
                              ? 'Update Power Type & Route to Ready for Collection'
                              : 'Update Power Type & Route to Waiting Repair'}
                        </span>
                        <ArrowRight className="h-4 w-4" />
                      </button>
                    </div>
                  </div>
                ) : (
                  /* Non-mains item looked up on /pat that is already in a non-PAT queue */
                  <div className="p-6 rounded-2xl bg-slate-50 border border-slate-200 space-y-3">
                    <div className="flex items-start gap-3">
                      <AlertTriangle className="h-5 w-5 text-amber-600 flex-shrink-0 mt-0.5" />
                      <div className="space-y-1">
                        <h4 className="text-sm font-bold text-slate-900">
                          Registered as Non-Mains ({getPowerTypeLabel(selectedPowerType)})
                        </h4>
                        <p className="text-xs text-slate-600">
                          This item is currently in <strong>{currentItem.status}</strong> and does
                          not require a 240V PAT test. If it actually plugs into 240V mains power,
                          change <strong>Power Type Classification</strong> above to{' '}
                          <strong>{getPowerTypeLabel('MAINS_240V')}</strong> to complete a PAT
                          inspection.
                        </p>
                      </div>
                    </div>
                    <div className="flex justify-end">
                      <button
                        type="button"
                        onClick={() => setCurrentItem(null)}
                        className="px-5 py-2 rounded-xl border border-slate-300 bg-white text-xs font-bold text-slate-700 hover:bg-slate-50"
                      >
                        Close
                      </button>
                    </div>
                  </div>
                )
              ) : (
                /* Branch 2: Selected Power Type is MAINS_240V -> Full BS 1363 PAT 1 / PAT 2 Form */
                <form
                  onSubmit={isPat2 ? handleSubmitPatFinal : handleSubmitPatInitial}
                  className="space-y-6"
                >
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
                          setFuseRatingAmps(
                            val === 'OTHER' ? 'OTHER' : (parseInt(val, 10) as 3 | 5 | 13)
                          );
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
                        onChange={(e) =>
                          setTestVoltageVolts(parseInt(e.target.value, 10) as 250 | 500)
                        }
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
                        <span className="text-[10px] text-slate-500">
                          Threshold: ≤ 0.10 Ω + lead
                        </span>
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
                      <span className="text-[10px] text-slate-500">
                        Threshold: ≥ 1.0 MΩ (Class I) / ≥ 2.0 MΩ (Class II)
                      </span>
                    </div>
                  </div>

                  {/* Outcome Selection */}
                  <div className="pt-4 border-t border-slate-100">
                    <label className="block text-xs font-bold text-slate-800 uppercase tracking-wider mb-2">
                      {isPat2
                        ? 'Final Safety Certification Outcome'
                        : 'Initial Screening Outcome'}
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
                            Visual, earth, and insulation tests pass. Safe to route to volunteer
                            repairers.
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
                            Cord or plug defect only. Fixers may repair power lead, but MUST
                            re-test post repair.
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
                      {submittingTest ? 'Recording Safety Test...' : 'Submit PAT Record'}
                    </button>
                  </div>
                </form>
              )}
            </>
          )}
        </div>
      )}

      {/* PAT Instrument Add / Edit / Retire Modal (Issue #27) */}
      <PatInstrumentModal
        isOpen={instrumentModalState.isOpen}
        mode={instrumentModalState.mode}
        initialInstrument={instrumentModalState.mode === 'edit' ? selectedInstrument : null}
        existingInstruments={instruments}
        onClose={() => setInstrumentModalState((prev) => ({ ...prev, isOpen: false }))}
        onSaved={handleInstrumentSaved}
        onDeleted={handleInstrumentDeleted}
      />

      {/* Repair Café Policies Reference Modal */}
      <PoliciesModal
        isOpen={showPoliciesModal}
        onClose={() => setShowPoliciesModal(false)}
      />
    </div>
  );
};
