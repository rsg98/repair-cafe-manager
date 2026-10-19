// @vitest-environment happy-dom
import React, { act } from 'react';
import { createRoot, Root } from 'react-dom/client';
import { MemoryRouter } from 'react-router-dom';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import axe from 'axe-core';
import type {
  Session,
  RepairItem,
  Volunteer,
  PatInstrument,
  SessionAnalytics,
} from '../src/types';

// Configure React 18/19 testing environment flag so act(...) does not log stderr warnings
(globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;

// ---------------------------------------------------------------------------
// Hoisted Sample Domain Fixtures for Station & Modal Audits
// ---------------------------------------------------------------------------

const {
  SAMPLE_VOLUNTEER,
  SAMPLE_SESSION,
  SAMPLE_REPAIR_ITEM,
  SAMPLE_PAT_INSTRUMENT,
  SAMPLE_ANALYTICS,
} = vi.hoisted(() => {
  const volunteer: Volunteer = {
    id: 'vol-1',
    name: 'Alice Fixer',
    email: 'alice@example.org',
    phone: '07700900111',
    isOrganiser: true,
    isPatTrained: true,
    inducted: true,
    inductedAt: 1700000000000,
    inductedBy: 'Coordinator',
    emergencyContactName: 'Bob Fixer',
    emergencyContactPhone: '07700900222',
    emergencyContactRelationship: 'Spouse',
    createdAt: 1700000000000,
    updatedAt: 1700000000000,
  };

  const session: Session = {
    id: '202610-seears',
    name: 'October 2026 Repair Café',
    date: '2026-10-10',
    venue: 'Seears Park Community Hall',
    status: 'ACTIVE',
    isTest: false,
    cardRangeStart: 1,
    cardRangeEnd: 50,
    attendingVolunteerIds: ['vol-1'],
    attendingVolunteers: [
      {
        id: 'vol-1',
        name: 'Alice Fixer',
        isOrganiser: true,
        isPatTrained: true,
        inducted: true,
      },
    ],
    createdAt: 1700000000000,
  };

  const repairItem: RepairItem = {
    id: 'rep-1',
    sessionId: '202610-seears',
    registrationId: 'reg-1',
    referenceToken: 'REF-A38F',
    cardNumber: 12,
    customerName: 'Jane',
    status: 'WAITING_PAT1',
    item: {
      category: 'ELECTRICAL',
      brandModel: 'Dualit 4-Slice Toaster',
      faultDescription: 'Heating element on right slots does not stay down',
      powerType: 'MAINS_240V',
      applianceClass: 'CLASS_I',
      weightKg: 2.4,
    },
    patInitial: {
      testerName: 'Alice Fixer',
      instrumentSerial: 'SW-9001',
      visualPass: true,
      fuseRatingAmps: 13,
      testVoltageVolts: 500,
      earthContinuityOhms: 0.08,
      insulationResistanceMOhms: 199.9,
      outcome: 'PASS',
      cautionNotes: 'Clean earth bond on chassis',
      testedAt: 1700000100000,
    },
    createdAt: 1700000000000,
    updatedAt: 1700000100000,
  };

  const patInstrument: PatInstrument = {
    id: 'inst-1',
    displayName: 'Primary Seaward Tester',
    manufacturer: 'Seaward',
    model: 'PrimeTest 100',
    serialNumber: 'SW-9001',
    lastCalibratedDate: '2026-06-01',
    createdAt: 1700000000000,
    updatedAt: 1700000000000,
  };

  const analytics: SessionAnalytics = {
    sessionId: '202610-seears',
    sessionName: 'October 2026 Repair Café',
    date: '2026-10-10',
    isTest: false,
    totalItems: 32,
    repairedCount: 24,
    partialCount: 3,
    unfixableCount: 3,
    adviceCount: 2,
    takenHomeCount: 0,
    totalRepairTimeMinutes: 840,
    averageRepairTimeMinutes: 26,
    successRatePercent: 75,
    totalWeightDivertedKg: 48.5,
    categoryBreakdown: {
      ELECTRICAL: 18,
      MECHANICAL: 8,
      TEXTILE: 6,
    },
    mainsItemsCount: 16,
    patTestedCount: 16,
    patFailureRatePercent: 6,
    attendingVolunteersCount: 12,
    patTrainedCount: 3,
  };

  return {
    SAMPLE_VOLUNTEER: volunteer,
    SAMPLE_SESSION: session,
    SAMPLE_REPAIR_ITEM: repairItem,
    SAMPLE_PAT_INSTRUMENT: patInstrument,
    SAMPLE_ANALYTICS: analytics,
  };
});

// ---------------------------------------------------------------------------
// Module Mocks for Offline / Hermetic Vitest Execution
// ---------------------------------------------------------------------------

vi.mock('../src/hooks/useAuth', () => ({
  useAuth: () => ({
    user: { uid: 'admin-1', email: 'coordinator@suttonrepaircafe.org.uk' },
    loading: false,
    isAdmin: true,
    isUnauthorizedAccount: false,
    isVolunteerRole: true,
    signInOrganizer: vi.fn(),
    signOutUser: vi.fn(),
  }),
}));

vi.mock('../src/hooks/useActiveSession', () => ({
  useActiveSession: () => ({
    session: SAMPLE_SESSION,
    settings: { activeSessionId: SAMPLE_SESSION.id, allowRegistration: true },
    loading: false,
    error: null,
    refreshSession: vi.fn().mockResolvedValue(undefined),
  }),
}));

vi.mock('../src/hooks/useStationPinGate', () => ({
  useStationPinGate: () => ({
    isUnlocked: true,
    verifying: false,
    error: null,
    unlock: vi.fn().mockResolvedValue(true),
    lock: vi.fn(),
  }),
}));

vi.mock('../src/services/volunteerService', () => ({
  listVolunteers: vi.fn(async () => [SAMPLE_VOLUNTEER]),
  createVolunteer: vi.fn(),
  updateVolunteer: vi.fn(),
  deleteVolunteer: vi.fn(),
  buildAttendingVolunteerSnapshots: vi.fn(() => SAMPLE_SESSION.attendingVolunteers),
  filterPatQualifiedVolunteers: vi.fn((vols: unknown[]) => vols),
}));

vi.mock('../src/services/patInstrumentService', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../src/services/patInstrumentService')>();
  return {
    ...actual,
    listPatInstruments: vi.fn(async () => [SAMPLE_PAT_INSTRUMENT]),
    createPatInstrument: vi.fn(async () => SAMPLE_PAT_INSTRUMENT),
    updatePatInstrument: vi.fn(async () => SAMPLE_PAT_INSTRUMENT),
    deletePatInstrument: vi.fn(async () => undefined),
  };
});

vi.mock('../src/services/analyticsService', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../src/services/analyticsService')>();
  return {
    ...actual,
    getAllSessionAnalytics: vi.fn(async () => [SAMPLE_ANALYTICS]),
  };
});

vi.mock('../src/services/sessionService', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../src/services/sessionService')>();
  return {
    ...actual,
    listAllSessions: vi.fn(async () => [SAMPLE_SESSION]),
    updateSessionAttendance: vi.fn(async () => undefined),
  };
});

vi.mock('../src/services/repairService', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../src/services/repairService')>();
  return {
    ...actual,
    subscribeToSessionRepairs: vi.fn(
      (_sessionId: string, onData: (items: RepairItem[]) => void) => {
        onData([SAMPLE_REPAIR_ITEM]);
        return () => {};
      }
    ),
    getRepairByCardNumber: vi.fn(async () => SAMPLE_REPAIR_ITEM),
    fetchRepairPhotos: vi.fn(async () => []),
  };
});

import { Header } from '../src/components/layout/Header';
import { Navigation } from '../src/components/layout/Navigation';
import { OfflineNotice } from '../src/components/common/OfflineNotice';
import { UpdateBanner } from '../src/components/common/UpdateBanner';
import { SafetyBanner } from '../src/components/common/SafetyBanner';
import { CardToken } from '../src/components/common/CardToken';
import { TermsModal } from '../src/components/common/TermsModal';
import { PinModal } from '../src/components/common/PinModal';
import { PoliciesModal } from '../src/components/common/PoliciesModal';
import { PatInstrumentModal } from '../src/components/pat/PatInstrumentModal';
import { PhotoViewerModal } from '../src/components/common/PhotoViewerModal';
import { CustomerRegisterView } from '../src/views/CustomerRegisterView';
import { FrontDeskView } from '../src/views/FrontDeskView';
import { VolunteerRegisterPanel } from '../src/components/frontdesk/VolunteerRegisterPanel';
import { SessionAttendanceBar } from '../src/components/frontdesk/SessionAttendanceBar';
import { PatStationView } from '../src/views/PatStationView';
import { FixerStationView } from '../src/views/FixerStationView';
import { ReportsView } from '../src/views/ReportsView';
import { resetDialogStackForTesting } from '../src/hooks/useDialogFocusTrap';

const WCAG_22_AA_TAGS = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'];

function formatViolations(violations: axe.Result[]): string {
  if (violations.length === 0) return '';
  return violations
    .map(
      (v) =>
        `[${v.id}] (${v.impact}) ${v.help} (${v.helpUrl})\n` +
        v.nodes.map((n) => `  - ${n.html}\n    ${n.failureSummary}`).join('\n')
    )
    .join('\n\n');
}

async function setReactInputValue(input: HTMLInputElement, value: string): Promise<void> {
  await act(async () => {
    const nativeSetter = Object.getOwnPropertyDescriptor(
      window.HTMLInputElement.prototype,
      'value'
    )?.set;
    if (nativeSetter) {
      nativeSetter.call(input, value);
    } else {
      input.value = value;
    }
    input.dispatchEvent(new Event('input', { bubbles: true }));
    input.dispatchEvent(new Event('change', { bubbles: true }));
  });
}

describe('WCAG 2.2 Level AA Automated axe-core Audit', () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    resetDialogStackForTesting();
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(async () => {
    await act(async () => {
      root.unmount();
    });
    container.remove();
    resetDialogStackForTesting();
  });

  async function expectNoWcagViolations(ui: React.ReactElement) {
    await act(async () => {
      root.render(<MemoryRouter>{ui}</MemoryRouter>);
    });
    const results = await axe.run(container, {
      runOnly: {
        type: 'tag',
        values: WCAG_22_AA_TAGS,
      },
    });
    expect(results.violations, formatViolations(results.violations)).toEqual([]);
  }

  it('passes WCAG 2.2 AA audit for layout & common primitives (Header, Navigation, OfflineNotice, UpdateBanner, SafetyBanner, CardToken)', async () => {
    await expectNoWcagViolations(
      <div>
        <Header activeSession={SAMPLE_SESSION} onOpenPolicies={vi.fn()} />
        <Navigation />
        <OfflineNotice />
        <UpdateBanner visible={true} onRefreshNow={vi.fn()} onDismiss={vi.fn()} />
        <SafetyBanner outcome="PASS" cautionNotes="Passed earth and insulation checks" />
        <SafetyBanner outcome="FAIL_REPAIRABLE_CORD" cautionNotes="Replace frayed 13A plug lead" />
        <SafetyBanner outcome="DANGER_DO_NOT_ENERGIZE" cautionNotes="Live chassis fault" />
        <SafetyBanner outcome="UNTESTABLE" cautionNotes="Missing custom 19V power brick" />
        <CardToken number={null} />
        <CardToken number={12} />
        <CardToken number={12} dimmed />
      </div>
    );
  });

  it('passes WCAG 2.2 AA audit for TermsModal and PinModal', async () => {
    await expectNoWcagViolations(
      <div>
        <TermsModal isOpen={true} onClose={vi.fn()} />
      </div>
    );

    await expectNoWcagViolations(
      <div>
        <PinModal
          isOpen={true}
          stationName="PAT Safety Station"
          onVerify={vi.fn().mockResolvedValue(true)}
          onClose={vi.fn()}
          error="Incorrect PIN entered"
        />
      </div>
    );
  });

  it('passes WCAG 2.2 AA audit for PoliciesModal (rendering POL04 VPAT 2.5 tables) and PatInstrumentModal', async () => {
    await expectNoWcagViolations(
      <div>
        <PoliciesModal isOpen={true} onClose={vi.fn()} initialPolicyId="POL04" />
      </div>
    );

    await expectNoWcagViolations(
      <div>
        <PatInstrumentModal
          isOpen={true}
          mode="edit"
          initialInstrument={SAMPLE_PAT_INSTRUMENT}
          serviceIntervalMonths={12}
          existingInstruments={[SAMPLE_PAT_INSTRUMENT]}
          onClose={vi.fn()}
          onSaved={vi.fn()}
          onDeleted={vi.fn()}
        />
      </div>
    );
  });

  it('passes WCAG 2.2 AA audit for PhotoViewerModal', async () => {
    await expectNoWcagViolations(
      <div>
        <PhotoViewerModal
          isOpen={true}
          onClose={vi.fn()}
          sessionId={SAMPLE_SESSION.id}
          repairItem={SAMPLE_REPAIR_ITEM}
          initialPhotos={[
            {
              id: 'photo-1',
              repairId: SAMPLE_REPAIR_ITEM.id,
              sessionId: SAMPLE_SESSION.id,
              dataUrl:
                'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=',
              mimeType: 'image/webp',
              width: 400,
              height: 300,
              sizeBytes: 12345,
              createdAt: 1700000200000,
            },
          ]}
        />
      </div>
    );
  });

  it('passes WCAG 2.2 AA audit for Station 1: CustomerRegisterView', async () => {
    await expectNoWcagViolations(<CustomerRegisterView />);
  });

  it('passes WCAG 2.2 AA audit for Station 2: FrontDeskView, VolunteerRegisterPanel, and SessionAttendanceBar', async () => {
    await expectNoWcagViolations(<FrontDeskView />);
    await expectNoWcagViolations(<VolunteerRegisterPanel />);
    await expectNoWcagViolations(
      <SessionAttendanceBar
        session={SAMPLE_SESSION}
        allVolunteers={[SAMPLE_VOLUNTEER]}
        onSessionRefresh={vi.fn().mockResolvedValue(undefined)}
      />
    );
  });

  it('passes WCAG 2.2 AA audit for Station 3: PatStationView (lookup & active PAT inspection form)', async () => {
    await act(async () => {
      root.render(
        <MemoryRouter>
          <PatStationView />
        </MemoryRouter>
      );
    });

    // Populate card number and submit lookup form in separate act() steps so state flushes first
    const cardInput = container.querySelector<HTMLInputElement>('#pat-repair-item-lookup');
    expect(cardInput).not.toBeNull();
    if (cardInput) {
      await setReactInputValue(cardInput, '12');
    }
    const form = container.querySelector('form');
    if (form) {
      await act(async () => {
        form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
      });
    }

    expect(container.textContent).toContain('Dualit 4-Slice Toaster');

    const results = await axe.run(container, {
      runOnly: {
        type: 'tag',
        values: WCAG_22_AA_TAGS,
      },
    });
    expect(results.violations, formatViolations(results.violations)).toEqual([]);
  });

  it('passes WCAG 2.2 AA audit for Station 4: FixerStationView (lookup & active repair form)', async () => {
    await act(async () => {
      root.render(
        <MemoryRouter>
          <FixerStationView />
        </MemoryRouter>
      );
    });

    // Populate card number and submit lookup form in separate act() steps so state flushes first
    const cardInput = container.querySelector<HTMLInputElement>('#fixer-repair-item-lookup');
    expect(cardInput).not.toBeNull();
    if (cardInput) {
      await setReactInputValue(cardInput, '12');
    }
    const form = container.querySelector('form');
    if (form) {
      await act(async () => {
        form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
      });
    }

    expect(container.textContent).toContain('Dualit 4-Slice Toaster');

    const results = await axe.run(container, {
      runOnly: {
        type: 'tag',
        values: WCAG_22_AA_TAGS,
      },
    });
    expect(results.violations, formatViolations(results.violations)).toEqual([]);
  });

  it('passes WCAG 2.2 AA audit for Station 5: ReportsView', async () => {
    await expectNoWcagViolations(<ReportsView />);
  });
});
