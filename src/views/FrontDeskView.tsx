import React, { useState, useEffect } from 'react';
import { 
  Plus, 
  Search, 
  CheckCircle, 
  Phone, 
  Lock, 
  Calendar, 
  Archive,
  RefreshCw,
  Tablet
} from 'lucide-react';
import { doc, setDoc } from 'firebase/firestore';
import { db } from '../services/firebase';
import { Session, RepairItem } from '../types';
import { useAuth } from '../hooks/useAuth';
import { useRepairs } from '../hooks/useRepairs';
import { 
  createSession, 
  finalizeSessionClient 
} from '../services/sessionService';
import { 
  assignCardToken, 
  completeCollection, 
  getPrivateCustomerData,
  filterRepairs,
  isTerminalStatus,
  canAssignCard
} from '../services/repairService';
import { StatusBadge } from '../components/common/StatusBadge';
import { CardToken } from '../components/common/CardToken';
import { cafeConfig } from '../config/cafe.config';

interface FrontDeskViewProps {
  session: Session | null;
}

export const FrontDeskView: React.FC<FrontDeskViewProps> = ({ session }) => {
  const { user, isAdmin, signInWithGoogle, signOut } = useAuth();
  const { repairs, loading } = useRepairs(session?.id);

  // New session modal / form state
  const [showNewSessionModal, setShowNewSessionModal] = useState(false);
  const [sessionName, setSessionName] = useState('');
  const [sessionDate, setSessionDate] = useState(new Date().toISOString().split('T')[0]);
  const [volunteerPin, setVolunteerPin] = useState('');
  const [creatingSession, setCreatingSession] = useState(false);

  // Tablet Partitioning preset for offline card allocation
  const [tabletPreset, setTabletPreset] = useState<'A' | 'B' | 'ALL'>(() => {
    return (localStorage.getItem('frontdesk_tablet_preset') as 'A' | 'B' | 'ALL') || 'ALL';
  });

  // Assign card inline state
  const [selectedRepairId, setSelectedRepairId] = useState<string | null>(null);
  const [cardNumberInput, setCardNumberInput] = useState<string>('');
  const [assignError, setAssignError] = useState<string | null>(null);

  // Customer contact detail modal
  const [contactModalData, setContactModalData] = useState<{
    brandModel: string;
    cardNumber?: number;
    firstName: string;
    contactPhone?: string;
  } | null>(null);

  // Search and filter
  const [searchTerm, setSearchTerm] = useState('');
  const [statusFilter, setStatusFilter] = useState<string>('ALL');
  // Fallback cache for customer names on legacy items missing customerName field
  const [fetchedNames, setFetchedNames] = useState<Record<string, string>>({});

  // Finalize session confirmation
  const [isFinalizing, setIsFinalizing] = useState(false);

  const handleTabletPresetChange = (preset: 'A' | 'B' | 'ALL') => {
    setTabletPreset(preset);
    localStorage.setItem('frontdesk_tablet_preset', preset);
  };

  // Keep Firestore settings/system.organizerEmails in sync with cafeConfig for backend verification
  useEffect(() => {
    if (isAdmin && user) {
      const settingsRef = doc(db, 'settings', 'system');
      setDoc(settingsRef, {
        organizerEmails: cafeConfig.organizerEmails
      }, { merge: true }).catch(err => {
        console.warn("Could not sync organizerEmails to settings/system:", err);
      });
    }
  }, [isAdmin, user]);

  // Fetch missing customer names for existing repairs (admin only)
  useEffect(() => {
    if (!session || !isAdmin) return;
    const missingNameRepairs = repairs.filter(r => !r.customerName && !fetchedNames[r.id]);
    if (missingNameRepairs.length === 0) return;

    let isMounted = true;
    Promise.all(
      missingNameRepairs.map(async (r) => {
        try {
          const pii = await getPrivateCustomerData(session.id, r.id);
          if (pii?.firstName) {
            return { id: r.id, name: pii.firstName };
          }
        } catch {
          // ignore permission or network error
        }
        return null;
      })
    ).then((results) => {
      if (!isMounted) return;
      const newEntries: Record<string, string> = {};
      results.forEach(res => {
        if (res) newEntries[res.id] = res.name;
      });
      if (Object.keys(newEntries).length > 0) {
        setFetchedNames(prev => ({ ...prev, ...newEntries }));
      }
    });

    return () => { isMounted = false; };
  }, [repairs, session, isAdmin, fetchedNames]);

  if (!isAdmin) {
    if (user) {
      return (
        <div className="max-w-md mx-auto my-16 p-8 bg-white rounded-3xl shadow-md border border-amber-200 text-center">
          <div className="h-14 w-14 bg-amber-100 text-amber-800 rounded-2xl flex items-center justify-center mx-auto mb-4">
            <Lock className="h-7 w-7 text-amber-700" />
          </div>
          <h2 className="text-xl font-bold text-slate-800">Unauthorized Organizer Account</h2>
          <p className="mt-2 text-sm text-slate-600 mb-2">
            You are signed in as <span className="font-semibold text-slate-800">{user.email}</span>.
          </p>
          <p className="text-xs text-slate-500 mb-6 leading-relaxed">
            This account is not in the list of authorized organizers for {cafeConfig.cafeName}. Please switch to an authorized Google account or ask a café administrator to add your email to <code className="bg-slate-100 px-1 py-0.5 rounded text-slate-700">organizerEmails</code> in <code className="bg-slate-100 px-1 py-0.5 rounded text-slate-700">cafe.config.ts</code>.
          </p>
          <button
            onClick={signOut}
            className="w-full py-3 px-4 rounded-xl bg-slate-800 text-white font-bold hover:bg-slate-900 transition-colors shadow-sm flex items-center justify-center gap-2 text-sm"
          >
            Sign Out & Switch Account
          </button>
        </div>
      );
    }

    return (
      <div className="max-w-md mx-auto my-16 p-8 bg-white rounded-3xl shadow-md border border-slate-200 text-center">
        <div className="h-14 w-14 bg-emerald-100 text-emerald-800 rounded-2xl flex items-center justify-center mx-auto mb-4">
          <Lock className="h-7 w-7" />
        </div>
        <h2 className="text-xl font-bold text-slate-800">Front Desk Organizer Login</h2>
        <p className="mt-2 text-sm text-slate-600 mb-6">
          Access to the Front Desk queue and session administration requires signing in with an authorized Google account.
        </p>
        <button
          onClick={signInWithGoogle}
          className="w-full py-3 px-4 rounded-xl bg-emerald-700 text-white font-bold hover:bg-emerald-800 transition-colors shadow-sm flex items-center justify-center gap-2"
        >
          Sign In with Google
        </button>
      </div>
    );
  }

  const handleCreateSession = async (e: React.FormEvent) => {
    e.preventDefault();
    if (volunteerPin.length !== 4) {
      alert("Please provide a 4-digit volunteer PIN.");
      return;
    }

    setCreatingSession(true);
    try {
      const sessionId = `${sessionDate.replace(/-/g, '')}-${sessionName.toLowerCase().replace(/[^a-z0-9]/g, '')}`;
      await createSession({
        id: sessionId,
        name: sessionName.trim(),
        date: sessionDate,
        volunteerPin: volunteerPin.trim(),
        cardRangeStart: cafeConfig.defaultCardRange.start,
        cardRangeEnd: cafeConfig.defaultCardRange.end
      });
      setShowNewSessionModal(false);
      setSessionName('');
      setVolunteerPin('');
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : "Failed to create session";
      alert(message);
    } finally {
      setCreatingSession(false);
    }
  };

  const handleAssignCard = async (repairId: string) => {
    if (!session) return;
    const num = parseInt(cardNumberInput, 10);
    if (isNaN(num) || num <= 0) {
      setAssignError("Please enter a valid card number.");
      return;
    }

    // Partition check if tablet preset active
    if (tabletPreset === 'A' && (num < 1 || num > 50)) {
      if (!confirm(`Warning: Tablet A is configured for cards 1-50. Card #${num} is outside this range. Proceed anyway?`)) {
        return;
      }
    } else if (tabletPreset === 'B' && (num < 51 || num > 100)) {
      if (!confirm(`Warning: Tablet B is configured for cards 51-100. Card #${num} is outside this range. Proceed anyway?`)) {
        return;
      }
    }

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
      const message = err instanceof Error ? err.message : "Error assigning card";
      setAssignError(message);
    }
  };

  const handleViewContact = async (repair: RepairItem) => {
    if (!session) return;
    try {
      const pii = await getPrivateCustomerData(session.id, repair.id);
      if (pii) {
        setContactModalData({
          brandModel: repair.item.brandModel,
          cardNumber: repair.cardNumber,
          firstName: pii.firstName,
          contactPhone: pii.contactPhone
        });
      } else {
        alert("Customer details not found or already redacted.");
      }
    } catch (err) {
      console.error("Error reading PII:", err);
      alert("Permission denied or customer details unavailable.");
    }
  };

  const handleCompleteCollection = async (repairId: string) => {
    if (!session) return;
    if (confirm("Confirm customer collection and return of physical card token?")) {
      try {
        await completeCollection(session.id, repairId);
      } catch (err: unknown) {
        console.error("Error completing collection:", err);
        const message = err instanceof Error ? err.message : "Failed to complete collection.";
        alert(message);
      }
    }
  };

  const handleFinalizeSession = async () => {
    if (!session) return;
    if (confirm(`Are you sure you want to CLOSE and FINALIZE "${session.name}"?\n\nThis will:\n1. Compute final impact metrics (weight diverted, success rates).\n2. Automatically REDACT all visitor customer phone numbers (GDPR).\n3. Archive the session for reporting.`)) {
      setIsFinalizing(true);
      try {
        await finalizeSessionClient(session.id);
        alert("Session successfully finalized and customer data redacted.");
        // Redirect cleanly to reports
        window.location.href = '/reports';
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : "Failed to finalize session";
        alert(message);
        setIsFinalizing(false);
      }
    }
  };

  // Filtered repairs
  const filteredRepairs = filterRepairs(repairs, searchTerm, statusFilter, fetchedNames);

  // Calculate live session counters
  const counts = {
    total: repairs.length,
    registered: repairs.filter(r => r.status === 'REGISTERED').length,
    waitingPat1: repairs.filter(r => r.status === 'WAITING_PAT1' || r.status === 'IN_PAT1').length,
    waitingRepair: repairs.filter(r => r.status === 'WAITING_REPAIR' || r.status === 'IN_REPAIR').length,
    waitingPat2: repairs.filter(r => r.status === 'WAITING_PAT2' || r.status === 'IN_PAT2').length,
    ready: repairs.filter(r => r.status === 'READY_FOR_COLLECTION').length,
    completed: repairs.filter(r => r.status === 'COMPLETED').length,
  };

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 my-6">
      {/* Top Session Management Bar */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between pb-6 border-b border-slate-200 gap-4">
        <div>
          <h2 className="text-2xl font-black text-slate-900 flex items-center gap-2">
            Front Desk Queue Management
          </h2>
          <p className="text-xs sm:text-sm text-slate-500">
            {session ? (
              <span>Active Session: <strong>{session.name}</strong> ({session.date})</span>
            ) : (
              <span className="text-amber-600 font-semibold">No active session running today.</span>
            )}
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-3">
          {/* Offline Partition Selector */}
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
            <button
              onClick={() => handleTabletPresetChange('B')}
              className={`px-2 py-1 rounded-lg transition-all ${
                tabletPreset === 'B' ? 'bg-white shadow text-emerald-800 font-bold' : 'text-slate-600'
              }`}
            >
              Tablet B (51–100)
            </button>
            <button
              onClick={() => handleTabletPresetChange('ALL')}
              className={`px-2 py-1 rounded-lg transition-all ${
                tabletPreset === 'ALL' ? 'bg-white shadow text-emerald-800 font-bold' : 'text-slate-600'
              }`}
            >
              All
            </button>
          </div>

          {!session ? (
            <button
              onClick={() => setShowNewSessionModal(true)}
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
              {isFinalizing ? "Closing Session..." : "Finalize & Redact Session"}
            </button>
          )}
        </div>
      </div>

      {session && (
        <>
          {/* Live Metrics Counters */}
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3 my-6">
            <div className="bg-white p-3.5 rounded-2xl border border-slate-200 shadow-sm">
              <span className="text-xs font-semibold text-slate-500 uppercase">Total Items</span>
              <p className="text-2xl font-black text-slate-800 mt-1">{counts.total}</p>
            </div>
            <div className="bg-amber-50 p-3.5 rounded-2xl border border-amber-200 shadow-sm">
              <span className="text-xs font-semibold text-amber-700 uppercase">Needs Card #</span>
              <p className="text-2xl font-black text-amber-900 mt-1">{counts.registered}</p>
            </div>
            <div className="bg-orange-50 p-3.5 rounded-2xl border border-orange-200 shadow-sm">
              <span className="text-xs font-semibold text-orange-700 uppercase">PAT 1 Queue</span>
              <p className="text-2xl font-black text-orange-900 mt-1">{counts.waitingPat1}</p>
            </div>
            <div className="bg-blue-50 p-3.5 rounded-2xl border border-blue-200 shadow-sm">
              <span className="text-xs font-semibold text-blue-700 uppercase">Repair Queue</span>
              <p className="text-2xl font-black text-blue-900 mt-1">{counts.waitingRepair}</p>
            </div>
            <div className="bg-purple-50 p-3.5 rounded-2xl border border-purple-200 shadow-sm">
              <span className="text-xs font-semibold text-purple-700 uppercase">PAT 2 Queue</span>
              <p className="text-2xl font-black text-purple-900 mt-1">{counts.waitingPat2}</p>
            </div>
            <div className="bg-emerald-50 p-3.5 rounded-2xl border border-emerald-200 shadow-sm">
              <span className="text-xs font-semibold text-emerald-700 uppercase">Ready for Pickup</span>
              <p className="text-2xl font-black text-emerald-900 mt-1">{counts.ready}</p>
            </div>
          </div>

          {/* Search and Filters */}
          <div className="flex flex-col sm:flex-row gap-3 my-4">
            <div className="relative flex-1">
              <Search className="h-4 w-4 absolute left-3.5 top-3 text-slate-400" />
              <input
                type="text"
                placeholder="Search customer name, token (e.g. REF-A38F), card #, or item..."
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                className="w-full pl-10 pr-4 py-2.5 rounded-xl border border-slate-200 bg-white text-sm focus:outline-none focus:ring-2 focus:ring-brand-500 shadow-sm"
              />
            </div>
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

          {/* Repairs Table */}
          <div className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full text-left text-sm">
                <thead className="bg-slate-50 border-b border-slate-200 text-xs font-bold text-slate-500 uppercase tracking-wider">
                  <tr>
                    <th className="py-3 px-4">Card #</th>
                    <th className="py-3 px-4">Customer</th>
                    <th className="py-3 px-4">Ref Token</th>
                    <th className="py-3 px-4">Item & Fault</th>
                    <th className="py-3 px-4">Power Type</th>
                    <th className="py-3 px-4">Status</th>
                    <th className="py-3 px-4">Fixer / PAT</th>
                    <th className="py-3 px-4 text-right">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 font-medium">
                  {loading ? (
                    <tr>
                      <td colSpan={8} className="py-8 text-center text-slate-500">
                        <RefreshCw className="h-6 w-6 animate-spin mx-auto mb-2 text-brand-600" />
                        Loading repairs...
                      </td>
                    </tr>
                  ) : filteredRepairs.length === 0 ? (
                    <tr>
                      <td colSpan={8} className="py-8 text-center text-slate-500">
                        No items found matching the current search.
                      </td>
                    </tr>
                  ) : (
                    filteredRepairs.map((r) => {
                      const isCompleted = isTerminalStatus(r.status);
                      const customerName = r.customerName || fetchedNames[r.id] || '—';
                    return (
                      <tr 
                        key={r.id} 
                        className={`transition-colors ${
                          isCompleted 
                            ? 'bg-slate-100/75 text-slate-500 opacity-60 hover:bg-slate-100' 
                            : 'hover:bg-slate-50/80'
                        }`}
                      >
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
                        <td className="py-3.5 px-4 whitespace-nowrap">
                          <span className={`font-semibold ${isCompleted ? 'text-slate-600' : 'text-slate-800'}`}>
                            {customerName}
                          </span>
                        </td>
                        <td className="py-3.5 px-4 font-mono font-bold text-xs text-slate-600">
                          {r.referenceToken}
                        </td>
                        <td className="py-3.5 px-4">
                          <div className={`font-bold ${isCompleted ? 'text-slate-600' : 'text-slate-800'}`}>
                            {r.item.brandModel}
                          </div>
                          <div className="text-xs text-slate-500 line-clamp-1">{r.item.faultDescription}</div>
                        </td>
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
                              {r.item.powerType.replace('_', ' ')}
                            </span>
                          )}
                        </td>
                        <td className="py-3.5 px-4">
                          <StatusBadge status={r.status} size="sm" />
                        </td>
                        <td className="py-3.5 px-4 text-xs text-slate-600">
                          {r.repair?.fixerName && (
                            <div>Fixer: <strong>{r.repair.fixerName}</strong></div>
                          )}
                          {r.patInitial?.testerName && (
                            <div>PAT: {r.patInitial.testerName}</div>
                          )}
                          {!r.repair?.fixerName && !r.patInitial?.testerName && '—'}
                        </td>
                        <td className="py-3.5 px-4 text-right space-x-2 whitespace-nowrap">
                          {/* Assign Card Token */}
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

                          {/* Customer Contact Lookup */}
                          <button
                            onClick={() => handleViewContact(r)}
                            title="View customer contact phone"
                            className="p-1.5 rounded-lg text-slate-500 hover:text-slate-800 hover:bg-slate-200 transition-colors"
                          >
                            <Phone className="h-4 w-4 inline" />
                          </button>

                          {/* Collection Action */}
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

      {/* Modal: Assign Card Number */}
      {selectedRepairId && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4">
          <div className="w-full max-w-sm rounded-2xl bg-white p-6 shadow-2xl border border-slate-200">
            <h3 className="text-lg font-bold text-slate-900 mb-1">Assign Physical Card</h3>
            <p className="text-xs text-slate-500 mb-3">
              Enter the number on the reusable physical card handed to the customer.
              {tabletPreset !== 'ALL' && (
                <span className="block mt-1 font-semibold text-emerald-700">
                  Active Preset: Tablet {tabletPreset} ({tabletPreset === 'A' ? '1–50' : '51–100'})
                </span>
              )}
            </p>

            {assignError && (
              <p className="text-xs font-bold text-rose-600 mb-3 bg-rose-50 p-2 rounded">
                {assignError}
              </p>
            )}

            <input
              type="number"
              autoFocus
              min={1}
              max={200}
              placeholder="e.g. 14"
              value={cardNumberInput}
              onChange={(e) => setCardNumberInput(e.target.value)}
              className="w-full text-center text-3xl font-mono font-black py-3 rounded-xl border border-slate-300 focus:outline-none focus:ring-2 focus:ring-brand-500 mb-4"
            />

            <div className="flex gap-2">
              <button
                type="button"
                onClick={() => setSelectedRepairId(null)}
                className="flex-1 py-2 rounded-xl border border-slate-300 text-xs font-semibold text-slate-700 hover:bg-slate-50"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={() => handleAssignCard(selectedRepairId)}
                className="flex-1 py-2 rounded-xl bg-brand-600 text-xs font-bold text-white hover:bg-brand-700 shadow-sm"
              >
                Assign & Route
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Modal: Customer PII Contact Card */}
      {contactModalData && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4">
          <div className="w-full max-w-sm rounded-2xl bg-white p-6 shadow-2xl border border-slate-200 text-left">
            <h3 className="text-base font-bold text-slate-900 mb-1">Customer Contact Card</h3>
            <p className="text-xs text-slate-500 mb-4">
              Item: <strong>{contactModalData.brandModel}</strong>{' '}
              {contactModalData.cardNumber && `(Card #${contactModalData.cardNumber})`}
            </p>

            <div className="space-y-3 bg-slate-50 p-4 rounded-xl border border-slate-200 text-sm">
              <div>
                <span className="text-xs text-slate-500 block">Customer Name</span>
                <span className="font-bold text-slate-800">{contactModalData.firstName}</span>
              </div>
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

            <button
              onClick={() => setContactModalData(null)}
              className="mt-5 w-full py-2.5 rounded-xl bg-slate-800 text-xs font-bold text-white hover:bg-slate-900"
            >
              Close
            </button>
          </div>
        </div>
      )}

      {/* Modal: Start New Monthly Session */}
      {showNewSessionModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4">
          <div className="w-full max-w-md rounded-3xl bg-white p-6 shadow-2xl border border-slate-200">
            <div className="flex items-center gap-3 pb-4 border-b border-slate-100">
              <div className="h-10 w-10 rounded-xl bg-emerald-100 text-emerald-800 flex items-center justify-center">
                <Calendar className="h-5 w-5" />
              </div>
              <div>
                <h3 className="text-lg font-bold text-slate-900">Start Today&apos;s Repair Café</h3>
                <p className="text-xs text-slate-500">Configure the active session and volunteer PIN</p>
              </div>
            </div>

            <form onSubmit={handleCreateSession} className="mt-4 space-y-4">
              <div>
                <label className="block text-xs font-bold text-slate-700 mb-1">
                  Session Name
                </label>
                <input
                  type="text"
                  required
                  placeholder="e.g. October 2026 - Seears Park"
                  value={sessionName}
                  onChange={(e) => setSessionName(e.target.value)}
                  className="w-full px-3.5 py-2.5 rounded-xl border border-slate-300 text-sm focus:outline-none focus:ring-2 focus:ring-brand-500"
                />
              </div>

              <div>
                <label className="block text-xs font-bold text-slate-700 mb-1">
                  Session Date
                </label>
                <input
                  type="date"
                  required
                  value={sessionDate}
                  onChange={(e) => setSessionDate(e.target.value)}
                  className="w-full px-3.5 py-2.5 rounded-xl border border-slate-300 text-sm focus:outline-none focus:ring-2 focus:ring-brand-500"
                />
              </div>

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
                  className="w-full px-3.5 py-2.5 rounded-xl border border-slate-300 font-mono text-center tracking-widest text-lg font-bold focus:outline-none focus:ring-2 focus:ring-brand-500"
                />
                <p className="text-xs text-slate-500 mt-1">
                  Give this code to volunteers at the PAT and Fixer stations this morning.
                </p>
              </div>

              <div className="pt-2 flex gap-3">
                <button
                  type="button"
                  onClick={() => setShowNewSessionModal(false)}
                  className="flex-1 py-2.5 rounded-xl border border-slate-300 text-sm font-semibold text-slate-700 hover:bg-slate-50"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={creatingSession}
                  className="flex-1 py-2.5 rounded-xl bg-brand-600 text-sm font-bold text-white hover:bg-brand-700 disabled:opacity-50 shadow-sm"
                >
                  {creatingSession ? "Creating..." : "Launch Session"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};
