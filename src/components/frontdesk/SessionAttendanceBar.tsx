import React, { useState } from 'react';
import {
  Users,
  AlertTriangle,
  CheckCircle2,
  Zap,
  ShieldCheck,
  BookOpen,
  UserCheck,
  Search,
  HeartPulse,
  Phone,
} from 'lucide-react';
import { Session, Volunteer } from '../../types';
import {
  updateSessionAttendance,
  markVolunteerInducted,
  getVolunteerById,
} from '../../services/volunteerService';

export interface SessionAttendanceBarProps {
  session: Session;
  volunteers: Volunteer[];
  currentUserEmail?: string | null;
  onRefreshVolunteers: () => Promise<void>;
  onOpenPolicies: () => void;
}

/**
 * Displays today's attending volunteers on the active session page at `/frontdesk`,
 * highlights any uninducted volunteers with a one-click induction confirmation,
 * opens an Emergency Contact Card when clicking any volunteer badge, and allows
 * organisers to add or remove late-arriving volunteers mid-session.
 */
export const SessionAttendanceBar: React.FC<SessionAttendanceBarProps> = ({
  session,
  volunteers,
  currentUserEmail,
  onRefreshVolunteers,
  onOpenPolicies,
}) => {
  // Modal state for editing the attending volunteer roster mid-session
  const [showAttendanceModal, setShowAttendanceModal] = useState(false);
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [modalSearch, setModalSearch] = useState('');
  const [savingAttendance, setSavingAttendance] = useState(false);

  // Modal state for viewing an attending volunteer's Emergency Contact Card
  const [emergencyVolunteer, setEmergencyVolunteer] =
    useState<Volunteer | null>(null);
  const [loadingEmergency, setLoadingEmergency] = useState(false);

  // Derive attending summaries and any uninducted or PAT-qualified attendees
  const attending = session.attendingVolunteers || [];
  const uninductedAttendees = attending.filter((v) => !v.inducted);
  const patTestersPresent = attending.filter((v) => v.isPatTrained);

  // Open the attendance editor modal pre-populated with current session attendees
  const handleOpenAttendanceModal = () => {
    setSelectedIds(attending.map((v) => v.id));
    setModalSearch('');
    setShowAttendanceModal(true);
  };

  // Toggle a volunteer's selection inside the attendance modal
  const toggleVolunteerSelection = (volunteerId: string) => {
    setSelectedIds((prev) =>
      prev.includes(volunteerId)
        ? prev.filter((id) => id !== volunteerId)
        : [...prev, volunteerId]
    );
  };

  // Open the Emergency Contact Card for an attending volunteer pill
  const handleInspectEmergencyContact = async (volunteerId: string) => {
    // Check in-memory volunteer props first before issuing a Firestore point-read
    const cached = volunteers.find((v) => v.id === volunteerId);
    if (cached) {
      setEmergencyVolunteer(cached);
      return;
    }

    // Fallback to a single `getDoc` read if the register list is not yet loaded
    setLoadingEmergency(true);
    try {
      const fetched = await getVolunteerById(volunteerId);
      if (fetched) {
        setEmergencyVolunteer(fetched);
      } else {
        alert('Volunteer record could not be found in the register.');
      }
    } catch (err: unknown) {
      // Surface any Firestore permission or connectivity error to the organiser
      const msg =
        err instanceof Error
          ? err.message
          : 'Failed to load emergency contact details.';
      alert(msg);
    } finally {
      setLoadingEmergency(false);
    }
  };

  // Save the updated attending volunteer list to the active Session document
  const handleSaveAttendance = async () => {
    setSavingAttendance(true);
    try {
      // Map selected IDs back to full Volunteer objects for summary projection
      const selectedObjects = volunteers.filter((v) =>
        selectedIds.includes(v.id)
      );
      await updateSessionAttendance(session.id, selectedObjects);
      setShowAttendanceModal(false);
    } catch (err: unknown) {
      // Alert organiser if updating the session attendance fails
      const msg =
        err instanceof Error
          ? err.message
          : 'Failed to update session attendance.';
      alert(msg);
    } finally {
      setSavingAttendance(false);
    }
  };

  // Complete policy induction for an attending volunteer directly from the session banner
  const handleCompleteInduction = async (volunteerId: string) => {
    try {
      // Persist induction confirmation and refresh the local register state
      await markVolunteerInducted(
        volunteerId,
        currentUserEmail || 'Organiser',
        session.id
      );
      await onRefreshVolunteers();
    } catch (err: unknown) {
      const msg =
        err instanceof Error ? err.message : 'Failed to record induction.';
      alert(msg);
    }
  };

  // Filter volunteers inside the modal search box
  const filteredModalVolunteers = volunteers.filter((v) => {
    const q = modalSearch.trim().toLowerCase();
    return !q || v.name.toLowerCase().includes(q);
  });

  // Check whether all currently visible (filtered) volunteers in the modal are selected
  const allFilteredSelected =
    filteredModalVolunteers.length > 0 &&
    filteredModalVolunteers.every((v) => selectedIds.includes(v.id));

  // Toggle selection for all currently visible (filtered) volunteers in the modal
  const handleToggleSelectAllVisible = () => {
    const visibleIds = filteredModalVolunteers.map((v) => v.id);
    if (allFilteredSelected) {
      // Deselect only the currently visible volunteers
      setSelectedIds((prev) => prev.filter((id) => !visibleIds.includes(id)));
    } else {
      // Add all currently visible volunteers without losing existing selections
      setSelectedIds((prev) => Array.from(new Set([...prev, ...visibleIds])));
    }
  };

  return (
    <div className="my-5 bg-white rounded-2xl border border-slate-200 shadow-sm p-4 space-y-3">
      {/* Top row: Attending volunteer count, PAT tester count, and action buttons */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          {/* Icon badge for the session attendance bar */}
          <div className="h-10 w-10 rounded-xl bg-blue-50 text-blue-700 flex items-center justify-center">
            <Users className="h-5 w-5" />
          </div>
          <div>
            {/* Heading and PAT-qualified counter badge */}
            <div className="flex flex-wrap items-center gap-2">
              <h3 className="text-sm font-black text-slate-900">
                Today&apos;s Attending Volunteers ({attending.length})
              </h3>
              <span className="text-xs font-semibold text-amber-800 bg-amber-50 px-2 py-0.5 rounded-lg border border-amber-200">
                {patTestersPresent.length} PAT Qualified Present
              </span>
            </div>
            {/* Helper note explaining station dropdown behavior and emergency card click */}
            <p className="text-xs text-slate-500">
              Click any volunteer badge for emergency contact details. Only
              attending volunteers appear in station dropdowns.
            </p>
          </div>
        </div>

        {/* Action buttons: View Policies and Edit Session Volunteers */}
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={onOpenPolicies}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl border border-slate-300 text-xs font-bold text-slate-700 hover:bg-slate-50"
          >
            <BookOpen className="h-3.5 w-3.5 text-emerald-700" />
            Policies
          </button>
          <button
            type="button"
            onClick={handleOpenAttendanceModal}
            className="inline-flex items-center gap-1.5 px-3.5 py-1.5 rounded-xl bg-blue-600 text-white text-xs font-bold hover:bg-blue-700 shadow-sm"
          >
            <UserCheck className="h-3.5 w-3.5" />
            Edit Session Volunteers
          </button>
        </div>
      </div>

      {/* Amber warning callout if any attending volunteer has not yet been inducted */}
      {uninductedAttendees.length > 0 && (
        <div className="p-3 rounded-xl bg-amber-50 border border-amber-300 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          {/* Warning description for uninducted session attendees */}
          <div className="flex items-start gap-2.5 text-xs text-amber-950">
            <AlertTriangle className="h-4 w-4 text-amber-600 flex-shrink-0 mt-0.5" />
            <div>
              <span className="font-bold block">
                Policy Induction Required Before Starting Repairs (
                {uninductedAttendees.length})
              </span>
              <span className="text-amber-800">
                Please brief uninducted volunteers on the Repair Café policies and
                click &ldquo;Complete Induction&rdquo; below.
              </span>
            </div>
          </div>

          {/* One-click induction confirmation buttons per uninducted attendee */}
          <div className="flex flex-wrap gap-1.5">
            {uninductedAttendees.map((u) => (
              <button
                key={u.id}
                type="button"
                onClick={() => handleCompleteInduction(u.id)}
                className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg bg-amber-700 text-white text-xs font-bold hover:bg-amber-800 shadow-sm"
              >
                <CheckCircle2 className="h-3.5 w-3.5" />
                Complete Induction: {u.name}
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Interactive pill list of attending volunteers (click to view Emergency Contact Card) */}
      {attending.length === 0 ? (
        <p className="text-xs italic text-slate-500">
          No volunteers selected for this session yet. Click &ldquo;Edit Session
          Volunteers&rdquo; to check in volunteers as they arrive.
        </p>
      ) : (
        <div className="flex flex-wrap gap-2 pt-1">
          {attending.map((v) => (
            <button
              key={v.id}
              type="button"
              disabled={loadingEmergency}
              onClick={() => handleInspectEmergencyContact(v.id)}
              title={`View emergency contact details for ${v.name}`}
              className={`inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-bold border transition-colors ${
                v.inducted
                  ? 'bg-slate-50 text-slate-800 border-slate-200 hover:bg-rose-50 hover:border-rose-200'
                  : 'bg-amber-100 text-amber-950 border-amber-300 hover:bg-amber-200'
              }`}
            >
              {/* Emergency pulse icon and volunteer name */}
              <HeartPulse className="h-3 w-3 text-rose-500" />
              <span>{v.name}</span>
              {/* Role and induction status indicators inside the pill */}
              {v.isOrganiser && (
                <ShieldCheck
                  className="h-3.5 w-3.5 text-blue-600"
                  title="Organiser"
                />
              )}
              {v.isPatTrained && (
                <Zap
                  className="h-3.5 w-3.5 text-amber-600"
                  title="PAT Trained"
                />
              )}
              {!v.inducted && (
                <span className="text-[10px] uppercase tracking-wide bg-amber-200 text-amber-900 px-1.5 py-0.5 rounded font-black">
                  Uninducted
                </span>
              )}
            </button>
          ))}
        </div>
      )}

      {/* Modal: Emergency Contact Quick-View Card from active session badge */}
      {emergencyVolunteer && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4">
          <div className="w-full max-w-sm rounded-2xl bg-white p-6 shadow-2xl border border-rose-200 text-left">
            {/* Modal header identifying the volunteer */}
            <div className="flex items-center gap-2 text-rose-700 font-black text-base mb-1">
              <HeartPulse className="h-5 w-5" />
              Emergency Contact Card
            </div>
            <p className="text-xs text-slate-500 mb-4">
              Attending Volunteer: <strong>{emergencyVolunteer.name}</strong>
            </p>

            {/* Emergency contact name, relationship, and clickable tel: link */}
            <div className="space-y-3 bg-rose-50/70 p-4 rounded-xl border border-rose-200 text-sm">
              <div>
                <span className="text-xs text-slate-500 block">
                  Emergency Contact Name
                </span>
                <span className="font-bold text-slate-900">
                  {emergencyVolunteer.emergencyContactName}
                  {emergencyVolunteer.emergencyContactRelationship
                    ? ` (${emergencyVolunteer.emergencyContactRelationship})`
                    : ''}
                </span>
              </div>
              {/* Emergency contact phone number link */}
              <div>
                <span className="text-xs text-slate-500 block">
                  Emergency Phone Number
                </span>
                <a
                  href={`tel:${emergencyVolunteer.emergencyContactPhone}`}
                  className="font-bold text-rose-700 underline flex items-center gap-1 mt-0.5"
                >
                  <Phone className="h-3.5 w-3.5" />
                  {emergencyVolunteer.emergencyContactPhone}
                </a>
              </div>
            </div>

            {/* Close button for Emergency Contact modal */}
            <button
              type="button"
              onClick={() => setEmergencyVolunteer(null)}
              className="mt-5 w-full py-2.5 rounded-xl bg-slate-800 text-xs font-bold text-white hover:bg-slate-900"
            >
              Close
            </button>
          </div>
        </div>
      )}

      {/* Modal: Edit Attending Volunteers during an active session */}
      {showAttendanceModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4">
          <div className="w-full max-w-lg rounded-3xl bg-white p-6 shadow-2xl border border-slate-200">
            {/* Modal title and instructions */}
            <h3 className="text-lg font-black text-slate-900">
              Update Session Attendance
            </h3>
            <p className="text-xs text-slate-500 mt-0.5">
              Select all volunteers present at {session.name} today. Late arrivals
              can be added at any time.
            </p>

            {/* Filter input inside modal */}
            <div className="relative mt-4">
              <Search className="h-4 w-4 absolute left-3.5 top-3 text-slate-400" />
              <input
                type="text"
                placeholder="Filter volunteers by name..."
                value={modalSearch}
                onChange={(e) => setModalSearch(e.target.value)}
                className="w-full pl-10 pr-4 py-2 rounded-xl border border-slate-300 text-sm focus:outline-none focus:ring-2 focus:ring-brand-500"
              />
            </div>

            {/* Scrollable checklist of registered volunteers */}
            <div className="mt-3 max-h-72 overflow-y-auto divide-y divide-slate-100 border border-slate-200 rounded-2xl">
              {filteredModalVolunteers.length === 0 ? (
                <div className="py-6 text-center text-xs text-slate-500">
                  No matching volunteers in the register. Add new volunteers via
                  the &ldquo;Volunteer Register&rdquo; tab.
                </div>
              ) : (
                filteredModalVolunteers.map((v) => {
                  const isChecked = selectedIds.includes(v.id);
                  return (
                    <label
                      key={v.id}
                      className={`flex items-center justify-between gap-3 px-4 py-2.5 cursor-pointer text-sm transition-colors ${
                        isChecked ? 'bg-blue-50/70' : 'hover:bg-slate-50'
                      }`}
                    >
                      {/* Checkbox and volunteer full name */}
                      <div className="flex items-center gap-3">
                        <input
                          type="checkbox"
                          checked={isChecked}
                          onChange={() => toggleVolunteerSelection(v.id)}
                          className="h-4 w-4 rounded border-slate-300 text-blue-600 focus:ring-blue-500"
                        />
                        <span className="font-bold text-slate-900">{v.name}</span>
                      </div>

                      {/* Role and induction status badges */}
                      <div className="flex items-center gap-1.5 text-xs">
                        {v.isPatTrained && (
                          <span className="px-2 py-0.5 rounded-full bg-amber-100 text-amber-900 font-bold">
                            PAT
                          </span>
                        )}
                        {v.isOrganiser && (
                          <span className="px-2 py-0.5 rounded-full bg-blue-100 text-blue-900 font-bold">
                            Organiser
                          </span>
                        )}
                        {!v.inducted && (
                          <span className="px-2 py-0.5 rounded-full bg-amber-200 text-amber-950 font-bold">
                            Induction Required
                          </span>
                        )}
                      </div>
                    </label>
                  );
                })
              )}
            </div>

            {/* Selection count and filter-aware Select All / Clear All toggle */}
            <div className="mt-4 flex items-center justify-between text-xs text-slate-500">
              <span>{selectedIds.length} volunteers selected</span>
              {filteredModalVolunteers.length > 0 && (
                <button
                  type="button"
                  onClick={handleToggleSelectAllVisible}
                  className="font-bold text-blue-700 hover:underline"
                >
                  {allFilteredSelected ? 'Clear Visible' : 'Select All Visible'}
                </button>
              )}
            </div>

            {/* Modal footer action buttons */}
            <div className="pt-4 flex gap-3">
              <button
                type="button"
                onClick={() => setShowAttendanceModal(false)}
                className="flex-1 py-2.5 rounded-xl border border-slate-300 text-sm font-semibold text-slate-700 hover:bg-slate-50"
              >
                Cancel
              </button>
              <button
                type="button"
                disabled={savingAttendance}
                onClick={handleSaveAttendance}
                className="flex-1 py-2.5 rounded-xl bg-blue-600 text-sm font-bold text-white hover:bg-blue-700 disabled:opacity-50 shadow-sm"
              >
                {savingAttendance ? 'Saving...' : 'Save Attendance'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
