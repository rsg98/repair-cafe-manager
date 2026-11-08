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
  Archive,
  RotateCcw,
  MessageCircle,
  ExternalLink,
  Copy,
} from 'lucide-react';
import { Volunteer, WhatsAppSyncStatus } from '../../types';
import {
  VolunteerInput,
  ArchiveWhatsAppDisposition,
  createVolunteer,
  updateVolunteer,
  deleteVolunteer,
  markVolunteerInducted,
  archiveVolunteer,
  restoreVolunteer,
  formatArchivedVolunteerName,
  validateArchiveConfirmationName,
  canArchiveVolunteer,
  requiresWhatsAppArchiveDecision,
  formatWhatsAppDeepLink,
  updateVolunteerWhatsAppStatus,
} from '../../services/volunteerService';
import { useRegisterUnsavedWork } from '../../context/UnsavedWorkContext';
import { useDialogFocusTrap } from '../../hooks/useDialogFocusTrap';

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
    | 'ALL'
    | 'ORGANISER'
    | 'PAT_TRAINED'
    | 'UNINDUCTED'
    | 'WHATSAPP_ACTION'
    | 'ALT_COMMS'
    | 'ARCHIVED'
  >('ALL');
  const [showArchived, setShowArchived] = useState(false);

  // Add / Edit / Restore modal form state for volunteer contact and emergency details
  const [showFormModal, setShowFormModal] = useState(false);
  const [editingVolunteerId, setEditingVolunteerId] = useState<string | null>(null);
  const [isRestoringVolunteer, setIsRestoringVolunteer] = useState(false);
  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [email, setEmail] = useState('');
  const [emergencyContactName, setEmergencyContactName] = useState('');
  const [emergencyContactPhone, setEmergencyContactPhone] = useState('');
  const [emergencyContactRelationship, setEmergencyContactRelationship] =
    useState('');

  // Role, policy induction, and WhatsApp group state inside the Add / Edit modal
  const [isOrganiser, setIsOrganiser] = useState(false);
  const [isPatTrained, setIsPatTrained] = useState(false);
  const [inducted, setInducted] = useState(false);
  const [whatsappOptIn, setWhatsappOptIn] = useState(false);
  const [markWhatsAppAddedImmediately, setMarkWhatsAppAddedImmediately] =
    useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  // Archive volunteer confirmation modal state
  const [archivingVolunteer, setArchivingVolunteer] = useState<Volunteer | null>(
    null
  );
  const [archiveConfirmName, setArchiveConfirmName] = useState('');
  const [archiveWhatsappDisposition, setArchiveWhatsappDisposition] =
    useState<ArchiveWhatsAppDisposition | null>(null);
  const [archiveError, setArchiveError] = useState<string | null>(null);
  const [archiving, setArchiving] = useState(false);

  // Emergency contact quick-view modal state
  const [selectedEmergencyVolunteer, setSelectedEmergencyVolunteer] =
    useState<Volunteer | null>(null);

  // Alternative Comms (Non-WhatsApp volunteers) broadcast helper modal state
  const [showAltCommsModal, setShowAltCommsModal] = useState(false);
  const [altCommsCopyFeedback, setAltCommsCopyFeedback] = useState<string | null>(
    null
  );

  // Prevent automatic PWA reload while adding/editing/archiving a volunteer or viewing modals
  useRegisterUnsavedWork(
    showFormModal ||
      saving ||
      selectedEmergencyVolunteer !== null ||
      archivingVolunteer !== null ||
      archiving ||
      showAltCommsModal,
    'volunteer-register-panel'
  );

  // Focus trap and Escape key dismissal for Emergency Contact, Archive, Alt Comms, and Add/Edit Volunteer modals
  const emergencyModalRef = useDialogFocusTrap({
    isOpen: Boolean(selectedEmergencyVolunteer),
    onClose: () => setSelectedEmergencyVolunteer(null),
  });
  const formModalRef = useDialogFocusTrap({
    isOpen: showFormModal,
    onClose: () => {
      setIsRestoringVolunteer(false);
      setShowFormModal(false);
    },
  });
  const archiveModalRef = useDialogFocusTrap({
    isOpen: Boolean(archivingVolunteer),
    onClose: () => {
      if (!archiving) {
        setArchivingVolunteer(null);
        setArchiveConfirmName('');
        setArchiveWhatsappDisposition(null);
        setArchiveError(null);
      }
    },
  });
  const altCommsModalRef = useDialogFocusTrap({
    isOpen: showAltCommsModal,
    onClose: () => {
      setShowAltCommsModal(false);
      setAltCommsCopyFeedback(null);
    },
  });

  // Open the modal to register a brand-new volunteer with blank fields
  const handleOpenAddModal = () => {
    setEditingVolunteerId(null);
    setIsRestoringVolunteer(false);
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
    setWhatsappOptIn(false);
    setMarkWhatsAppAddedImmediately(false);
    setFormError(null);
    setShowFormModal(true);
  };

  // Open the modal pre-populated with an existing volunteer's details
  const handleOpenEditModal = (v: Volunteer) => {
    setEditingVolunteerId(v.id);
    setIsRestoringVolunteer(false);
    setName(v.name);
    setPhone(v.phone || '');
    setEmail(v.email || '');
    setEmergencyContactName(v.emergencyContactName);
    setEmergencyContactPhone(v.emergencyContactPhone);
    setEmergencyContactRelationship(v.emergencyContactRelationship || '');
    // Populate role, induction, and WhatsApp flags from the selected volunteer record
    setIsOrganiser(Boolean(v.isOrganiser));
    setIsPatTrained(Boolean(v.isPatTrained));
    setInducted(Boolean(v.inducted));
    setWhatsappOptIn(Boolean(v.whatsappOptIn));
    setMarkWhatsAppAddedImmediately(v.whatsappStatus === 'ADDED');
    setFormError(null);
    setShowFormModal(true);
  };

  // Open the modal to restore an archived volunteer by re-entering their full name and emergency contact
  const handleOpenRestoreModal = (v: Volunteer) => {
    setEditingVolunteerId(v.id);
    setIsRestoringVolunteer(true);
    setName(v.name);
    setPhone('');
    setEmail('');
    setEmergencyContactName('');
    setEmergencyContactPhone('');
    setEmergencyContactRelationship('');
    // Retain existing PAT-trained, induction, and social WhatsApp status while requiring fresh contact details
    setIsOrganiser(false);
    setIsPatTrained(Boolean(v.isPatTrained));
    setInducted(Boolean(v.inducted));
    setWhatsappOptIn(Boolean(v.whatsappOptIn));
    setMarkWhatsAppAddedImmediately(v.whatsappStatus === 'ADDED');
    setFormError(null);
    setShowFormModal(true);
  };

  // Open the GDPR archival confirmation modal for an active volunteer
  const handleOpenArchiveModal = (v: Volunteer) => {
    setArchivingVolunteer(v);
    setArchiveConfirmName('');
    setArchiveWhatsappDisposition(null);
    setArchiveError(null);
  };

  // Confirm archival and GDPR redaction after verifying full-name entry and WhatsApp disposition
  const handleConfirmArchive = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!archivingVolunteer) return;
    setArchiveError(null);
    setArchiving(true);

    try {
      await archiveVolunteer(
        archivingVolunteer.id,
        archiveConfirmName,
        activeSessionId,
        requiresWhatsAppArchiveDecision(archivingVolunteer)
          ? { whatsappDisposition: archiveWhatsappDisposition ?? undefined }
          : undefined
      );
      await onRefresh();
      setArchivingVolunteer(null);
      setArchiveConfirmName('');
      setArchiveWhatsappDisposition(null);
    } catch (err: unknown) {
      const msg =
        err instanceof Error ? err.message : 'Failed to archive volunteer.';
      setArchiveError(msg);
    } finally {
      setArchiving(false);
    }
  };

  // Persist new, updated, or restored volunteer record to Firestore
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
      whatsappOptIn,
      markWhatsAppAddedImmediately: whatsappOptIn
        ? markWhatsAppAddedImmediately
        : false,
    };

    try {
      // Call restore, update, or create service helper and refresh local volunteer list
      if (editingVolunteerId && isRestoringVolunteer) {
        await restoreVolunteer(editingVolunteerId, payload, activeSessionId);
      } else if (editingVolunteerId) {
        await updateVolunteer(editingVolunteerId, payload, activeSessionId);
      } else {
        await createVolunteer(payload);
      }
      await onRefresh();
      setIsRestoringVolunteer(false);
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

  // One-click WhatsApp group status transition directly from the register row ("Mark Added" or "Confirm Removed")
  const handleQuickWhatsAppStatus = async (
    volunteer: Volunteer,
    nextStatus: WhatsAppSyncStatus
  ) => {
    try {
      await updateVolunteerWhatsAppStatus(volunteer.id, nextStatus);
      await onRefresh();
    } catch (err: unknown) {
      const msg =
        err instanceof Error
          ? err.message
          : 'Failed to update WhatsApp status.';
      alert(msg);
    }
  };

  // Copy comma-separated list of emails or SMS numbers for non-WhatsApp volunteers to clipboard
  const handleCopyAltCommsList = async (textToCopy: string, label: string) => {
    if (!textToCopy.trim()) return;
    try {
      if (navigator.clipboard && navigator.clipboard.writeText) {
        await navigator.clipboard.writeText(textToCopy);
        setAltCommsCopyFeedback(`Copied ${label} to clipboard.`);
      }
    } catch {
      setAltCommsCopyFeedback(`Could not copy ${label} automatically.`);
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

  // Separate active and archived volunteers so archived users are excluded by default
  const activeVolunteers = volunteers.filter((v) => !v.archived);
  const archivedVolunteers = volunteers.filter((v) => Boolean(v.archived));

  // Derive WhatsApp and Alt-Channel counts for active volunteers
  const whatsappAddedCount = activeVolunteers.filter(
    (v) => v.whatsappStatus === 'ADDED'
  ).length;
  const whatsappActionCount = activeVolunteers.filter(
    (v) =>
      v.whatsappStatus === 'PENDING_ADD' ||
      v.whatsappStatus === 'PENDING_REMOVAL'
  ).length;
  const nonWhatsAppVolunteers = activeVolunteers.filter(
    (v) => !v.whatsappOptIn && v.whatsappStatus !== 'PENDING_REMOVAL'
  );
  const nonWhatsAppEmails = nonWhatsAppVolunteers
    .map((v) => v.email?.trim())
    .filter((e): e is string => Boolean(e));
  const nonWhatsAppPhones = nonWhatsAppVolunteers
    .map((v) => v.phone?.trim())
    .filter((p): p is string => Boolean(p));

  // Filter volunteers by archived visibility, search query, and role/induction/comms filter
  const filteredVolunteers = volunteers.filter((v) => {
    // Filter out archived users by default unless "ARCHIVED" filter or "Show Archived" toggle is active
    if (roleFilter === 'ARCHIVED') {
      if (!v.archived) return false;
    } else if (!showArchived && v.archived) {
      return false;
    }

    const q = searchTerm.trim().toLowerCase();
    // Match against volunteer name, email, phone, or emergency contact name
    const matchesSearch =
      !q ||
      v.name.toLowerCase().includes(q) ||
      (v.email && v.email.toLowerCase().includes(q)) ||
      (v.phone && v.phone.toLowerCase().includes(q)) ||
      v.emergencyContactName.toLowerCase().includes(q);

    // Apply role, induction, and WhatsApp/alt-comms dropdown filter
    if (!matchesSearch) return false;
    if (roleFilter === 'ORGANISER') return v.isOrganiser && !v.archived;
    if (roleFilter === 'PAT_TRAINED') return v.isPatTrained && !v.archived;
    if (roleFilter === 'UNINDUCTED') return !v.inducted && !v.archived;
    if (roleFilter === 'WHATSAPP_ACTION') {
      return (
        !v.archived &&
        (v.whatsappStatus === 'PENDING_ADD' ||
          v.whatsappStatus === 'PENDING_REMOVAL')
      );
    }
    if (roleFilter === 'ALT_COMMS') {
      return (
        !v.archived &&
        !v.whatsappOptIn &&
        v.whatsappStatus !== 'PENDING_REMOVAL'
      );
    }
    return true;
  });

  // Compute summary counts from active (non-archived) volunteers for the register header cards
  const inductedCount = activeVolunteers.filter((v) => v.inducted).length;
  const patTrainedCount = activeVolunteers.filter((v) => v.isPatTrained).length;
  const organiserCount = activeVolunteers.filter((v) => v.isOrganiser).length;

  return (
    <div className="space-y-6">
      {/* Summary metrics cards for active, inducted, PAT-qualified, organiser, and WhatsApp comms */}
      <div className="grid grid-cols-2 sm:grid-cols-5 gap-3">
        {/* Card 1: Total active registered volunteers */}
        <div className="bg-white p-4 rounded-2xl border border-slate-200 shadow-sm">
          <span className="text-xs font-semibold text-slate-500 uppercase">
            Active Registered
          </span>
          <p className="text-2xl font-black text-slate-900 mt-1">
            {activeVolunteers.length}
          </p>
          {archivedVolunteers.length > 0 && (
            <span className="text-[11px] font-semibold text-slate-600 block mt-0.5">
              +{archivedVolunteers.length} archived
            </span>
          )}
        </div>
        {/* Card 2: Active volunteers who have completed policy induction */}
        <div className="bg-emerald-50 p-4 rounded-2xl border border-emerald-200 shadow-sm">
          <span className="text-xs font-semibold text-emerald-800 uppercase">
            Policy Inducted
          </span>
          <p className="text-2xl font-black text-emerald-900 mt-1">
            {inductedCount} / {activeVolunteers.length}
          </p>
        </div>
        {/* Card 3: Active volunteers trained to operate the PAT Station */}
        <div className="bg-amber-50 p-4 rounded-2xl border border-amber-200 shadow-sm">
          <span className="text-xs font-semibold text-amber-800 uppercase">
            PAT Qualified
          </span>
          <p className="text-2xl font-black text-amber-900 mt-1">
            {patTrainedCount}
          </p>
        </div>
        {/* Card 4: Active volunteers granted Front Desk Organiser access */}
        <div className="bg-blue-50 p-4 rounded-2xl border border-blue-200 shadow-sm">
          <span className="text-xs font-semibold text-blue-800 uppercase">
            Session Organisers
          </span>
          <p className="text-2xl font-black text-blue-900 mt-1">
            {organiserCount}
          </p>
        </div>
        {/* Card 5: WhatsApp Group & Alt-Channel Comms summary */}
        <div className="bg-teal-50 p-4 rounded-2xl border border-teal-200 shadow-sm col-span-2 sm:col-span-1">
          <span className="text-xs font-semibold text-teal-900 uppercase">
            In WhatsApp
          </span>
          <p className="text-2xl font-black text-teal-950 mt-1">
            {whatsappAddedCount} / {activeVolunteers.length}
          </p>
          <span className="text-[11px] font-semibold text-teal-900 block mt-0.5">
            {whatsappActionCount > 0
              ? `${whatsappActionCount} pending sync`
              : `${nonWhatsAppVolunteers.length} alt channel`}
          </span>
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
              aria-label="Search volunteers by name, email, phone, or emergency contact"
              placeholder="Search volunteers by name, email, phone, or emergency contact..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="w-full pl-10 pr-4 py-2.5 rounded-xl border border-slate-200 bg-white text-sm focus:outline-none focus:ring-2 focus:ring-brand-500 shadow-sm"
            />
          </div>

          {/* Role, induction, WhatsApp, and archived status filter dropdown */}
          <select
            aria-label="Filter volunteers by role or induction status"
            value={roleFilter}
            onChange={(e) =>
              setRoleFilter(
                e.target.value as
                  | 'ALL'
                  | 'ORGANISER'
                  | 'PAT_TRAINED'
                  | 'UNINDUCTED'
                  | 'WHATSAPP_ACTION'
                  | 'ALT_COMMS'
                  | 'ARCHIVED'
              )
            }
            className="px-4 py-2.5 rounded-xl border border-slate-200 bg-white text-sm focus:outline-none focus:ring-2 focus:ring-brand-500 shadow-sm"
          >
            <option value="ALL">
              Active Volunteers ({activeVolunteers.length})
            </option>
            <option value="UNINDUCTED">
              Needs Policy Induction ({activeVolunteers.length - inductedCount})
            </option>
            <option value="WHATSAPP_ACTION">
              WhatsApp Action Needed ({whatsappActionCount})
            </option>
            <option value="ALT_COMMS">
              Non-WhatsApp / Alt Channel ({nonWhatsAppVolunteers.length})
            </option>
            <option value="PAT_TRAINED">PAT Trained ({patTrainedCount})</option>
            <option value="ORGANISER">Organisers ({organiserCount})</option>
            <option value="ARCHIVED">
              Archived Volunteers ({archivedVolunteers.length})
            </option>
          </select>
        </div>

        {/* Action buttons: Alt-Channel Comms, Show Archived toggle, View Policies, and Add Volunteer */}
        <div className="flex flex-wrap items-center gap-2">
          {nonWhatsAppVolunteers.length > 0 && (
            <button
              type="button"
              onClick={() => {
                setAltCommsCopyFeedback(null);
                setShowAltCommsModal(true);
              }}
              className="inline-flex items-center gap-1.5 px-3.5 py-2.5 rounded-xl border border-slate-300 bg-white text-slate-800 font-bold text-xs hover:bg-slate-50 shadow-sm"
            >
              <Mail className="h-4 w-4 text-blue-700" />
              Alt-Channel Comms ({nonWhatsAppVolunteers.length})
            </button>
          )}

          {archivedVolunteers.length > 0 && (
            <button
              type="button"
              aria-pressed={showArchived || roleFilter === 'ARCHIVED'}
              onClick={() => {
                if (roleFilter === 'ARCHIVED') {
                  setRoleFilter('ALL');
                  setShowArchived(false);
                } else {
                  setShowArchived((prev) => !prev);
                }
              }}
              className={`inline-flex items-center gap-1.5 px-3.5 py-2.5 rounded-xl border font-bold text-xs shadow-sm transition-colors ${
                showArchived || roleFilter === 'ARCHIVED'
                  ? 'bg-slate-800 text-white border-slate-800 hover:bg-slate-900'
                  : 'bg-white text-slate-700 border-slate-300 hover:bg-slate-50'
              }`}
            >
              <Archive className="h-4 w-4" />
              {showArchived || roleFilter === 'ARCHIVED'
                ? `Hide Archived (${archivedVolunteers.length})`
                : `Show Archived (${archivedVolunteers.length})`}
            </button>
          )}

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
            <thead className="bg-slate-50 border-b border-slate-200 text-xs font-bold text-slate-600 uppercase tracking-wider">
              <tr>
                <th scope="col" className="py-3 px-4">Volunteer Name</th>
                <th scope="col" className="py-3 px-4">Contact Details</th>
                <th scope="col" className="py-3 px-4">Emergency Contact</th>
                <th scope="col" className="py-3 px-4">Roles &amp; Skills</th>
                <th scope="col" className="py-3 px-4">Policy Induction</th>
                <th scope="col" className="py-3 px-4 text-right">Actions</th>
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
                    {roleFilter === 'ARCHIVED'
                      ? 'No archived volunteers found.'
                      : 'No volunteers found matching your search. Click \u201cAdd Volunteer\u201d to register one.'}
                  </td>
                </tr>
              ) : (
                filteredVolunteers.map((v) => (
                  <tr
                    key={v.id}
                    className={`transition-colors ${
                      v.archived
                        ? 'bg-slate-50/90 text-slate-600'
                        : 'hover:bg-slate-50/80'
                    }`}
                  >
                    {/* Volunteer name column (shortened to First Name + Surname Initial when archived) */}
                    <td className="py-3.5 px-4 whitespace-nowrap font-bold text-slate-900">
                      <div className="flex items-center gap-2">
                        <span className={v.archived ? 'text-slate-700' : 'text-slate-900'}>
                          {v.name}
                        </span>
                        {v.archived && (
                          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-bold bg-slate-200 text-slate-700">
                            <Archive className="h-3 w-3" /> Archived
                          </span>
                        )}
                      </div>
                    </td>

                    {/* Contact Phone, Email & WhatsApp / Alt-Comms Status column */}
                    <td className="py-3.5 px-4 text-xs text-slate-600 space-y-1.5">
                      {v.archived ? (
                        <div className="space-y-1">
                          <span className="italic text-slate-600 block">
                            Removed (GDPR Archived)
                          </span>
                          {v.whatsappStatus === 'ADDED' && (
                            <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-bold bg-teal-100 text-teal-950">
                              <MessageCircle className="h-3 w-3 text-teal-800" />
                              WhatsApp (Social Member)
                            </span>
                          )}
                        </div>
                      ) : (
                        <>
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
                            <span className="italic text-slate-600 block">
                              Not provided
                            </span>
                          )}

                          {/* WhatsApp Group Sync & Alternative Channel status badges */}
                          <div className="pt-0.5 flex flex-wrap items-center gap-1.5">
                            {v.whatsappStatus === 'ADDED' ? (
                              <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-bold bg-emerald-100 text-emerald-900">
                                <MessageCircle className="h-3 w-3 text-emerald-700" />
                                In WhatsApp
                              </span>
                            ) : v.whatsappStatus === 'PENDING_ADD' ? (
                              <>
                                <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-bold bg-amber-100 text-amber-900 border border-amber-300">
                                  <AlertTriangle className="h-3 w-3 text-amber-700" />
                                  WhatsApp: Needs Adding
                                </span>
                                {formatWhatsAppDeepLink({
                                  phone: v.phone,
                                  volunteerName: v.name,
                                }) && (
                                  <a
                                    href={
                                      formatWhatsAppDeepLink({
                                        phone: v.phone,
                                        volunteerName: v.name,
                                      })!
                                    }
                                    target="_blank"
                                    rel="noopener noreferrer"
                                    className="inline-flex items-center gap-1 px-2 py-0.5 rounded-lg bg-teal-700 text-white text-[11px] font-bold hover:bg-teal-800 shadow-sm"
                                    title={`Open 1-to-1 WhatsApp chat with ${v.name}`}
                                  >
                                    <ExternalLink className="h-3 w-3" />
                                    Message (wa.me)
                                  </a>
                                )}
                                <button
                                  type="button"
                                  onClick={() =>
                                    handleQuickWhatsAppStatus(v, 'ADDED')
                                  }
                                  className="inline-flex items-center gap-1 px-2 py-0.5 rounded-lg bg-emerald-700 text-white text-[11px] font-bold hover:bg-emerald-800 shadow-sm"
                                >
                                  <CheckCircle2 className="h-3 w-3" />
                                  Mark Added
                                </button>
                              </>
                            ) : v.whatsappStatus === 'PENDING_REMOVAL' ? (
                              <>
                                <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-bold bg-rose-100 text-rose-900 border border-rose-300">
                                  <AlertTriangle className="h-3 w-3 text-rose-700" />
                                  Remove from WhatsApp
                                </span>
                                <button
                                  type="button"
                                  onClick={() =>
                                    handleQuickWhatsAppStatus(
                                      v,
                                      'NOT_APPLICABLE'
                                    )
                                  }
                                  className="inline-flex items-center gap-1 px-2 py-0.5 rounded-lg bg-rose-700 text-white text-[11px] font-bold hover:bg-rose-800 shadow-sm"
                                >
                                  <CheckCircle2 className="h-3 w-3" />
                                  Confirm Removed
                                </button>
                              </>
                            ) : v.email || v.phone ? (
                              <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-bold bg-blue-50 text-blue-900 border border-blue-200">
                                <Mail className="h-3 w-3 text-blue-700" />
                                Alt Comms (
                                {v.email && v.phone
                                  ? 'Email / SMS'
                                  : v.email
                                    ? 'Email Only'
                                    : 'SMS Only'}
                                )
                              </span>
                            ) : (
                              <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-bold bg-amber-100 text-amber-900 border border-amber-300">
                                <AlertTriangle className="h-3 w-3 text-amber-700" />
                                Alt Comms: No Contact Info
                              </span>
                            )}
                          </div>
                        </>
                      )}
                    </td>

                    {/* Emergency Contact Summary button opening quick-view card */}
                    <td className="py-3.5 px-4 text-xs">
                      {v.archived ? (
                        <span className="italic text-slate-600">
                          Removed (GDPR Archived)
                        </span>
                      ) : (
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
                      )}
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
                        <span className="text-xs text-slate-600 bg-slate-100 px-2.5 py-0.5 rounded-full">
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
                          {/* Quick button to confirm policy induction (active volunteers only) */}
                          {!v.archived && (
                            <button
                              type="button"
                              onClick={() => handleQuickInduct(v)}
                              className="px-2.5 py-1 rounded-lg bg-emerald-700 text-white text-xs font-bold hover:bg-emerald-800 shadow-sm"
                            >
                              Confirm Inducted
                            </button>
                          )}
                        </div>
                      )}
                    </td>

                    {/* Row Edit / Archive / Restore / Delete Actions */}
                    <td className="py-3.5 px-4 text-right whitespace-nowrap space-x-1">
                      {v.archived ? (
                        <button
                          type="button"
                          onClick={() => handleOpenRestoreModal(v)}
                          title="Restore archived volunteer to active register"
                          aria-label={`Restore archived volunteer ${v.name}`}
                          className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg bg-emerald-700 text-white text-xs font-bold hover:bg-emerald-800 shadow-sm transition-colors"
                        >
                          <RotateCcw className="h-3.5 w-3.5" />
                          Restore
                        </button>
                      ) : (
                        <>
                          <button
                            type="button"
                            onClick={() => handleOpenEditModal(v)}
                            title="Edit volunteer details"
                            aria-label={`Edit volunteer details for ${v.name}`}
                            className="p-1.5 rounded-lg text-slate-500 hover:text-slate-900 hover:bg-slate-100 transition-colors"
                          >
                            <Edit2 className="h-4 w-4 inline" />
                          </button>
                          <button
                            type="button"
                            onClick={() => handleOpenArchiveModal(v)}
                            title="Archive volunteer (apply GDPR redactions)"
                            aria-label={`Archive ${v.name}`}
                            className="p-1.5 rounded-lg text-slate-500 hover:text-amber-800 hover:bg-amber-50 transition-colors"
                          >
                            <Archive className="h-4 w-4 inline" />
                          </button>
                        </>
                      )}
                      <button
                        type="button"
                        onClick={() => handleDeleteVolunteer(v)}
                        title="Remove volunteer from register"
                        aria-label={`Remove ${v.name} from volunteer register`}
                        className="p-1.5 rounded-lg text-slate-500 hover:text-rose-700 hover:bg-rose-50 transition-colors"
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
          <div
            ref={emergencyModalRef}
            role="dialog"
            aria-modal="true"
            aria-labelledby="volunteer-emergency-contact-title"
            tabIndex={-1}
            className="w-full max-w-sm rounded-2xl bg-white p-6 shadow-2xl border border-rose-200 text-left"
          >
            {/* Modal title and volunteer name */}
            <h3
              id="volunteer-emergency-contact-title"
              className="flex items-center gap-2 text-rose-700 font-black text-base mb-1"
            >
              <HeartPulse className="h-5 w-5" />
              Emergency Contact Card
            </h3>
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

      {/* Modal: Archive Volunteer Confirmation & GDPR Redaction Guard */}
      {archivingVolunteer && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4 overflow-y-auto">
          <div
            ref={archiveModalRef}
            role="dialog"
            aria-modal="true"
            aria-labelledby="archive-volunteer-modal-title"
            tabIndex={-1}
            className="w-full max-w-lg rounded-3xl bg-white p-6 shadow-2xl border border-amber-200 my-8"
          >
            <div className="flex items-center gap-3 pb-3 border-b border-slate-100">
              <div className="h-10 w-10 rounded-xl bg-amber-100 text-amber-800 flex items-center justify-center flex-shrink-0">
                <Archive className="h-5 w-5" />
              </div>
              <div>
                <h3
                  id="archive-volunteer-modal-title"
                  className="text-lg font-black text-slate-900"
                >
                  Archive Volunteer Record
                </h3>
                <p className="text-xs text-slate-600">
                  Volunteer: <strong>{archivingVolunteer.name}</strong>
                </p>
              </div>
            </div>

            {!canArchiveVolunteer(archivingVolunteer).allowed ? (
              <div className="mt-4 space-y-4">
                <div
                  role="alert"
                  className="p-4 rounded-2xl bg-amber-50 border border-amber-300 text-xs text-amber-950 space-y-2"
                >
                  <div className="font-bold flex items-center gap-1.5 text-sm text-amber-900">
                    <AlertTriangle className="h-4 w-4 text-amber-700 flex-shrink-0" />
                    Organiser Role Must Be Removed First
                  </div>
                  <p className="leading-relaxed text-amber-900">
                    {canArchiveVolunteer(archivingVolunteer).reason}
                  </p>
                </div>

                <div className="flex gap-3 pt-1">
                  <button
                    type="button"
                    onClick={() => {
                      setArchivingVolunteer(null);
                      setArchiveConfirmName('');
                      setArchiveError(null);
                    }}
                    className="flex-1 py-2.5 rounded-xl border border-slate-300 text-xs font-semibold text-slate-700 hover:bg-slate-50"
                  >
                    Cancel
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      const target = archivingVolunteer;
                      setArchivingVolunteer(null);
                      setArchiveConfirmName('');
                      setArchiveError(null);
                      handleOpenEditModal(target);
                    }}
                    className="flex-1 py-2.5 rounded-xl bg-brand-600 text-xs font-bold text-white hover:bg-brand-700 shadow-sm"
                  >
                    Edit Volunteer to Remove Organiser Role
                  </button>
                </div>
              </div>
            ) : (
              <form onSubmit={handleConfirmArchive} className="mt-4 space-y-4">
                <div className="p-4 rounded-2xl bg-amber-50/80 border border-amber-200 text-xs text-slate-800 space-y-2.5">
                  <p className="font-bold text-amber-950">
                    Archiving keeps this volunteer&apos;s ID in the database so historical session volunteer counts and repair records remain accurate, while applying these UK GDPR data redactions:
                  </p>
                  <ul className="list-disc pl-5 space-y-1.5 text-slate-700">
                    <li>
                      <strong>Name shortened to First Name and Surname Initial:</strong>{' '}
                      <span className="font-mono bg-white px-1.5 py-0.5 rounded border border-amber-200 text-slate-900">
                        {archivingVolunteer.name}
                      </span>{' '}
                      &rarr;{' '}
                      <span className="font-mono font-bold bg-white px-1.5 py-0.5 rounded border border-amber-200 text-emerald-900">
                        {formatArchivedVolunteerName(archivingVolunteer.name)}
                      </span>
                    </li>
                    <li>
                      <strong>Emergency contact information removed:</strong>{' '}
                      Emergency contact name, phone number, and relationship will be permanently deleted from the database.
                    </li>
                    <li>
                      <strong>Contact details removed:</strong>{' '}
                      Email address and phone number will be permanently deleted from the database (a one-way SHA-256 phone hash is retained so CLI WhatsApp reconciliation can still recognise archived records).
                    </li>
                  </ul>
                </div>

                {/* Mandatory WhatsApp group disposition choice if the volunteer was in/opted into WhatsApp */}
                {requiresWhatsAppArchiveDecision(archivingVolunteer) && (
                  <div className="p-4 rounded-2xl bg-teal-50/80 border border-teal-200 text-xs space-y-2.5">
                    <div className="font-bold text-teal-950 flex items-center gap-1.5">
                      <MessageCircle className="h-4 w-4 text-teal-800 flex-shrink-0" />
                      WhatsApp Group Membership Confirmation{' '}
                      <span className="text-rose-600">*</span>
                    </div>
                    <p className="text-slate-700 leading-relaxed">
                      Because archiving permanently deletes{' '}
                      <strong>{archivingVolunteer.name}</strong>&apos;s phone
                      number (
                      <span className="font-mono font-bold text-slate-900">
                        {archivingVolunteer.phone || 'not recorded'}
                      </span>
                      ) from the register, please confirm their WhatsApp group
                      status:
                    </p>
                    <div className="space-y-2 pt-1">
                      <label
                        htmlFor="archive-whatsapp-removed"
                        className="flex items-start gap-2.5 p-2.5 rounded-xl bg-white border border-teal-200 cursor-pointer hover:bg-teal-50/50"
                      >
                        <input
                          id="archive-whatsapp-removed"
                          type="radio"
                          name="archive-whatsapp-disposition"
                          checked={archiveWhatsappDisposition === 'REMOVED'}
                          onChange={() =>
                            setArchiveWhatsappDisposition('REMOVED')
                          }
                          className="mt-0.5 h-4 w-4 text-teal-700 border-slate-300 focus:ring-teal-600"
                        />
                        <div>
                          <span className="font-bold text-slate-900 block">
                            I have removed {archivingVolunteer.name} (
                            {archivingVolunteer.phone || 'no phone'}) from the
                            WhatsApp group
                          </span>
                          <span className="text-slate-600">
                            Clears their WhatsApp group membership status on the
                            archived record.
                          </span>
                        </div>
                      </label>

                      <label
                        htmlFor="archive-whatsapp-keep-social"
                        className="flex items-start gap-2.5 p-2.5 rounded-xl bg-white border border-teal-200 cursor-pointer hover:bg-teal-50/50"
                      >
                        <input
                          id="archive-whatsapp-keep-social"
                          type="radio"
                          name="archive-whatsapp-disposition"
                          checked={archiveWhatsappDisposition === 'KEEP_SOCIAL'}
                          onChange={() =>
                            setArchiveWhatsappDisposition('KEEP_SOCIAL')
                          }
                          className="mt-0.5 h-4 w-4 text-teal-700 border-slate-300 focus:ring-teal-600"
                        />
                        <div>
                          <span className="font-bold text-slate-900 block">
                            {archivingVolunteer.name} is remaining in the
                            WhatsApp group for social reasons
                          </span>
                          <span className="text-slate-600">
                            Marks them as a social WhatsApp member and retains a
                            one-way SHA-256 phone hash so CLI reconciliation
                            does not flag their number as unknown.
                          </span>
                        </div>
                      </label>
                    </div>
                  </div>
                )}

                {archiveError && (
                  <div
                    role="alert"
                    className="p-3 rounded-xl bg-rose-50 border border-rose-200 text-rose-800 text-xs font-bold"
                  >
                    {archiveError}
                  </div>
                )}

                <div>
                  <label
                    htmlFor="archive-volunteer-confirm-name"
                    className="block text-xs font-bold text-slate-700 mb-1"
                  >
                    Type the volunteer&apos;s full name (
                    <span className="font-mono text-slate-900">
                      {archivingVolunteer.name}
                    </span>
                    ) to confirm archival <span className="text-rose-600">*</span>
                  </label>
                  <input
                    id="archive-volunteer-confirm-name"
                    type="text"
                    required
                    autoComplete="off"
                    placeholder={archivingVolunteer.name}
                    value={archiveConfirmName}
                    onChange={(e) => setArchiveConfirmName(e.target.value)}
                    className="w-full px-3.5 py-2 rounded-xl border border-slate-300 text-sm focus:outline-none focus:ring-2 focus:ring-amber-600"
                  />
                </div>

                <div className="pt-2 flex gap-3">
                  <button
                    type="button"
                    disabled={archiving}
                    onClick={() => {
                      setArchivingVolunteer(null);
                      setArchiveConfirmName('');
                      setArchiveWhatsappDisposition(null);
                      setArchiveError(null);
                    }}
                    className="flex-1 py-2.5 rounded-xl border border-slate-300 text-sm font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-50"
                  >
                    Cancel
                  </button>
                  <button
                    type="submit"
                    disabled={
                      archiving ||
                      !validateArchiveConfirmationName(
                        archivingVolunteer.name,
                        archiveConfirmName
                      ) ||
                      (requiresWhatsAppArchiveDecision(archivingVolunteer) &&
                        !archiveWhatsappDisposition)
                    }
                    className="flex-1 py-2.5 rounded-xl bg-amber-700 text-sm font-bold text-white hover:bg-amber-800 disabled:opacity-50 shadow-sm"
                  >
                    {archiving ? 'Archiving...' : 'Archive Volunteer'}
                  </button>
                </div>
              </form>
            )}
          </div>
        </div>
      )}

      {/* Modal: Add, Edit, or Restore Volunteer */}
      {showFormModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4 overflow-y-auto">
          <div
            ref={formModalRef}
            role="dialog"
            aria-modal="true"
            aria-labelledby="volunteer-form-modal-title"
            tabIndex={-1}
            className="w-full max-w-lg rounded-3xl bg-white p-6 shadow-2xl border border-slate-200 my-8"
          >
            {/* Modal header and mandatory emergency contact subtitle */}
            <h3 id="volunteer-form-modal-title" className="text-lg font-black text-slate-900">
              {isRestoringVolunteer
                ? 'Restore Archived Volunteer'
                : editingVolunteerId
                  ? 'Edit Volunteer Record'
                  : 'Add New Volunteer'}
            </h3>
            <p className="text-xs text-slate-500 mt-0.5">
              {isRestoringVolunteer
                ? 'Re-enter the volunteer\u2019s full name and mandatory emergency contact details to restore them to the active register.'
                : 'Emergency contact details are mandatory for all volunteers.'}
            </p>

            {/* Validation error banner if submission fails */}
            {formError && (
              <div
                role="alert"
                className="mt-3 p-3 rounded-xl bg-rose-50 border border-rose-200 text-rose-800 text-xs font-bold"
              >
                {formError}
              </div>
            )}

            <form onSubmit={handleSaveVolunteer} className="mt-4 space-y-4">
              {/* Volunteer Full Name input */}
              <div>
                <label
                  htmlFor="volunteer-form-name"
                  className="block text-xs font-bold text-slate-700 mb-1"
                >
                  Volunteer Full Name <span className="text-rose-600">*</span>
                </label>
                <input
                  id="volunteer-form-name"
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
                {/* Volunteer phone number (mandatory when WhatsApp Opt-In is checked) */}
                <div>
                  <label
                    htmlFor="volunteer-form-phone"
                    className="block text-xs font-bold text-slate-700 mb-1"
                  >
                    Contact Phone{' '}
                    {whatsappOptIn ? (
                      <span className="text-rose-600">
                        * (Required for WhatsApp)
                      </span>
                    ) : (
                      '(Optional)'
                    )}
                  </label>
                  <input
                    id="volunteer-form-phone"
                    type="tel"
                    required={whatsappOptIn}
                    placeholder="e.g. 07700 900123"
                    value={phone}
                    onChange={(e) => setPhone(e.target.value)}
                    className="w-full px-3.5 py-2 rounded-xl border border-slate-300 text-sm focus:outline-none focus:ring-2 focus:ring-brand-500"
                  />
                </div>

                {/* Volunteer email address (mandatory when Organiser is checked) */}
                <div>
                  <label
                    htmlFor="volunteer-form-email"
                    className="block text-xs font-bold text-slate-700 mb-1"
                  >
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
                    id="volunteer-form-email"
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
                    <label
                      htmlFor="volunteer-form-emergency-name"
                      className="block text-xs font-bold text-slate-700 mb-1"
                    >
                      Contact Name <span className="text-rose-600">*</span>
                    </label>
                    <input
                      id="volunteer-form-emergency-name"
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
                    <label
                      htmlFor="volunteer-form-emergency-phone"
                      className="block text-xs font-bold text-slate-700 mb-1"
                    >
                      Emergency Phone <span className="text-rose-600">*</span>
                    </label>
                    <input
                      id="volunteer-form-emergency-phone"
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
                  <label
                    htmlFor="volunteer-form-emergency-relationship"
                    className="block text-xs font-bold text-slate-700 mb-1"
                  >
                    Relationship (Optional)
                  </label>
                  <input
                    id="volunteer-form-emergency-relationship"
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
                <label
                  htmlFor="volunteer-form-organiser"
                  className="flex items-start gap-2.5 p-2.5 rounded-xl border border-slate-200 hover:bg-slate-50 cursor-pointer"
                >
                  <input
                    id="volunteer-form-organiser"
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
                <label
                  htmlFor="volunteer-form-pat-trained"
                  className="flex items-start gap-2.5 p-2.5 rounded-xl border border-slate-200 hover:bg-slate-50 cursor-pointer"
                >
                  <input
                    id="volunteer-form-pat-trained"
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
                      Authorises this volunteer to appear in the Tester Name
                      dropdown at the PAT Station.
                    </span>
                  </div>
                </label>

                {/* Confirmed Policy Induction checkbox + Read Policies shortcut */}
                <div className="flex items-start justify-between gap-2.5 p-2.5 rounded-xl border border-emerald-200 bg-emerald-50/50">
                  <label
                    htmlFor="volunteer-form-inducted"
                    className="flex items-start gap-2.5 cursor-pointer flex-1"
                  >
                    <input
                      id="volunteer-form-inducted"
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

                {/* WhatsApp Group Opt-In & Membership Sync Checkboxes (Issue #43) */}
                <div className="p-2.5 rounded-xl border border-teal-200 bg-teal-50/50 space-y-2">
                  <label
                    htmlFor="volunteer-form-whatsapp-opt-in"
                    className="flex items-start gap-2.5 cursor-pointer"
                  >
                    <input
                      id="volunteer-form-whatsapp-opt-in"
                      type="checkbox"
                      checked={whatsappOptIn}
                      onChange={(e) => {
                        const checked = e.target.checked;
                        setWhatsappOptIn(checked);
                        if (!checked) {
                          setMarkWhatsAppAddedImmediately(false);
                        }
                      }}
                      className="mt-0.5 h-4 w-4 rounded border-slate-300 text-teal-700 focus:ring-teal-600"
                    />
                    <div className="text-xs">
                      <span className="font-bold text-teal-950 block">
                        Opted into Volunteer WhatsApp Group
                      </span>
                      <span className="text-slate-600">
                        Requires a contact phone number. Leave unticked to flag
                        this volunteer for alternative communications
                        (email/SMS).
                      </span>
                    </div>
                  </label>

                  {whatsappOptIn && (
                    <label
                      htmlFor="volunteer-form-whatsapp-added"
                      className="flex items-start gap-2.5 pl-6 pt-1 cursor-pointer"
                    >
                      <input
                        id="volunteer-form-whatsapp-added"
                        type="checkbox"
                        checked={markWhatsAppAddedImmediately}
                        onChange={(e) =>
                          setMarkWhatsAppAddedImmediately(e.target.checked)
                        }
                        className="mt-0.5 h-4 w-4 rounded border-slate-300 text-emerald-700 focus:ring-emerald-600"
                      />
                      <div className="text-xs">
                        <span className="font-bold text-slate-900 block">
                          Already added to the WhatsApp group
                        </span>
                        <span className="text-slate-600">
                          Tick if this volunteer is already in the group; leave
                          unticked to flag as &ldquo;Needs Adding&rdquo;.
                        </span>
                      </div>
                    </label>
                  )}
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
                  onClick={() => {
                    setIsRestoringVolunteer(false);
                    setShowFormModal(false);
                  }}
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
                    : isRestoringVolunteer
                      ? 'Restore Volunteer'
                      : editingVolunteerId
                        ? 'Save Changes'
                        : 'Add to Register'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Modal: Alternative Channel Communications for Non-WhatsApp Volunteers (Approach C) */}
      {showAltCommsModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4 overflow-y-auto">
          <div
            ref={altCommsModalRef}
            role="dialog"
            aria-modal="true"
            aria-labelledby="alt-comms-modal-title"
            tabIndex={-1}
            className="w-full max-w-lg rounded-3xl bg-white p-6 shadow-2xl border border-slate-200 my-8"
          >
            <div className="flex items-center gap-3 pb-3 border-b border-slate-100">
              <div className="h-10 w-10 rounded-xl bg-blue-50 text-blue-700 flex items-center justify-center flex-shrink-0">
                <Mail className="h-5 w-5" />
              </div>
              <div>
                <h3
                  id="alt-comms-modal-title"
                  className="text-lg font-black text-slate-900"
                >
                  Alternative Channel Communications ({nonWhatsAppVolunteers.length})
                </h3>
                <p className="text-xs text-slate-600">
                  Active volunteers who have not opted into the WhatsApp group
                  and need key updates via email or SMS.
                </p>
              </div>
            </div>

            {altCommsCopyFeedback && (
              <div
                role="status"
                className="mt-3 p-2.5 rounded-xl bg-emerald-50 border border-emerald-200 text-emerald-900 text-xs font-bold"
              >
                {altCommsCopyFeedback}
              </div>
            )}

            {/* Quick broadcast actions: BCC email and copy email/SMS lists */}
            <div className="mt-4 flex flex-wrap gap-2">
              {nonWhatsAppEmails.length > 0 && (
                <>
                  <a
                    href={`mailto:?bcc=${encodeURIComponent(nonWhatsAppEmails.join(','))}`}
                    className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-xl bg-blue-600 text-white text-xs font-bold hover:bg-blue-700 shadow-sm"
                  >
                    <Mail className="h-3.5 w-3.5" />
                    Email All via BCC ({nonWhatsAppEmails.length})
                  </a>
                  <button
                    type="button"
                    onClick={() =>
                      handleCopyAltCommsList(
                        nonWhatsAppEmails.join(', '),
                        `${nonWhatsAppEmails.length} email address(es)`
                      )
                    }
                    className="inline-flex items-center gap-1.5 px-3 py-2 rounded-xl border border-slate-300 bg-white text-slate-800 text-xs font-bold hover:bg-slate-50"
                  >
                    <Copy className="h-3.5 w-3.5 text-slate-600" />
                    Copy Emails ({nonWhatsAppEmails.length})
                  </button>
                </>
              )}

              {nonWhatsAppPhones.length > 0 && (
                <button
                  type="button"
                  onClick={() =>
                    handleCopyAltCommsList(
                      nonWhatsAppPhones.join(', '),
                      `${nonWhatsAppPhones.length} SMS phone number(s)`
                    )
                  }
                  className="inline-flex items-center gap-1.5 px-3 py-2 rounded-xl border border-slate-300 bg-white text-slate-800 text-xs font-bold hover:bg-slate-50"
                >
                  <Copy className="h-3.5 w-3.5 text-slate-600" />
                  Copy SMS Numbers ({nonWhatsAppPhones.length})
                </button>
              )}
            </div>

            {/* List of non-WhatsApp volunteers and their available channels */}
            <div className="mt-4 max-h-72 overflow-y-auto divide-y divide-slate-100 border border-slate-200 rounded-2xl">
              {nonWhatsAppVolunteers.map((v) => (
                <div
                  key={v.id}
                  className="flex items-center justify-between gap-3 px-4 py-2.5 text-xs"
                >
                  <div>
                    <span className="font-bold text-slate-900 block">
                      {v.name}
                    </span>
                    <div className="text-slate-600 space-x-2 mt-0.5">
                      {v.email && <span>Email: {v.email}</span>}
                      {v.phone && <span>SMS: {v.phone}</span>}
                      {!v.email && !v.phone && (
                        <span className="text-amber-900 font-bold">
                          No email or phone recorded
                        </span>
                      )}
                    </div>
                  </div>
                  <button
                    type="button"
                    onClick={() => {
                      setShowAltCommsModal(false);
                      handleOpenEditModal(v);
                    }}
                    className="px-2.5 py-1 rounded-lg border border-slate-300 text-slate-700 font-bold hover:bg-slate-50"
                  >
                    Edit
                  </button>
                </div>
              ))}
            </div>

            <div className="pt-4">
              <button
                type="button"
                onClick={() => {
                  setShowAltCommsModal(false);
                  setAltCommsCopyFeedback(null);
                }}
                className="w-full py-2.5 rounded-xl bg-slate-800 text-xs font-bold text-white hover:bg-slate-900"
              >
                Close
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
