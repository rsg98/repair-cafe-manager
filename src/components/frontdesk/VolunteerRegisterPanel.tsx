import React, { useState } from 'react';
import {
  UserPlus,
  Search,
  ShieldCheck,
  AlertTriangle,
  Zap,
  Phone,
  Mail,
  HeartPulse,
  Edit2,
  Trash2,
  BookOpen,
  CheckCircle2,
} from 'lucide-react';
import { Volunteer } from '../../types';
import {
  VolunteerInput,
  createVolunteer,
  updateVolunteer,
  deleteVolunteer,
  markVolunteerInducted,
} from '../../services/volunteerService';

export interface VolunteerRegisterPanelProps {
  volunteers: Volunteer[];
  loading: boolean;
  activeSessionId?: string | null;
  currentUserEmail?: string | null;
  onRefresh: () => Promise<void>;
  onOpenPolicies: () => void;
}

/**
 * Organiser panel at `/frontdesk` for maintaining the Volunteer Register:
 * adding/editing volunteers, recording emergency contact details, toggling
 * organiser and PAT-testing roles, and confirming policy induction.
 */
export const VolunteerRegisterPanel: React.FC<VolunteerRegisterPanelProps> = ({
  volunteers,
  loading,
  activeSessionId,
  currentUserEmail,
  onRefresh,
  onOpenPolicies,
}) => {
  // Search and filter state for the volunteer table
  const [searchTerm, setSearchTerm] = useState('');
  const [roleFilter, setRoleFilter] = useState<
    'ALL' | 'ORGANISER' | 'PAT_TRAINED' | 'UNINDUCTED'
  >('ALL');

  // Add / Edit modal form state for volunteer contact and emergency details
  const [showFormModal, setShowFormModal] = useState(false);
  const [editingVolunteerId, setEditingVolunteerId] = useState<string | null>(null);
  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [email, setEmail] = useState('');
  const [emergencyContactName, setEmergencyContactName] = useState('');
  const [emergencyContactPhone, setEmergencyContactPhone] = useState('');
  const [emergencyContactRelationship, setEmergencyContactRelationship] =
    useState('');

  // Role and policy induction form state inside the Add / Edit modal
  const [isOrganiser, setIsOrganiser] = useState(false);
  const [isPatTrained, setIsPatTrained] = useState(false);
  const [inducted, setInducted] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  // Emergency contact quick-view modal state
  const [selectedEmergencyVolunteer, setSelectedEmergencyVolunteer] =
    useState<Volunteer | null>(null);

  // Open the modal to register a brand-new volunteer with blank fields
  const handleOpenAddModal = () => {
    setEditingVolunteerId(null);
    setName('');
    setPhone('');
    setEmail('');
    setEmergencyContactName('');
    setEmergencyContactPhone('');
    setEmergencyContactRelationship('');
    // Reset role checkboxes and validation messages
    setIsOrganiser(false);
    setIsPatTrained(false);
    setInducted(false);
    setFormError(null);
    setShowFormModal(true);
  };

  // Open the modal pre-populated with an existing volunteer's details
  const handleOpenEditModal = (v: Volunteer) => {
    setEditingVolunteerId(v.id);
    setName(v.name);
    setPhone(v.phone || '');
    setEmail(v.email || '');
    setEmergencyContactName(v.emergencyContactName);
    setEmergencyContactPhone(v.emergencyContactPhone);
    setEmergencyContactRelationship(v.emergencyContactRelationship || '');
    // Populate role and induction flags from the selected volunteer record
    setIsOrganiser(Boolean(v.isOrganiser));
    setIsPatTrained(Boolean(v.isPatTrained));
    setInducted(Boolean(v.inducted));
    setFormError(null);
    setShowFormModal(true);
  };

  // Persist new or updated volunteer record to Firestore
  const handleSaveVolunteer = async (e: React.FormEvent) => {
    e.preventDefault();
    setFormError(null);
    setSaving(true);

    // Construct the input payload from modal form state
    const payload: VolunteerInput = {
      name,
      phone,
      email,
      emergencyContactName,
      emergencyContactPhone,
      emergencyContactRelationship,
      isOrganiser,
      isPatTrained,
      inducted,
      inductedBy: inducted ? currentUserEmail || 'Organiser' : undefined,
    };

    try {
      // Call create or update service helper and refresh local volunteer list
      if (editingVolunteerId) {
        await updateVolunteer(editingVolunteerId, payload, activeSessionId);
      } else {
        await createVolunteer(payload);
      }
      await onRefresh();
      setShowFormModal(false);
    } catch (err: unknown) {
      // Surface validation or Firestore errors inside the modal
      const msg =
        err instanceof Error ? err.message : 'Failed to save volunteer record.';
      setFormError(msg);
    } finally {
      setSaving(false);
    }
  };

  // One-click induction confirmation directly from the register row
  const handleQuickInduct = async (volunteer: Volunteer) => {
    try {
      // Record induction timestamp and refresh both register and active session
      await markVolunteerInducted(
        volunteer.id,
        currentUserEmail || 'Organiser',
        activeSessionId
      );
      await onRefresh();
    } catch (err: unknown) {
      const msg =
        err instanceof Error ? err.message : 'Failed to record induction.';
      alert(msg);
    }
  };

  // Remove a volunteer record after organiser confirmation and clean up active session attendance
  const handleDeleteVolunteer = async (volunteer: Volunteer) => {
    if (
      !confirm(
        `Remove "${volunteer.name}" from the Volunteer Register? This action cannot be undone.`
      )
    ) {
      return;
    }
    try {
      // Delete volunteer from Firestore, revoke organiser email, and remove from active session
      await deleteVolunteer(volunteer.id, activeSessionId);
      await onRefresh();
    } catch (err: unknown) {
      const msg =
        err instanceof Error ? err.message : 'Failed to delete volunteer.';
      alert(msg);
    }
  };

  // Filter volunteers by search query and role/induction filter
  const filteredVolunteers = volunteers.filter((v) => {
    const q = searchTerm.trim().toLowerCase();
    // Match against volunteer name, email, phone, or emergency contact name
    const matchesSearch =
      !q ||
      v.name.toLowerCase().includes(q) ||
      (v.email && v.email.toLowerCase().includes(q)) ||
      (v.phone && v.phone.toLowerCase().includes(q)) ||
      v.emergencyContactName.toLowerCase().includes(q);

    // Apply role and induction status dropdown filter
    if (!matchesSearch) return false;
    if (roleFilter === 'ORGANISER') return v.isOrganiser;
    if (roleFilter === 'PAT_TRAINED') return v.isPatTrained;
    if (roleFilter === 'UNINDUCTED') return !v.inducted;
    return true;
  });

  // Compute summary counts for the register header cards
  const inductedCount = volunteers.filter((v) => v.inducted).length;
  const patTrainedCount = volunteers.filter((v) => v.isPatTrained).length;
  const organiserCount = volunteers.filter((v) => v.isOrganiser).length;

  return (
    <div className="space-y-6">
      {/* Summary metrics cards for total, inducted, PAT-qualified, and organiser volunteers */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        {/* Card 1: Total registered volunteers */}
        <div className="bg-white p-4 rounded-2xl border border-slate-200 shadow-sm">
          <span className="text-xs font-semibold text-slate-500 uppercase">
            Total Registered
          </span>
          <p className="text-2xl font-black text-slate-900 mt-1">
            {volunteers.length}
          </p>
        </div>
        {/* Card 2: Volunteers who have completed policy induction */}
        <div className="bg-emerald-50 p-4 rounded-2xl border border-emerald-200 shadow-sm">
          <span className="text-xs font-semibold text-emerald-800 uppercase">
            Policy Inducted
          </span>
          <p className="text-2xl font-black text-emerald-900 mt-1">
            {inductedCount} / {volunteers.length}
          </p>
        </div>
        {/* Card 3: Volunteers trained to operate the PAT Station */}
        <div className="bg-amber-50 p-4 rounded-2xl border border-amber-200 shadow-sm">
          <span className="text-xs font-semibold text-amber-800 uppercase">
            PAT Qualified
          </span>
          <p className="text-2xl font-black text-amber-900 mt-1">
            {patTrainedCount}
          </p>
        </div>
        {/* Card 4: Volunteers granted Front Desk Organiser access */}
        <div className="bg-blue-50 p-4 rounded-2xl border border-blue-200 shadow-sm">
          <span className="text-xs font-semibold text-blue-800 uppercase">
            Session Organisers
          </span>
          <p className="text-2xl font-black text-blue-900 mt-1">
            {organiserCount}
          </p>
        </div>
      </div>

      {/* Search, filter, and Add Volunteer toolbar */}
      <div className="flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-3">
        <div className="flex flex-col sm:flex-row flex-1 gap-3">
          {/* Search box for name, email, phone, or emergency contact */}
          <div className="relative flex-1">
            <Search className="h-4 w-4 absolute left-3.5 top-3 text-slate-400" />
            <input
              type="text"
              placeholder="Search volunteers by name, email, phone, or emergency contact..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="w-full pl-10 pr-4 py-2.5 rounded-xl border border-slate-200 bg-white text-sm focus:outline-none focus:ring-2 focus:ring-brand-500 shadow-sm"
            />
          </div>

          {/* Role and induction status filter dropdown */}
          <select
            value={roleFilter}
            onChange={(e) =>
              setRoleFilter(
                e.target.value as
                  | 'ALL'
                  | 'ORGANISER'
                  | 'PAT_TRAINED'
                  | 'UNINDUCTED'
              )
            }
            className="px-4 py-2.5 rounded-xl border border-slate-200 bg-white text-sm focus:outline-none focus:ring-2 focus:ring-brand-500 shadow-sm"
          >
            <option value="ALL">All Volunteers ({volunteers.length})</option>
            <option value="UNINDUCTED">
              Needs Policy Induction ({volunteers.length - inductedCount})
            </option>
            <option value="PAT_TRAINED">PAT Trained ({patTrainedCount})</option>
            <option value="ORGANISER">Organisers ({organiserCount})</option>
          </select>
        </div>

        {/* Action buttons: View Policies and Add Volunteer */}
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={onOpenPolicies}
            className="inline-flex items-center gap-1.5 px-3.5 py-2.5 rounded-xl border border-slate-300 bg-white text-slate-700 font-bold text-xs hover:bg-slate-50 shadow-sm"
          >
            <BookOpen className="h-4 w-4 text-emerald-700" />
            View Policies
          </button>

          <button
            type="button"
            onClick={handleOpenAddModal}
            className="inline-flex items-center gap-2 px-4 py-2.5 rounded-xl bg-brand-600 text-white font-bold text-sm hover:bg-brand-700 shadow-sm transition-colors"
          >
            <UserPlus className="h-4 w-4" /> Add Volunteer
          </button>
        </div>
      </div>

      {/* Volunteer Register Table */}
      <div className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm">
            {/* Table column headers */}
            <thead className="bg-slate-50 border-b border-slate-200 text-xs font-bold text-slate-500 uppercase tracking-wider">
              <tr>
                <th className="py-3 px-4">Volunteer Name</th>
                <th className="py-3 px-4">Contact Details</th>
                <th className="py-3 px-4">Emergency Contact</th>
                <th className="py-3 px-4">Roles &amp; Skills</th>
                <th className="py-3 px-4">Policy Induction</th>
                <th className="py-3 px-4 text-right">Actions</th>
              </tr>
            </thead>
            {/* Table body with loading, empty state, and volunteer rows */}
            <tbody className="divide-y divide-slate-100 font-medium">
              {loading ? (
                <tr>
                  <td colSpan={6} className="py-8 text-center text-slate-500">
                    Loading Volunteer Register...
                  </td>
                </tr>
              ) : filteredVolunteers.length === 0 ? (
                <tr>
                  <td colSpan={6} className="py-8 text-center text-slate-500">
                    No volunteers found matching your search. Click &ldquo;Add
                    Volunteer&rdquo; to register one.
                  </td>
                </tr>
              ) : (
                filteredVolunteers.map((v) => (
                  <tr key={v.id} className="hover:bg-slate-50/80 transition-colors">
                    {/* Volunteer full name column */}
                    <td className="py-3.5 px-4 whitespace-nowrap font-bold text-slate-900">
                      {v.name}
                    </td>

                    {/* Contact Phone & Email column */}
                    <td className="py-3.5 px-4 text-xs text-slate-600 space-y-1">
                      {v.phone ? (
                        <div className="flex items-center gap-1.5">
                          <Phone className="h-3.5 w-3.5 text-slate-400" />
                          <a
                            href={`tel:${v.phone}`}
                            className="hover:underline text-slate-800"
                          >
                            {v.phone}
                          </a>
                        </div>
                      ) : null}
                      {/* Volunteer email address if provided */}
                      {v.email ? (
                        <div className="flex items-center gap-1.5">
                          <Mail className="h-3.5 w-3.5 text-slate-400" />
                          <span className="text-slate-700">{v.email}</span>
                        </div>
                      ) : null}
                      {!v.phone && !v.email && (
                        <span className="italic text-slate-400">Not provided</span>
                      )}
                    </td>

                    {/* Emergency Contact Summary button opening quick-view card */}
                    <td className="py-3.5 px-4 text-xs">
                      <button
                        type="button"
                        onClick={() => setSelectedEmergencyVolunteer(v)}
                        className="text-left group hover:bg-rose-50 p-1.5 -m-1.5 rounded-xl transition-colors"
                        title="View emergency contact card"
                      >
                        <div className="font-bold text-slate-800 flex items-center gap-1">
                          <HeartPulse className="h-3.5 w-3.5 text-rose-600" />
                          {v.emergencyContactName}
                          {v.emergencyContactRelationship && (
                            <span className="text-slate-500 font-normal">
                              ({v.emergencyContactRelationship})
                            </span>
                          )}
                        </div>
                        <div className="text-rose-700 font-semibold mt-0.5">
                          {v.emergencyContactPhone}
                        </div>
                      </button>
                    </td>

                    {/* Roles: Organiser & PAT Trained badges */}
                    <td className="py-3.5 px-4 whitespace-nowrap space-x-1.5">
                      {v.isOrganiser && (
                        <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-xs font-bold bg-blue-100 text-blue-900">
                          <ShieldCheck className="h-3 w-3" /> Organiser
                        </span>
                      )}
                      {v.isPatTrained && (
                        <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-xs font-bold bg-amber-100 text-amber-900">
                          <Zap className="h-3 w-3" /> PAT Tester
                        </span>
                      )}
                      {!v.isOrganiser && !v.isPatTrained && (
                        <span className="text-xs text-slate-500 bg-slate-100 px-2.5 py-0.5 rounded-full">
                          Fixer / General
                        </span>
                      )}
                    </td>

                    {/* Policy Induction Status & one-click confirmation button */}
                    <td className="py-3.5 px-4 whitespace-nowrap">
                      {v.inducted ? (
                        <span className="inline-flex items-center gap-1 text-xs font-bold text-emerald-800 bg-emerald-100 px-2.5 py-1 rounded-lg">
                          <CheckCircle2 className="h-3.5 w-3.5 text-emerald-700" />
                          Inducted
                        </span>
                      ) : (
                        <div className="flex items-center gap-2">
                          <span className="inline-flex items-center gap-1 text-xs font-bold text-amber-900 bg-amber-100 px-2.5 py-1 rounded-lg border border-amber-300">
                            <AlertTriangle className="h-3.5 w-3.5 text-amber-700" />
                            Induction Required
                          </span>
                          {/* Quick button to confirm policy induction */}
                          <button
                            type="button"
                            onClick={() => handleQuickInduct(v)}
                            className="px-2.5 py-1 rounded-lg bg-emerald-700 text-white text-xs font-bold hover:bg-emerald-800 shadow-sm"
                          >
                            Confirm Inducted
                          </button>
                        </div>
                      )}
                    </td>

                    {/* Row Edit / Delete Actions */}
                    <td className="py-3.5 px-4 text-right whitespace-nowrap space-x-1">
                      <button
                        type="button"
                        onClick={() => handleOpenEditModal(v)}
                        title="Edit volunteer details"
                        className="p-1.5 rounded-lg text-slate-500 hover:text-slate-900 hover:bg-slate-100 transition-colors"
                      >
                        <Edit2 className="h-4 w-4 inline" />
                      </button>
                      <button
                        type="button"
                        onClick={() => handleDeleteVolunteer(v)}
                        title="Remove volunteer from register"
                        className="p-1.5 rounded-lg text-slate-400 hover:text-rose-700 hover:bg-rose-50 transition-colors"
                      >
                        <Trash2 className="h-4 w-4 inline" />
                      </button>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Modal: Emergency Contact Quick-View Card */}
      {selectedEmergencyVolunteer && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4">
          <div className="w-full max-w-sm rounded-2xl bg-white p-6 shadow-2xl border border-rose-200 text-left">
            {/* Modal title and volunteer name */}
            <div className="flex items-center gap-2 text-rose-700 font-black text-base mb-1">
              <HeartPulse className="h-5 w-5" />
              Emergency Contact Card
            </div>
            <p className="text-xs text-slate-500 mb-4">
              Volunteer: <strong>{selectedEmergencyVolunteer.name}</strong>
            </p>

            {/* Emergency contact name and clickable telephone link */}
            <div className="space-y-3 bg-rose-50/70 p-4 rounded-xl border border-rose-200 text-sm">
              <div>
                <span className="text-xs text-slate-500 block">
                  Emergency Contact Name
                </span>
                <span className="font-bold text-slate-900">
                  {selectedEmergencyVolunteer.emergencyContactName}
                  {selectedEmergencyVolunteer.emergencyContactRelationship
                    ? ` (${selectedEmergencyVolunteer.emergencyContactRelationship})`
                    : ''}
                </span>
              </div>
              {/* Emergency phone link */}
              <div>
                <span className="text-xs text-slate-500 block">
                  Emergency Phone Number
                </span>
                <a
                  href={`tel:${selectedEmergencyVolunteer.emergencyContactPhone}`}
                  className="font-bold text-rose-700 underline flex items-center gap-1 mt-0.5"
                >
                  <Phone className="h-3.5 w-3.5" />
                  {selectedEmergencyVolunteer.emergencyContactPhone}
                </a>
              </div>
            </div>

            {/* Dismiss Emergency Contact modal */}
            <button
              type="button"
              onClick={() => setSelectedEmergencyVolunteer(null)}
              className="mt-5 w-full py-2.5 rounded-xl bg-slate-800 text-xs font-bold text-white hover:bg-slate-900"
            >
              Close
            </button>
          </div>
        </div>
      )}

      {/* Modal: Add or Edit Volunteer */}
      {showFormModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4 overflow-y-auto">
          <div className="w-full max-w-lg rounded-3xl bg-white p-6 shadow-2xl border border-slate-200 my-8">
            {/* Modal header and mandatory emergency contact subtitle */}
            <h3 className="text-lg font-black text-slate-900">
              {editingVolunteerId ? 'Edit Volunteer Record' : 'Add New Volunteer'}
            </h3>
            <p className="text-xs text-slate-500 mt-0.5">
              Emergency contact details are mandatory for all volunteers.
            </p>

            {/* Validation error banner if submission fails */}
            {formError && (
              <div className="mt-3 p-3 rounded-xl bg-rose-50 border border-rose-200 text-rose-800 text-xs font-bold">
                {formError}
              </div>
            )}

            <form onSubmit={handleSaveVolunteer} className="mt-4 space-y-4">
              {/* Volunteer Full Name input */}
              <div>
                <label className="block text-xs font-bold text-slate-700 mb-1">
                  Volunteer Full Name <span className="text-rose-600">*</span>
                </label>
                <input
                  type="text"
                  required
                  placeholder="e.g. Alice Thompson"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  className="w-full px-3.5 py-2 rounded-xl border border-slate-300 text-sm focus:outline-none focus:ring-2 focus:ring-brand-500"
                />
              </div>

              {/* Optional Phone & Conditional Email inputs */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                {/* Volunteer optional phone number */}
                <div>
                  <label className="block text-xs font-bold text-slate-700 mb-1">
                    Contact Phone (Optional)
                  </label>
                  <input
                    type="tel"
                    placeholder="e.g. 07700 900123"
                    value={phone}
                    onChange={(e) => setPhone(e.target.value)}
                    className="w-full px-3.5 py-2 rounded-xl border border-slate-300 text-sm focus:outline-none focus:ring-2 focus:ring-brand-500"
                  />
                </div>

                {/* Volunteer email address (mandatory when Organiser is checked) */}
                <div>
                  <label className="block text-xs font-bold text-slate-700 mb-1">
                    Email Address{' '}
                    {isOrganiser ? (
                      <span className="text-rose-600">
                        * (Required for Organiser)
                      </span>
                    ) : (
                      '(Optional)'
                    )}
                  </label>
                  <input
                    type="email"
                    required={isOrganiser}
                    placeholder="e.g. alice@example.com"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    className="w-full px-3.5 py-2 rounded-xl border border-slate-300 text-sm focus:outline-none focus:ring-2 focus:ring-brand-500"
                  />
                </div>
              </div>

              {/* Emergency Contact Section (must be another person with a distinct phone) */}
              <div className="p-4 rounded-2xl bg-rose-50/50 border border-rose-200 space-y-3">
                <div className="text-xs font-bold text-rose-900 uppercase tracking-wider flex items-center gap-1.5">
                  <HeartPulse className="h-4 w-4 text-rose-600" />
                  Emergency Contact (Another Person)
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  {/* Emergency contact full name */}
                  <div>
                    <label className="block text-xs font-bold text-slate-700 mb-1">
                      Contact Name <span className="text-rose-600">*</span>
                    </label>
                    <input
                      type="text"
                      required
                      placeholder="e.g. David Thompson"
                      value={emergencyContactName}
                      onChange={(e) => setEmergencyContactName(e.target.value)}
                      className="w-full px-3 py-2 rounded-xl border border-slate-300 bg-white text-sm focus:outline-none focus:ring-2 focus:ring-brand-500"
                    />
                  </div>

                  {/* Emergency contact phone number */}
                  <div>
                    <label className="block text-xs font-bold text-slate-700 mb-1">
                      Emergency Phone <span className="text-rose-600">*</span>
                    </label>
                    <input
                      type="tel"
                      required
                      placeholder="e.g. 07700 900456"
                      value={emergencyContactPhone}
                      onChange={(e) => setEmergencyContactPhone(e.target.value)}
                      className="w-full px-3 py-2 rounded-xl border border-slate-300 bg-white text-sm focus:outline-none focus:ring-2 focus:ring-brand-500"
                    />
                  </div>
                </div>

                {/* Optional relationship to the volunteer */}
                <div>
                  <label className="block text-xs font-bold text-slate-700 mb-1">
                    Relationship (Optional)
                  </label>
                  <input
                    type="text"
                    placeholder="e.g. Partner, Parent, Sibling, Friend"
                    value={emergencyContactRelationship}
                    onChange={(e) =>
                      setEmergencyContactRelationship(e.target.value)
                    }
                    className="w-full px-3 py-2 rounded-xl border border-slate-300 bg-white text-sm focus:outline-none focus:ring-2 focus:ring-brand-500"
                  />
                </div>
              </div>

              {/* Role & Policy Induction Checkboxes */}
              <div className="space-y-2.5 pt-1">
                {/* Organiser checkbox granting Front Desk sign-in access */}
                <label className="flex items-start gap-2.5 p-2.5 rounded-xl border border-slate-200 hover:bg-slate-50 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={isOrganiser}
                    onChange={(e) => setIsOrganiser(e.target.checked)}
                    className="mt-0.5 h-4 w-4 rounded border-slate-300 text-brand-600 focus:ring-brand-500"
                  />
                  <div className="text-xs">
                    <span className="font-bold text-slate-900 block">
                      Session Organiser (Front Desk Admin Access)
                    </span>
                    <span className="text-slate-500">
                      Grants Google Sign-In access to the Front Desk using their
                      email address.
                    </span>
                  </div>
                </label>

                {/* PAT Electrical Safety Trained checkbox */}
                <label className="flex items-start gap-2.5 p-2.5 rounded-xl border border-slate-200 hover:bg-slate-50 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={isPatTrained}
                    onChange={(e) => setIsPatTrained(e.target.checked)}
                    className="mt-0.5 h-4 w-4 rounded border-slate-300 text-amber-600 focus:ring-amber-500"
                  />
                  <div className="text-xs">
                    <span className="font-bold text-slate-900 block">
                      PAT Electrical Safety Trained
                    </span>
                    <span className="text-slate-500">
                      Authorizes this volunteer to appear in the Tester Name
                      dropdown at the PAT Station.
                    </span>
                  </div>
                </label>

                {/* Confirmed Policy Induction checkbox + Read Policies shortcut */}
                <div className="flex items-start justify-between gap-2.5 p-2.5 rounded-xl border border-emerald-200 bg-emerald-50/50">
                  <label className="flex items-start gap-2.5 cursor-pointer flex-1">
                    <input
                      type="checkbox"
                      checked={inducted}
                      onChange={(e) => setInducted(e.target.checked)}
                      className="mt-0.5 h-4 w-4 rounded border-slate-300 text-emerald-600 focus:ring-emerald-500"
                    />
                    <div className="text-xs">
                      <span className="font-bold text-emerald-950 block">
                        Confirmed Policy Induction Completed
                      </span>
                      <span className="text-slate-600">
                        Volunteer has been briefed on Repair Café Health &amp;
                        Safety, Safeguarding, and Data Protection policies.
                      </span>
                    </div>
                  </label>
                  <button
                    type="button"
                    onClick={onOpenPolicies}
                    className="text-xs font-bold text-emerald-800 underline whitespace-nowrap"
                  >
                    Read Policies
                  </button>
                </div>
              </div>

              {/* UK GDPR Privacy Notice for volunteer and emergency contact PII */}
              <div className="p-3 rounded-xl bg-slate-50 border border-slate-200 text-[11px] text-slate-600 leading-relaxed">
                <strong className="text-slate-800">UK GDPR Privacy Notice:</strong>{' '}
                Volunteer contact and emergency contact details are stored solely
                for session coordination and Health &amp; Safety emergency
                response. Access is restricted strictly to authenticated Repair
                Café organisers and is never shared with public or volunteer
                tablets. Records are removed upon request when a volunteer leaves.
              </div>

              {/* Modal Footer Buttons */}
              <div className="pt-2 flex gap-3">
                <button
                  type="button"
                  onClick={() => setShowFormModal(false)}
                  className="flex-1 py-2.5 rounded-xl border border-slate-300 text-sm font-semibold text-slate-700 hover:bg-slate-50"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={saving}
                  className="flex-1 py-2.5 rounded-xl bg-brand-600 text-sm font-bold text-white hover:bg-brand-700 disabled:opacity-50 shadow-sm"
                >
                  {saving
                    ? 'Saving...'
                    : editingVolunteerId
                      ? 'Save Changes'
                      : 'Add to Register'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};
