/**
 * @file src/views/FrontDeskView.tsx
 *
 * Station 2: Front Desk Organiser View.
 * Provides live session queue management, physical card token assignment,
 * on-demand item photo viewing/downloading, customer PII lookup, volunteer
 * register administration, and session creation/finalization.
 *
 * Architectural Note: The FrontDeskView component exceeds 50 lines because it
 * coordinates the complete single-screen Front Desk board (live repair queue
 * table, tablet partition selector, attendance bar, card assignment modal,
 * customer PII modal, new session wizard, and photo viewer modal).
 */

import React, { useState, useEffect, useCallback, useRef } from 'react';
import {
  Plus,
  Search,
  CheckCircle,
  Phone,
  Lock,
  Calendar,
  Archive,
  RefreshCw,
  Tablet,
  Users,
  BookOpen,
  ClipboardList,
  Shield,
  Zap,
  AlertTriangle,
  Clock,
  Camera
} from 'lucide-react';
import { Session, RepairItem, Volunteer, SystemSettings } from '../types';
import { useAuth } from '../hooks/useAuth';
import { useRepairs } from '../hooks/useRepairs';
import { useRegisterUnsavedWork } from '../context/UnsavedWorkContext';
import {
  createSession,
  finalizeSessionClient,
  publishAppVersionToSystemSettings
} from '../services/sessionService';
import {
  APP_VERSION,
  APP_BUILD_TIMESTAMP,
  shouldPublishAppVersion
} from '../services/pwaUpdateService';
import {
  assignCardToken,
  completeCollection,
  getPrivateCustomerData,
  filterRepairs,
  isTerminalStatus,
  canAssignCard,
  formatWaitTime,
  WAIT_TIME_REFRESH_INTERVAL_MS,
  REPAIR_ITEM_LOOKUP_INPUT_PROPS
} from '../services/repairService';
import {
  listVolunteers,
  syncOrganiserEmailsToSystemSettings,
  toSessionVolunteerSummary
} from '../services/volunteerService';
import { StatusBadge } from '../components/common/StatusBadge';
import { CardToken } from '../components/common/CardToken';
import { PoliciesModal } from '../components/common/PoliciesModal';
import { PhotoViewerModal } from '../components/common/PhotoViewerModal';
import { VolunteerRegisterPanel } from '../components/frontdesk/VolunteerRegisterPanel';
import { SessionAttendanceBar } from '../components/frontdesk/SessionAttendanceBar';
import { cafeConfig } from '../config/cafe.config';

/**
 * Props accepted by the {@link FrontDeskView} station component.
 */
interface FrontDeskViewProps {
  /** Currently active Repair Café session, or `null` when no session is open. */
  session: Session | null;
  /** Optional global system settings document (`settings/system`). */
  systemSettings?: SystemSettings | null;
}

/** Sub-navigation tabs available on the Front Desk organiser screen. */
type FrontDeskTab = 'QUEUE' | 'VOLUNTEERS' | 'POLICIES';

/**
 * Station 2: Front Desk Organiser View.
 * Provides live repair queue management, volunteer register administration,
 * policy library viewing, on-demand photo viewing, and session creation/finalization.
 */
export const FrontDeskView: React.FC<FrontDeskViewProps> = ({
  session,
  systemSettings = null,
}) => {
  // Authenticate organiser via Google Sign-In and dynamic system settings
  const { user, isAdmin, signInWithGoogle, signOut } = useAuth();
  const { repairs, loading } = useRepairs(session?.id);

  // Active sub-navigation tab ('QUEUE', 'VOLUNTEERS', or 'POLICIES')
  const [activeTab, setActiveTab] = useState<FrontDeskTab>('QUEUE');

  // Volunteer register state and modal policy viewer state
  const [volunteers, setVolunteers] = useState<Volunteer[]>([]);
  const [loadingVolunteers, setLoadingVolunteers] = useState(false);
  const [showPoliciesModal, setShowPoliciesModal] = useState(false);

  // New session modal / form state
  const [showNewSessionModal, setShowNewSessionModal] = useState(false);
  const [sessionName, setSessionName] = useState('');
  const [sessionDate, setSessionDate] = useState(new Date().toISOString().split('T')[0]);
  const [volunteerPin, setVolunteerPin] = useState('');
  const [selectedNewSessionVolunteerIds, setSelectedNewSessionVolunteerIds] = useState<string[]>([]);
  const [newSessionVolunteerSearch, setNewSessionVolunteerSearch] = useState('');
  const [creatingSession, setCreatingSession] = useState(false);

  // Tablet Partitioning preset for offline card allocation
  const [tabletPreset, setTabletPreset] = useState<'A' | 'B' | 'ALL'>(() => {
    return (localStorage.getItem('frontdesk_tablet_preset') as 'A' | 'B' | 'ALL') || 'ALL';
  });

  // Assign card inline modal state
  const [selectedRepairId, setSelectedRepairId] = useState<string | null>(null);
  const [cardNumberInput, setCardNumberInput] = useState<string>('');
  const [assignError, setAssignError] = useState<string | null>(null);

  // Customer contact detail modal state
  const [contactModalData, setContactModalData] = useState<{
    brandModel: string;
    cardNumber?: number;
    firstName: string;
    contactPhone?: string;
  } | null>(null);

  // On-demand item photo viewer modal state (point-fetches photos only when opened)
  const [photoModalRepairId, setPhotoModalRepairId] = useState<string | null>(null);
  const photoModalRepair = repairs.find((r) => r.id === photoModalRepairId) || null;

  // Search and status filter state for the repairs queue
  const [searchTerm, setSearchTerm] = useState('');
  const [statusFilter, setStatusFilter] = useState<string>('ALL');

  // Finalize session confirmation state
  const [isFinalizing, setIsFinalizing] = useState(false);

  // Protect active Front Desk modals, searches, and session lifecycle actions from mid-action auto-reload
  const isFrontDeskDirty =
    showNewSessionModal ||
    selectedRepairId !== null ||
    contactModalData !== null ||
    photoModalRepairId !== null ||
    showPoliciesModal ||
    searchTerm.trim().length > 0 ||
    isFinalizing ||
    creatingSession;
  useRegisterUnsavedWork(isFrontDeskDirty, 'frontdesk-view');

  // Automatically publish the current build version to settings/system when an admin opens Front Desk
  const hasPublishedVersionRef = useRef<string | null>(null);
  useEffect(() => {
    if (!isAdmin) return;
    const versionKey = `${APP_VERSION}_${APP_BUILD_TIMESTAMP}`;
    if (hasPublishedVersionRef.current === versionKey) return;
    if (shouldPublishAppVersion(APP_VERSION, APP_BUILD_TIMESTAMP, systemSettings)) {
      hasPublishedVersionRef.current = versionKey;
      void publishAppVersionToSystemSettings().catch(() => {
        // Reset ref if offline or transient error so next update can retry
        hasPublishedVersionRef.current = null;
      });
    }
  }, [isAdmin, systemSettings]);

  // Current timestamp for queue wait-time display, refreshed on a 5-minute basis
  const [currentTime, setCurrentTime] = useState<number>(() => Date.now());

  useEffect(() => {
    const intervalId = setInterval(() => {
      setCurrentTime(Date.now());
    }, WAIT_TIME_REFRESH_INTERVAL_MS);

    return () => clearInterval(intervalId);
  }, []);

  // Persist the selected tablet preset to localStorage
  const handleTabletPresetChange = (preset: 'A' | 'B' | 'ALL') => {
    setTabletPreset(preset);
    localStorage.setItem('frontdesk_tablet_preset', preset);
  };

  // Load the volunteer register and sync dynamic organiser emails to settings/system
  const loadVolunteers = useCallback(async () => {
    if (!isAdmin || !user) return;
    setLoadingVolunteers(true);
    try {
      // Fetch all registered volunteers sorted alphabetically
      const list = await listVolunteers();
      setVolunteers(list);
      // Sync static + dynamic organiser emails so newly added organisers can sign in
      await syncOrganiserEmailsToSystemSettings(list);
    } catch (err) {
      console.warn('Could not load volunteers or sync organiser emails:', err);
    } finally {
      setLoadingVolunteers(false);
    }
  }, [isAdmin, user]);

  // Trigger initial volunteer register load and organiser email sync on admin sign-in
  useEffect(() => {
    if (isAdmin && user) {
      loadVolunteers();
    }
  }, [isAdmin, user, loadVolunteers]);

  // Toggle selection of a volunteer in the "Start Today's Repair Café" modal
  const handleToggleNewSessionVolunteer = (volunteerId: string) => {
    setSelectedNewSessionVolunteerIds((prev) =>
      prev.includes(volunteerId)
        ? prev.filter((id) => id !== volunteerId)
        : [...prev, volunteerId]
    );
  };

  // Render unauthorized message if signed in with a non-organiser Google account
  if (!isAdmin) {
    if (user && user.email) {
      return (
        <div className="max-w-md mx-auto my-16 p-8 bg-white rounded-3xl shadow-md border border-amber-200 text-center">
          {/* Lock badge header */}
          <div className="h-14 w-14 bg-amber-100 text-amber-800 rounded-2xl flex items-center justify-center mx-auto mb-4">
            <Lock className="h-7 w-7 text-amber-700" />
          </div>
          <h2 className="text-xl font-bold text-slate-800">Unauthorized Organizer Account</h2>
          <p className="mt-2 text-sm text-slate-600 mb-2">
            You are signed in as <span className="font-semibold text-slate-800">{user.email}</span>.
          </p>
          {/* Instructions for granting organiser access */}
          <p className="text-xs text-slate-500 mb-6 leading-relaxed">
            This account is not in the list of authorized organizers for {cafeConfig.cafeName}. Please switch to an authorized Google account or ask an organiser to mark your profile as an Organiser in the Volunteer Register.
          </p>
          <button
            onClick={signOut}
            className="w-full py-3 px-4 rounded-xl bg-slate-800 text-white font-bold hover:bg-slate-900 transition-colors shadow-sm flex items-center justify-center gap-2 text-sm"
          >
            Sign Out &amp; Switch Account
          </button>
        </div>
      );
    }


    // Render Google Sign-In prompt when unauthenticated
    return (
      <div className="max-w-md mx-auto my-16 p-8 bg-white rounded-3xl shadow-md border border-slate-200 text-center">
        {/* Emerald lock badge header */}
        <div className="h-14 w-14 bg-emerald-100 text-emerald-800 rounded-2xl flex items-center justify-center mx-auto mb-4">
          <Lock className="h-7 w-7" />
        </div>
        <h2 className="text-xl font-bold text-slate-800">Front Desk Organizer Login</h2>
        {/* Explanation of organiser permissions required for Front Desk */}
        <p className="mt-2 text-sm text-slate-600 mb-6">
          Access to the Front Desk queue, volunteer register, and session administration requires signing in with an authorized Google account.
        </p>
        {/* Google Sign-In action button */}
        <button
          onClick={signInWithGoogle}
          className="w-full py-3 px-4 rounded-xl bg-emerald-700 text-white font-bold hover:bg-emerald-800 transition-colors shadow-sm flex items-center justify-center gap-2"
        >
          Sign In with Google
        </button>
      </div>
    );
  }

  // Handle creation of a new monthly Repair Café session with selected attending volunteers
  const handleCreateSession = async (e: React.FormEvent) => {
    e.preventDefault();
    if (volunteerPin.length !== 4) {
      alert('Please provide a 4-digit volunteer PIN.');
      return;
    }

    setCreatingSession(true);
    try {
      // Build deterministic session ID and non-PII attending volunteer summaries
      const sessionId = `${sessionDate.replace(/-/g, '')}-${sessionName.toLowerCase().replace(/[^a-z0-9]/g, '')}`;
      const selectedObjects = volunteers.filter((v) =>
        selectedNewSessionVolunteerIds.includes(v.id)
      );
      const attendingSummaries = selectedObjects.map(toSessionVolunteerSummary);

      // Persist session and set as active in settings/system
      await createSession({
        id: sessionId,
        name: sessionName.trim(),
        date: sessionDate,
        volunteerPin: volunteerPin.trim(),
        cardRangeStart: cafeConfig.defaultCardRange.start,
        cardRangeEnd: cafeConfig.defaultCardRange.end,
        attendingVolunteers: attendingSummaries
      });

      // Reset modal form state after successful launch
      setShowNewSessionModal(false);
      setSessionName('');
      setVolunteerPin('');
      setSelectedNewSessionVolunteerIds([]);
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Failed to create session';
      alert(message);
    } finally {
      setCreatingSession(false);
    }
  };

  // Handle assigning a physical numbered card (#1..#N) to a registered item
  const handleAssignCard = async (repairId: string) => {
    if (!session) return;
    const num = parseInt(cardNumberInput, 10);
    if (isNaN(num) || num <= 0) {
      setAssignError('Please enter a valid card number.');
      return;
    }

    // Warn organiser if card number falls outside the active tablet partition preset
    if (tabletPreset === 'A' && (num < 1 || num > 50)) {
      if (!confirm(`Warning: Tablet A is configured for cards 1-50. Card #${num} is outside this range. Proceed anyway?`)) {
        return;
      }
    } else if (tabletPreset === 'B' && (num < 51 || num > 100)) {
      if (!confirm(`Warning: Tablet B is configured for cards 51-100. Card #${num} is outside this range. Proceed anyway?`)) {
        return;
      }
    }

    // Perform card assignment and route item to PAT 1 or Repair queue
    setAssignError(null);
    try {
      await assignCardToken({
        sessionId: session.id,
        repairId,
        cardNumber: num
      });
      setSelectedRepairId(null);
      setCardNumberInput('');
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Error assigning card';
      setAssignError(message);
    }
  };

  // Fetch segregated customer PII from the restricted private/customer subcollection
  const handleViewContact = async (repair: RepairItem) => {
    if (!session) return;
    try {
      // Point-read restricted customer PII document
      const pii = await getPrivateCustomerData(session.id, repair.id);
      if (pii) {
        // Populate contact card modal with customer name and optional phone
        setContactModalData({
          brandModel: repair.item.brandModel,
          cardNumber: repair.cardNumber ?? undefined,
          firstName: pii.firstName,
          contactPhone: pii.contactPhone
        });
      } else {
        alert('Customer details not found or already redacted.');
      }
    } catch (err) {
      console.error('Error reading PII:', err);
      alert('Permission denied or customer details unavailable.');
    }
  };

  // Mark an item as COMPLETED when the visitor collects their item and returns the card
  const handleCompleteCollection = async (repairId: string) => {
    if (!session) return;
    // Prompt organiser to confirm physical card return before marking COMPLETED
    if (confirm('Confirm customer collection and return of physical card token?')) {
      try {
        await completeCollection(session.id, repairId);
      } catch (err: unknown) {
        console.error('Error completing collection:', err);
        const message = err instanceof Error ? err.message : 'Failed to complete collection.';
        alert(message);
      }
    }
  };

  // Close the active session, redact customer PII, and archive impact metrics
  const handleFinalizeSession = async () => {
    if (!session) return;
    // Count attached session photos to remind the organiser to download any photos before closing
    const totalSessionPhotos = repairs.reduce(
      (sum, r) => sum + (r.repair?.photoCount ?? 0),
      0
    );
    const photoReminder =
      totalSessionPhotos > 0
        ? `\n\nNote: ${totalSessionPhotos} item photo${totalSessionPhotos === 1 ? ' is' : 's are'} attached to this session. Please download any photos you wish to keep from the queue before closing.`
        : '';

    // Confirm destructive GDPR redaction and session archival with the organiser
    if (
      confirm(
        `Are you sure you want to CLOSE and FINALIZE "${session.name}"?\n\nThis will:\n1. Compute final impact metrics (weight diverted, success rates).\n2. Automatically REDACT all visitor customer phone numbers (GDPR).\n3. Archive the session for reporting.${photoReminder}`
      )
    ) {
      setIsFinalizing(true);
      try {
        // Run Cloud Function finalization (with automatic client-side fallback)
        await finalizeSessionClient(session.id);
        alert('Session successfully finalized and customer data redacted.');
        // Redirect cleanly to community impact reports
        window.location.href = '/reports';
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : 'Failed to finalize session';
        alert(message);
        setIsFinalizing(false);
      }
    }
  };

  // Filter repairs based on search term and status dropdown
  const filteredRepairs = filterRepairs(repairs, searchTerm, statusFilter);

  // Calculate live session queue counters
  const counts = {
    total: repairs.length,
    registered: repairs.filter((r) => r.status === 'REGISTERED').length,
    waitingPat1: repairs.filter((r) => r.status === 'WAITING_PAT1' || r.status === 'IN_PAT1').length,
    waitingRepair: repairs.filter((r) => r.status === 'WAITING_REPAIR' || r.status === 'IN_REPAIR').length,
    waitingPat2: repairs.filter((r) => r.status === 'WAITING_PAT2' || r.status === 'IN_PAT2').length,
    ready: repairs.filter((r) => r.status === 'READY_FOR_COLLECTION').length,
    completed: repairs.filter((r) => r.status === 'COMPLETED').length
  };

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 my-6">
      {/* Top Session Management Bar */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between pb-6 border-b border-slate-200 gap-4">
        {/* Station title and active session status subtitle */}
        <div>
          <h2 className="text-2xl font-black text-slate-900 flex items-center gap-2">
            Front Desk Operations
          </h2>
          <p className="text-xs sm:text-sm text-slate-500">
            {session ? (
              <span>Active Session: <strong>{session.name}</strong> ({session.date})</span>
            ) : (
              <span className="text-amber-600 font-semibold">No active session running today.</span>
            )}
          </p>
        </div>

        {/* Tablet Partition Selector and Session Lifecycle Buttons */}
        <div className="flex flex-wrap items-center gap-3">
          {/* Offline card range partition buttons (Tablet A 1-50, Tablet B 51-100, All) */}
          <div className="flex items-center gap-1.5 bg-slate-100 p-1 rounded-xl border border-slate-200 text-xs font-semibold">
            <Tablet className="h-4 w-4 text-slate-500 ml-1" />
            <button
              onClick={() => handleTabletPresetChange('A')}
              className={`px-2 py-1 rounded-lg transition-all ${
                tabletPreset === 'A' ? 'bg-white shadow text-emerald-800 font-bold' : 'text-slate-600'
              }`}
            >
              Tablet A (1–50)
            </button>
            {/* Tablet B partition selector button */}
            <button
              onClick={() => handleTabletPresetChange('B')}
              className={`px-2 py-1 rounded-lg transition-all ${
                tabletPreset === 'B' ? 'bg-white shadow text-emerald-800 font-bold' : 'text-slate-600'
              }`}
            >
              Tablet B (51–100)
            </button>
            {/* Unpartitioned full card range button */}
            <button
              onClick={() => handleTabletPresetChange('ALL')}
              className={`px-2 py-1 rounded-lg transition-all ${
                tabletPreset === 'ALL' ? 'bg-white shadow text-emerald-800 font-bold' : 'text-slate-600'
              }`}
            >
              All
            </button>
          </div>

          {/* Start or Finalize Session Action Button */}
          {!session ? (
            <button
              onClick={() => {
                setSelectedNewSessionVolunteerIds([]);
                setShowNewSessionModal(true);
              }}
              className="inline-flex items-center gap-2 px-4 py-2.5 rounded-xl bg-brand-600 text-white font-bold text-sm hover:bg-brand-700 shadow-sm transition-colors"
            >
              <Plus className="h-4 w-4" /> Start Today&apos;s Session
            </button>
          ) : (
            <button
              onClick={handleFinalizeSession}
              disabled={isFinalizing}
              className="inline-flex items-center gap-2 px-4 py-2.5 rounded-xl bg-slate-800 text-white font-bold text-sm hover:bg-slate-900 shadow-sm transition-colors disabled:opacity-50"
            >
              <Archive className="h-4 w-4" />
              {isFinalizing ? 'Closing Session...' : 'Finalize & Redact Session'}
            </button>
          )}
        </div>
      </div>

      {/* Front Desk Sub-Navigation Tabs (Queue, Volunteer Register, Policies) */}
      <div className="flex flex-wrap items-center gap-2 my-5 border-b border-slate-200 pb-3">
        {/* Session Queue sub-tab button */}
        <button
          type="button"
          onClick={() => setActiveTab('QUEUE')}
          className={`inline-flex items-center gap-2 px-4 py-2 rounded-xl text-xs sm:text-sm font-bold transition-all ${
            activeTab === 'QUEUE'
              ? 'bg-emerald-800 text-white shadow-sm'
              : 'bg-white text-slate-600 border border-slate-200 hover:bg-slate-50'
          }`}
        >
          <ClipboardList className="h-4 w-4" />
          Session Queue {session ? `(${repairs.length})` : ''}
        </button>
        {/* Volunteer Register sub-tab button */}
        <button
          type="button"
          onClick={() => setActiveTab('VOLUNTEERS')}
          className={`inline-flex items-center gap-2 px-4 py-2 rounded-xl text-xs sm:text-sm font-bold transition-all ${
            activeTab === 'VOLUNTEERS'
              ? 'bg-emerald-800 text-white shadow-sm'
              : 'bg-white text-slate-600 border border-slate-200 hover:bg-slate-50'
          }`}
        >
          <Users className="h-4 w-4" />
          Volunteer Register ({volunteers.length})
        </button>
        {/* Repair Café Policies sub-tab button */}
        <button
          type="button"
          onClick={() => setActiveTab('POLICIES')}
          className={`inline-flex items-center gap-2 px-4 py-2 rounded-xl text-xs sm:text-sm font-bold transition-all ${
            activeTab === 'POLICIES'
              ? 'bg-emerald-800 text-white shadow-sm'
              : 'bg-white text-slate-600 border border-slate-200 hover:bg-slate-50'
          }`}
        >
          <BookOpen className="h-4 w-4" />
          Repair Café Policies
        </button>
      </div>

      {/* Tab 1: Active Session Queue & Attendance Bar */}
      {activeTab === 'QUEUE' && (
        <>
          {!session ? (
            /* Empty state card when no session is currently active */
            <div className="bg-white rounded-3xl border border-slate-200 p-10 text-center my-6 shadow-sm">
              <Calendar className="h-10 w-10 text-slate-300 mx-auto mb-3" />
              <h3 className="text-lg font-bold text-slate-800">No Active Repair Café Session</h3>
              <p className="text-xs sm:text-sm text-slate-500 max-w-md mx-auto mt-1 mb-5">
                Start today&apos;s session to open the live repair queue, select attending volunteers, and assign physical card tokens.
              </p>
              {/* Launch new session modal button */}
              <button
                type="button"
                onClick={() => {
                  setSelectedNewSessionVolunteerIds([]);
                  setShowNewSessionModal(true);
                }}
                className="inline-flex items-center gap-2 px-5 py-2.5 rounded-xl bg-brand-600 text-white font-bold text-sm hover:bg-brand-700 shadow-sm"
              >
                <Plus className="h-4 w-4" /> Start Today&apos;s Session
              </button>
            </div>
          ) : (
            <>
              {/* Live Session Attendance Bar for managing volunteers arriving mid-session */}
              <SessionAttendanceBar
                session={session}
                volunteers={volunteers}
                currentUserEmail={user?.email}
                onRefreshVolunteers={loadVolunteers}
                onOpenPolicies={() => setShowPoliciesModal(true)}
              />

              {/* Live Metrics Counters */}
              <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3 my-6">
                {/* Total registered items counter */}
                <div className="bg-white p-3.5 rounded-2xl border border-slate-200 shadow-sm">
                  <span className="text-xs font-semibold text-slate-500 uppercase">Total Items</span>
                  <p className="text-2xl font-black text-slate-800 mt-1">{counts.total}</p>
                </div>
                {/* Items awaiting physical card assignment */}
                <div className="bg-amber-50 p-3.5 rounded-2xl border border-amber-200 shadow-sm">
                  <span className="text-xs font-semibold text-amber-700 uppercase">Needs Card #</span>
                  <p className="text-2xl font-black text-amber-900 mt-1">{counts.registered}</p>
                </div>
                {/* Items awaiting pre-repair PAT 1 electrical safety check */}
                <div className="bg-orange-50 p-3.5 rounded-2xl border border-orange-200 shadow-sm">
                  <span className="text-xs font-semibold text-orange-700 uppercase">PAT 1 Queue</span>
                  <p className="text-2xl font-black text-orange-900 mt-1">{counts.waitingPat1}</p>
                </div>
                {/* Items in the active volunteer fixer queue */}
                <div className="bg-blue-50 p-3.5 rounded-2xl border border-blue-200 shadow-sm">
                  <span className="text-xs font-semibold text-blue-700 uppercase">Repair Queue</span>
                  <p className="text-2xl font-black text-blue-900 mt-1">{counts.waitingRepair}</p>
                </div>
                {/* Repaired mains items awaiting post-repair PAT 2 safety check */}
                <div className="bg-purple-50 p-3.5 rounded-2xl border border-purple-200 shadow-sm">
                  <span className="text-xs font-semibold text-purple-700 uppercase">PAT 2 Queue</span>
                  <p className="text-2xl font-black text-purple-900 mt-1">{counts.waitingPat2}</p>
                </div>
                {/* Items ready for visitor pickup and card checkout */}
                <div className="bg-emerald-50 p-3.5 rounded-2xl border border-emerald-200 shadow-sm">
                  <span className="text-xs font-semibold text-emerald-700 uppercase">Ready for Pickup</span>
                  <p className="text-2xl font-black text-emerald-900 mt-1">{counts.ready}</p>
                </div>
              </div>

              {/* Search and Status Filter Controls */}
              <div className="flex flex-col sm:flex-row gap-3 my-4">
                {/* Text search input matching name, reference token, item #, or item */}
                <div className="relative flex-1">
                  <Search className="h-4 w-4 absolute left-3.5 top-3 text-slate-400" />
                  <input
                    type="text"
                    id="frontdesk-queue-search"
                    name="frontdesk-queue-search"
                    autoComplete="off"
                    autoCorrect="off"
                    autoCapitalize="off"
                    spellCheck={false}
                    data-1p-ignore={true}
                    data-lpignore="true"
                    data-bwignore="true"
                    data-form-type="other"
                    placeholder="Search customer name, token (e.g. REF-A38F), item #, or item..."
                    value={searchTerm}
                    onChange={(e) => setSearchTerm(e.target.value)}
                    className="w-full pl-10 pr-4 py-2.5 rounded-xl border border-slate-200 bg-white text-sm focus:outline-none focus:ring-2 focus:ring-brand-500 shadow-sm"
                  />
                </div>
                {/* Lifecycle status dropdown filter with live queue counts */}
                <select
                  value={statusFilter}
                  onChange={(e) => setStatusFilter(e.target.value)}
                  className="px-4 py-2.5 rounded-xl border border-slate-200 bg-white text-sm focus:outline-none focus:ring-2 focus:ring-brand-500 shadow-sm"
                >
                  <option value="ALL">All Statuses ({repairs.length})</option>
                  <option value="REGISTERED">Needs Card (#) ({counts.registered})</option>
                  <option value="WAITING_PAT1">Waiting PAT 1 ({counts.waitingPat1})</option>
                  <option value="WAITING_REPAIR">Waiting Repair ({counts.waitingRepair})</option>
                  <option value="WAITING_PAT2">Waiting PAT 2 ({counts.waitingPat2})</option>
                  <option value="READY_FOR_COLLECTION">Ready for Pickup ({counts.ready})</option>
                  <option value="COMPLETED">Completed ({counts.completed})</option>
                </select>
              </div>

              {/* Repairs Queue Table */}
              <div className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden">
                <div className="overflow-x-auto">
                  <table className="w-full text-left text-sm">
                    {/* Queue table column headers */}
                    <thead className="bg-slate-50 border-b border-slate-200 text-xs font-bold text-slate-500 uppercase tracking-wider">
                      <tr>
                        <th className="py-3 px-4">Card #</th>
                        <th className="py-3 px-4">Customer</th>
                        <th className="py-3 px-4">Ref Token</th>
                        <th className="py-3 px-4">Wait Time</th>
                        <th className="py-3 px-4">Item &amp; Fault</th>
                        <th className="py-3 px-4">Power Type</th>
                        <th className="py-3 px-4">Status</th>
                        <th className="py-3 px-4">Fixer / PAT</th>
                        <th className="py-3 px-4 text-right">Actions</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100 font-medium">
                      {loading ? (
                        /* Loading spinner row while snapshot initialises */
                        <tr>
                          <td colSpan={9} className="py-8 text-center text-slate-500">
                            <RefreshCw className="h-6 w-6 animate-spin mx-auto mb-2 text-brand-600" />
                            Loading repairs...
                          </td>
                        </tr>
                      ) : filteredRepairs.length === 0 ? (
                        /* Empty search/filter state row */
                        <tr>
                          <td colSpan={9} className="py-8 text-center text-slate-500">
                            No items found matching the current search.
                          </td>
                        </tr>
                      ) : (
                        filteredRepairs.map((r) => {
                          // Dim completed / terminal rows to prevent accidental card reassignment
                          const isCompleted = isTerminalStatus(r.status);
                          const customerName = r.customerName || '—';
                          return (
                            <tr
                              key={r.id}
                              className={`transition-colors ${
                                isCompleted
                                  ? 'bg-slate-100/75 text-slate-500 opacity-60 hover:bg-slate-100'
                                  : 'hover:bg-slate-50/80'
                              }`}
                            >
                              {/* Physical Card Number Column */}
                              <td className="py-3.5 px-4 whitespace-nowrap">
                                {r.cardNumber ? (
                                  <CardToken number={r.cardNumber} size="sm" dimmed={isCompleted} />
                                ) : isCompleted ? (
                                  <span className="text-xs text-slate-400 font-mono">—</span>
                                ) : (
                                  <span className="text-xs italic text-amber-700 bg-amber-100 px-2 py-0.5 rounded font-bold">
                                    Unassigned
                                  </span>
                                )}
                              </td>
                              {/* Customer First Name Column */}
                              <td className="py-3.5 px-4 whitespace-nowrap">
                                <span className={`font-semibold ${isCompleted ? 'text-slate-600' : 'text-slate-800'}`}>
                                  {customerName}
                                </span>
                              </td>
                              {/* Reference Token Column */}
                              <td className="py-3.5 px-4 font-mono font-bold text-xs text-slate-600">
                                {r.referenceToken}
                              </td>
                              {/* Queue Wait Time Column (refreshed every 5 minutes) */}
                              <td className="py-3.5 px-4 whitespace-nowrap text-xs">
                                <span
                                  className={`inline-flex items-center gap-1 font-semibold px-2 py-0.5 rounded ${
                                    isCompleted
                                      ? 'text-slate-500 bg-slate-200/70'
                                      : 'text-slate-700 bg-slate-100'
                                  }`}
                                  title="Time elapsed since customer registration (refreshed every 5 minutes)"
                                >
                                  <Clock className="h-3 w-3" />
                                  {formatWaitTime(r, currentTime)}
                                </span>
                              </td>
                              {/* Item & Fault Description Column */}
                              <td className="py-3.5 px-4">
                                <div className={`font-bold ${isCompleted ? 'text-slate-600' : 'text-slate-800'}`}>
                                  {r.item.brandModel}
                                </div>
                                <div className="text-xs text-slate-500 line-clamp-1">{r.item.faultDescription}</div>
                              </td>
                              {/* Power Type Badge Column */}
                              <td className="py-3.5 px-4 text-xs">
                                {r.item.powerType === 'MAINS_240V' ? (
                                  <span className={`font-bold px-2 py-0.5 rounded ${
                                    isCompleted
                                      ? 'text-slate-600 bg-slate-200'
                                      : 'text-orange-700 bg-orange-100'
                                  }`}>
                                    Mains 240V
                                  </span>
                                ) : (
                                  <span className="text-slate-600 bg-slate-100 px-2 py-0.5 rounded">
                                    {r.item.powerType.replace(/_/g, ' ')}
                                  </span>
                                )}
                              </td>
                              {/* Lifecycle Status Badge Column */}
                              <td className="py-3.5 px-4">
                                <StatusBadge status={r.status} size="sm" />
                              </td>
                              {/* Volunteer Fixer / PAT Tester Attribution Column */}
                              <td className="py-3.5 px-4 text-xs text-slate-600">
                                {r.repair?.fixerName && (
                                  <div>Fixer: <strong>{r.repair.fixerName}</strong></div>
                                )}
                                {r.patInitial?.testerName && (
                                  <div>PAT: {r.patInitial.testerName}</div>
                                )}
                                {!r.repair?.fixerName && !r.patInitial?.testerName && '—'}
                              </td>
                              {/* Row Action Buttons */}
                              <td className="py-3.5 px-4 text-right space-x-2 whitespace-nowrap">
                                {canAssignCard(r) && (
                                  <button
                                    onClick={() => {
                                      setSelectedRepairId(r.id);
                                      setCardNumberInput('');
                                      setAssignError(null);
                                    }}
                                    className="px-2.5 py-1 rounded-lg bg-brand-600 text-white text-xs font-bold hover:bg-brand-700 shadow-sm"
                                  >
                                    Assign Card #
                                  </button>
                                )}

                                {/* Item Photo Viewer & Downloader Button (shown only when photoCount > 0) */}
                                {(r.repair?.photoCount ?? 0) > 0 && (
                                  <button
                                    type="button"
                                    onClick={() => setPhotoModalRepairId(r.id)}
                                    title={`View or download ${r.repair?.photoCount} item photo${r.repair?.photoCount === 1 ? '' : 's'}`}
                                    className="inline-flex items-center gap-1 px-2 py-1 rounded-lg bg-blue-50 border border-blue-200 text-blue-800 text-xs font-bold hover:bg-blue-100 transition-colors cursor-pointer"
                                  >
                                    <Camera className="h-3.5 w-3.5 text-blue-600" />
                                    <span>{r.repair?.photoCount}</span>
                                  </button>
                                )}

                                {/* Customer Contact Phone Lookup */}
                                <button
                                  onClick={() => handleViewContact(r)}
                                  title="View customer contact phone"
                                  className="p-1.5 rounded-lg text-slate-500 hover:text-slate-800 hover:bg-slate-200 transition-colors"
                                >
                                  <Phone className="h-4 w-4 inline" />
                                </button>

                                {/* Checkout / Collection Action */}
                                {(r.status === 'READY_FOR_COLLECTION' || r.status === 'UNFIXABLE') && (
                                  <button
                                    onClick={() => handleCompleteCollection(r.id)}
                                    className="px-2.5 py-1 rounded-lg bg-emerald-600 text-white text-xs font-bold hover:bg-emerald-700 shadow-sm inline-flex items-center gap-1"
                                  >
                                    <CheckCircle className="h-3.5 w-3.5" /> Checkout
                                  </button>
                                )}
                              </td>
                            </tr>
                          );
                        })
                      )}
                    </tbody>
                  </table>
                </div>
              </div>
            </>
          )}
        </>
      )}

      {/* Tab 2: Volunteer Register Administration Panel */}
      {activeTab === 'VOLUNTEERS' && (
        <VolunteerRegisterPanel
          volunteers={volunteers}
          loading={loadingVolunteers}
          activeSessionId={session?.id}
          currentUserEmail={user?.email}
          onRefresh={loadVolunteers}
          onOpenPolicies={() => setShowPoliciesModal(true)}
        />
      )}

      {/* Tab 3: Inline Repair Café Policies Library */}
      {activeTab === 'POLICIES' && (
        <PoliciesModal
          isOpen={true}
          onClose={() => setActiveTab('QUEUE')}
          inline={true}
        />
      )}

      {/* Modal: Assign Physical Card Number */}
      {selectedRepairId && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4">
          {/* Card assignment dialog box */}
          <div className="w-full max-w-sm rounded-2xl bg-white p-6 shadow-2xl border border-slate-200">
            <h3 className="text-lg font-bold text-slate-900 mb-1">Assign Physical Card</h3>
            {/* Instructions and active tablet partition indicator */}
            <p className="text-xs text-slate-500 mb-3">
              Enter the number on the reusable physical card handed to the customer.
              {tabletPreset !== 'ALL' && (
                <span className="block mt-1 font-semibold text-emerald-700">
                  Active Preset: Tablet {tabletPreset} ({tabletPreset === 'A' ? '1–50' : '51–100'})
                </span>
              )}
            </p>

            {/* Card conflict or validation error message */}
            {assignError && (
              <p className="text-xs font-bold text-rose-600 mb-3 bg-rose-50 p-2 rounded">
                {assignError}
              </p>
            )}

            {/* Numeric input for physical card token (#1..#200) */}
            <input
              {...REPAIR_ITEM_LOOKUP_INPUT_PROPS}
              id="frontdesk-assign-item-token"
              name="assign-repair-item-token"
              aria-label="Assign repair item token"
              autoFocus
              placeholder="e.g. 14"
              value={cardNumberInput}
              onChange={(e) => setCardNumberInput(e.target.value)}
              className="w-full text-center text-3xl font-mono font-black py-3 rounded-xl border border-slate-300 focus:outline-none focus:ring-2 focus:ring-brand-500 mb-4"
            />

            {/* Cancel and Assign & Route action buttons */}
            <div className="flex gap-2">
              <button
                type="button"
                onClick={() => setSelectedRepairId(null)}
                className="flex-1 py-2 rounded-xl border border-slate-300 text-xs font-semibold text-slate-700 hover:bg-slate-50"
              >
                Cancel
              </button>
              {/* Confirm card assignment button */}
              <button
                type="button"
                onClick={() => handleAssignCard(selectedRepairId)}
                className="flex-1 py-2 rounded-xl bg-brand-600 text-xs font-bold text-white hover:bg-brand-700 shadow-sm"
              >
                Assign &amp; Route
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Modal: Customer PII Contact Card */}
      {contactModalData && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4">
          {/* Contact card modal dialog container */}
          <div className="w-full max-w-sm rounded-2xl bg-white p-6 shadow-2xl border border-slate-200 text-left">
            <h3 className="text-base font-bold text-slate-900 mb-1">Customer Contact Card</h3>
            {/* Item brand/model and card token subtitle */}
            <p className="text-xs text-slate-500 mb-4">
              Item: <strong>{contactModalData.brandModel}</strong>{' '}
              {contactModalData.cardNumber && `(Card #${contactModalData.cardNumber})`}
            </p>

            {/* Customer name and clickable telephone link */}
            <div className="space-y-3 bg-slate-50 p-4 rounded-xl border border-slate-200 text-sm">
              <div>
                <span className="text-xs text-slate-500 block">Customer Name</span>
                <span className="font-bold text-slate-800">{contactModalData.firstName}</span>
              </div>
              {/* Customer phone number or fallback text */}
              <div>
                <span className="text-xs text-slate-500 block">Phone Number</span>
                {contactModalData.contactPhone ? (
                  <a
                    href={`tel:${contactModalData.contactPhone}`}
                    className="font-bold text-emerald-700 underline flex items-center gap-1 mt-0.5"
                  >
                    <Phone className="h-3.5 w-3.5" /> {contactModalData.contactPhone}
                  </a>
                ) : (
                  <span className="text-xs italic text-slate-400">No phone provided</span>
                )}
              </div>
            </div>

            {/* Close contact card modal button */}
            <button
              onClick={() => setContactModalData(null)}
              className="mt-5 w-full py-2.5 rounded-xl bg-slate-800 text-xs font-bold text-white hover:bg-slate-900"
            >
              Close
            </button>
          </div>
        </div>
      )}

      {/* Modal: Start New Monthly Session (including attending volunteer multi-select) */}
      {showNewSessionModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4 overflow-y-auto">
          {/* New session configuration dialog */}
          <div className="w-full max-w-lg rounded-3xl bg-white p-6 shadow-2xl border border-slate-200 my-8">
            <div className="flex items-center gap-3 pb-4 border-b border-slate-100">
              {/* Calendar icon badge */}
              <div className="h-10 w-10 rounded-xl bg-emerald-100 text-emerald-800 flex items-center justify-center">
                <Calendar className="h-5 w-5" />
              </div>
              <div>
                <h3 className="text-lg font-bold text-slate-900">Start Today&apos;s Repair Café</h3>
                <p className="text-xs text-slate-500">Configure the active session, PIN, and attending volunteers</p>
              </div>
            </div>

            {/* New session launch form */}
            <form onSubmit={handleCreateSession} className="mt-4 space-y-4">
              <div>
                <label className="block text-xs font-bold text-slate-700 mb-1">
                  Session Name
                </label>
                {/* Session display name input */}
                <input
                  type="text"
                  required
                  placeholder="e.g. October 2026 - Seears Park"
                  value={sessionName}
                  onChange={(e) => setSessionName(e.target.value)}
                  className="w-full px-3.5 py-2.5 rounded-xl border border-slate-300 text-sm focus:outline-none focus:ring-2 focus:ring-brand-500"
                />
              </div>

              {/* Date and 4-digit volunteer PIN inputs */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-bold text-slate-700 mb-1">
                    Session Date
                  </label>
                  {/* ISO date picker */}
                  <input
                    type="date"
                    required
                    value={sessionDate}
                    onChange={(e) => setSessionDate(e.target.value)}
                    className="w-full px-3.5 py-2.5 rounded-xl border border-slate-300 text-sm focus:outline-none focus:ring-2 focus:ring-brand-500"
                  />
                </div>

                {/* Daily 4-digit volunteer station PIN input */}
                <div>
                  <label className="block text-xs font-bold text-slate-700 mb-1">
                    Daily Volunteer 4-Digit PIN
                  </label>
                  <input
                    type="text"
                    required
                    maxLength={4}
                    placeholder="e.g. 4829"
                    value={volunteerPin}
                    onChange={(e) => setVolunteerPin(e.target.value)}
                    className="w-full px-3.5 py-2 rounded-xl border border-slate-300 font-mono text-center tracking-widest text-base font-bold focus:outline-none focus:ring-2 focus:ring-brand-500"
                  />
                </div>
              </div>

              {/* Attending Volunteers Multi-Select Checklist */}
              <div>
                <div className="flex items-center justify-between mb-1.5">
                  <label className="block text-xs font-bold text-slate-700">
                    Attending Volunteers ({selectedNewSessionVolunteerIds.length} selected)
                  </label>
                  {/* Note that mid-session arrivals can be added later */}
                  <span className="text-[11px] text-slate-500">
                    Can also be updated while session is running
                  </span>
                </div>

                {volunteers.length === 0 ? (
                  <p className="text-xs text-slate-500 bg-slate-50 p-3 rounded-xl border border-slate-200">
                    No volunteers in the register yet. You can add volunteers from the Volunteer Register tab at any time.
                  </p>
                ) : (
                  <div className="space-y-2">
                    {/* Search input to quickly filter volunteers when launching a session */}
                    <div className="relative">
                      <Search className="h-3.5 w-3.5 absolute left-3 top-2.5 text-slate-400" />
                      <input
                        type="text"
                        placeholder="Filter volunteers by name..."
                        value={newSessionVolunteerSearch}
                        onChange={(e) => setNewSessionVolunteerSearch(e.target.value)}
                        className="w-full pl-8 pr-3 py-1.5 rounded-xl border border-slate-200 bg-slate-50 text-xs focus:outline-none focus:ring-2 focus:ring-emerald-600"
                      />
                    </div>

                    {/* Non-blocking amber warning if 0 volunteers or 0 PAT-trained volunteers are selected */}
                    {selectedNewSessionVolunteerIds.length === 0 ? (
                      <div className="p-2.5 rounded-xl bg-amber-50 border border-amber-200 text-[11px] text-amber-900 flex items-center gap-2 font-medium">
                        <AlertTriangle className="h-3.5 w-3.5 text-amber-600 flex-shrink-0" />
                        <span>No volunteers selected yet. You can still launch the session and check in volunteers as they arrive.</span>
                      </div>
                    ) : !volunteers.some((v) => selectedNewSessionVolunteerIds.includes(v.id) && v.isPatTrained) ? (
                      <div className="p-2.5 rounded-xl bg-amber-50 border border-amber-200 text-[11px] text-amber-900 flex items-center gap-2 font-medium">
                        <AlertTriangle className="h-3.5 w-3.5 text-amber-600 flex-shrink-0" />
                        <span>No PAT-trained volunteer selected yet — PAT Station dropdown will remain empty until a PAT tester is checked in.</span>
                      </div>
                    ) : null}

                    {/* Scrollable checklist of registered volunteers */}
                    <div className="max-h-48 overflow-y-auto divide-y divide-slate-100 border border-slate-200 rounded-xl bg-slate-50/50">
                      {volunteers
                        .filter((v) =>
                          /* Match search text against volunteer full name */
                          !newSessionVolunteerSearch.trim() ||
                          v.name.toLowerCase().includes(newSessionVolunteerSearch.trim().toLowerCase())
                        )
                        .map((v) => {
                          // Check whether this volunteer is currently selected for today's session
                          const isChecked = selectedNewSessionVolunteerIds.includes(v.id);
                          return (
                            <label
                              key={v.id}
                              className={`flex items-center justify-between px-3 py-2 cursor-pointer text-xs transition-colors ${
                                isChecked ? 'bg-emerald-50/80' : 'hover:bg-white'
                              }`}
                            >
                              {/* Checkbox and volunteer full name */}
                              <div className="flex items-center gap-2.5">
                                <input
                                  type="checkbox"
                                  checked={isChecked}
                                  onChange={() => handleToggleNewSessionVolunteer(v.id)}
                                  className="h-4 w-4 rounded border-slate-300 text-emerald-700 focus:ring-emerald-600"
                                />
                                <span className="font-bold text-slate-800">{v.name}</span>
                              </div>
                              {/* Capability and induction status badges */}
                              <div className="flex items-center gap-1">
                                {/* PAT-trained capability badge */}
                                {v.isPatTrained && (
                                  <span className="inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded bg-amber-100 text-amber-800 text-[10px] font-bold">
                                    <Zap className="h-2.5 w-2.5" /> PAT
                                  </span>
                                )}
                                {/* Organiser role badge */}
                                {v.isOrganiser && (
                                  <span className="inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded bg-purple-100 text-purple-800 text-[10px] font-bold">
                                    <Shield className="h-2.5 w-2.5" /> Org
                                  </span>
                                )}
                                {/* Pending safety induction warning badge */}
                                {!v.inducted && (
                                  <span className="inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded bg-amber-100 text-amber-900 border border-amber-300 text-[10px] font-bold">
                                    <AlertTriangle className="h-2.5 w-2.5 text-amber-600" /> Induction Req.
                                  </span>
                                )}
                              </div>
                            </label>
                          );
                        })}
                    </div>
                  </div>
                )}
              </div>

              {/* Modal cancel and launch session buttons */}
              <div className="pt-2 flex gap-3">
                <button
                  type="button"
                  onClick={() => setShowNewSessionModal(false)}
                  className="flex-1 py-2.5 rounded-xl border border-slate-300 text-sm font-semibold text-slate-700 hover:bg-slate-50"
                >
                  Cancel
                </button>
                {/* Submit button to launch the new Repair Café session */}
                <button
                  type="submit"
                  disabled={creatingSession}
                  className="flex-1 py-2.5 rounded-xl bg-brand-600 text-sm font-bold text-white hover:bg-brand-700 disabled:opacity-50 shadow-sm"
                >
                  {creatingSession ? 'Creating...' : 'Launch Session'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Modal: Item Photo Viewer & Downloader (loads photos on demand when clicked) */}
      {session && photoModalRepair && (
        <PhotoViewerModal
          isOpen={true}
          onClose={() => setPhotoModalRepairId(null)}
          sessionId={session.id}
          repairItem={photoModalRepair}
        />
      )}

      {/* Modal: Policy Documents Viewer (accessible from Attendance Bar & Volunteer Register) */}
      <PoliciesModal
        isOpen={showPoliciesModal}
        onClose={() => setShowPoliciesModal(false)}
      />
    </div>
  );
};

