// @vitest-environment happy-dom
import React, { act } from 'react';
import { createRoot, Root } from 'react-dom/client';
import { MemoryRouter } from 'react-router-dom';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import axe from 'axe-core';
import type {
  RepairItem,
  Session,
  SessionAnalytics,
  Volunteer,
  PatInstrument,
} from '../src/types/models';

(globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;

const {
  MOCK_ADMIN_USER,
  SAMPLE_SESSION,
  SAMPLE_VOLUNTEER,
  SAMPLE_REPAIR_ITEM,
  SAMPLE_INSTRUMENT,
  SAMPLE_ANALYTICS,
} = vi.hoisted(() => {
  const MOCK_ADMIN_USER = {
    email: 'admin@suttonrepaircafe.org',
    uid: 'admin-1',
  };

  const SAMPLE_SESSION: Session = {
    id: 'session-2026-10',
    name: 'October 2026 Sutton Repair Café',
    date: '2026-10-19',
    status: 'ACTIVE',
    volunteerPinHash: '0123456789abcdef',
    cardRangeStart: 1,
    cardRangeEnd: 50,
    checkedInVolunteerIds: ['vol-1'],
    createdAt: '2026-10-19T09:00:00.000Z',
  };

  const SAMPLE_VOLUNTEER: Volunteer = {
    id: 'vol-1',
    name: 'Alex Rivera',
    email: 'alex@example.org',
    phone: '07700 900123',
    skills: ['Electrical', 'PAT Testing'],
    roles: ['Fixer', 'PAT Tester'],
    emergencyContactName: 'Sam Rivera',
    emergencyContactPhone: '07700 900999',
    emergencyContactRelation: 'Partner',
    active: true,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
  };

  const SAMPLE_REPAIR_ITEM: RepairItem = {
    id: 'repair-1',
    sessionId: 'session-2026-10',
    registrationId: 'reg-1',
    referenceToken: 'REF-A38F',
    cardNumber: 7,
    customerName: 'Sarah',
    status: 'WAITING_PAT1',
    item: {
      category: 'Electrical / Mains Appliance',
      brandModel: 'Dualit 2-Slice Toaster',
      faultDescription: 'Heating element on left slot does not stay down',
      powerType: 'MAINS_240V',
      weightKg: 2.4,
    },
    photos: [
      {
        id: 'photo-1',
        storagePath: 'sessions/session-2026-10/repairs/repair-1/photo-1.jpg',
        downloadUrl: 'data:image/gif;base64,R0lGODlhAQABAAAAACwAAAAAAQABAAA=',
        uploadedBy: 'Alex Rivera',
        uploadedAt: '2026-10-19T10:15:00.000Z',
      },
    ],
    createdAt: '2026-10-19T10:00:00.000Z',
    updatedAt: '2026-10-19T10:05:00.000Z',
  };

  const SAMPLE_INSTRUMENT: PatInstrument = {
    id: 'inst-1',
    name: 'Seaward PrimeTest 100',
    makeModel: 'Seaward PrimeTest 100',
    serialNumber: 'SN-99281',
    calibrationExpiresAt: '2027-06-01',
    active: true,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
  };

  const SAMPLE_ANALYTICS: SessionAnalytics = {
    sessionId: 'session-2026-09',
    sessionName: 'September 2026 Sutton Repair Café',
    sessionDate: '2026-09-21',
    totalItems: 24,
    completedCount: 24,
    fixedCount: 17,
    partialCount: 2,
    adviceCount: 2,
    unfixableCount: 2,
    takenHomeCount: 1,
    repairSuccessRate: 79.2,
    totalWeightDivertedKg: 42.5,
    totalVolunteerMinutes: 690,
    categoryBreakdown: {
      'Electrical / Mains Appliance': 11,
      'Mechanical / Household': 7,
      'Textile / Clothing': 6,
    },
    finalizedAt: '2026-09-21T14:00:00.000Z',
  };

  return {
    MOCK_ADMIN_USER,
    SAMPLE_SESSION,
    SAMPLE_VOLUNTEER,
    SAMPLE_REPAIR_ITEM,
    SAMPLE_INSTRUMENT,
    SAMPLE_ANALYTICS,
  };
});

vi.mock('../src/config/firebase', () => ({
  db: {},
  auth: {},
  functions: {},
  storage: {},
  googleProvider: {},
}));

vi.mock('../src/hooks/useAuth', () => ({
  useAuth: () => ({
    user: MOCK_ADMIN_USER,
    isVolunteer: true,
    isAdmin: true,
    loading: false,
    verifyPin: vi.fn().mockResolvedValue(true),
    signInAdmin: vi.fn().mockResolvedValue(undefined),
    signOut: vi.fn().mockResolvedValue(undefined),
  }),
  isAuthorizedOrganizer: () => true,
}));

vi.mock('../src/hooks/useActiveSession', () => ({
  useActiveSession: () => ({
    session: SAMPLE_SESSION,
    systemSettings: {
      activeSessionId: SAMPLE_SESSION.id,
      allowRegistration: true,
    },
    loading: false,
    error: null,
  }),
}));

vi.mock('../src/services/repairService', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../src/services/repairService')>();
  return {
    ...actual,
    subscribeToSessionRepairs: vi.fn(
      (_sessionId: string, callback: (items: RepairItem[]) => void) => {
        callback([SAMPLE_REPAIR_ITEM]);
        return () => {};
      }
    ),
    getRepairByCardNumber: vi.fn().mockResolvedValue(SAMPLE_REPAIR_ITEM),
    getCustomerPrivateRecord: vi.fn().mockResolvedValue({
      firstName: 'Sarah',
      contactPhone: '07700 900456',
      agreedToTerms: true,
      termsVersion: '1.0',
      registeredAt: '2026-10-19T10:00:00.000Z',
    }),
  };
});

vi.mock('../src/services/volunteerService', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../src/services/volunteerService')>();
  return {
    ...actual,
    listVolunteers: vi.fn().mockResolvedValue([SAMPLE_VOLUNTEER]),
    getAllVolunteers: vi.fn().mockResolvedValue([SAMPLE_VOLUNTEER]),
    getActiveVolunteers: vi.fn().mockResolvedValue([SAMPLE_VOLUNTEER]),
    subscribeToVolunteers: vi.fn((callback: (vols: Volunteer[]) => void) => {
      callback([SAMPLE_VOLUNTEER]);
      return () => {};
    }),
  };
});

vi.mock('../src/services/patInstrumentService', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../src/services/patInstrumentService')>();
  return {
    ...actual,
    listPatInstruments: vi.fn().mockResolvedValue([SAMPLE_INSTRUMENT]),
    getActivePatInstruments: vi.fn().mockResolvedValue([SAMPLE_INSTRUMENT]),
    getAllPatInstruments: vi.fn().mockResolvedValue([SAMPLE_INSTRUMENT]),
  };
});

vi.mock('../src/services/analyticsService', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../src/services/analyticsService')>();
  return {
    ...actual,
    getAllSessionAnalytics: vi.fn().mockResolvedValue([SAMPLE_ANALYTICS]),
  };
});

vi.mock('../src/services/sessionService', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../src/services/sessionService')>();
  return {
    ...actual,
    getAllSessions: vi.fn().mockResolvedValue([SAMPLE_SESSION]),
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
import { PhotoViewerModal } from '../src/components/common/PhotoViewerModal';
import { PatInstrumentModal } from '../src/components/pat/PatInstrumentModal';
import { CustomerRegisterView } from '../src/views/CustomerRegisterView';
import { FrontDeskView } from '../src/views/FrontDeskView';
import { VolunteerRegisterPanel } from '../src/components/frontdesk/VolunteerRegisterPanel';
import { SessionAttendanceBar } from '../src/components/frontdesk/SessionAttendanceBar';
import { PatStationView } from '../src/views/PatStationView';
import { FixerStationView } from '../src/views/FixerStationView';
import { ReportsView } from '../src/views/ReportsView';
import { resetDialogStackForTesting } from '../src/hooks/useDialogFocusTrap';

const WCAG_TAGS = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'];

describe('Automated axe-core WCAG 2.2 AA Audit (Layer 2)', () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    resetDialogStackForTesting();
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        text: async () => '# Terms & Conditions\n\nSample terms.',
      })
    );
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
    vi.unstubAllGlobals();
  });

  async function renderAndAudit(ui: React.ReactElement): Promise<void> {
    await act(async () => {
      root.render(<MemoryRouter>{ui}</MemoryRouter>);
    });
    await act(async () => {
      await new Promise((r) => setTimeout(r, 0));
    });

    const results = await axe.run(container, {
      runOnly: {
        type: 'tag',
        values: WCAG_TAGS,
      },
    });

    const formattedViolations = results.violations.map((v) => ({
      id: v.id,
      impact: v.impact,
      description: v.description,
      nodes: v.nodes.map((n) => n.html),
    }));

    expect(formattedViolations).toEqual([]);
  }

  it('audits layout primitives: Header, Navigation, OfflineNotice, UpdateBanner, CardToken, and SafetyBanner (all 4 outcomes)', async () => {
    await renderAndAudit(
      <div>
        <Header session={SAMPLE_SESSION} />
        <Navigation />
        <OfflineNotice />
        <UpdateBanner />
        <CardToken number={12} />
        <CardToken number={null} />
        <CardToken number={8} dimmed />
        <SafetyBanner
          patInitial={{
            testerName: 'Alex Rivera',
            testedAt: '2026-10-19T10:10:00.000Z',
            applianceClass: 'CLASS_I',
            visualInspectionPass: true,
            outcome: 'PASS',
          }}
        />
        <SafetyBanner
          patInitial={{
            testerName: 'Alex Rivera',
            testedAt: '2026-10-19T10:10:00.000Z',
            applianceClass: 'CLASS_I',
            visualInspectionPass: false,
            outcome: 'FAIL_REPAIRABLE_CORD',
            notes: 'Damaged outer sheath near plug',
          }}
        />
        <SafetyBanner
          patInitial={{
            testerName: 'Alex Rivera',
            testedAt: '2026-10-19T10:10:00.000Z',
            applianceClass: 'CLASS_I',
            visualInspectionPass: false,
            outcome: 'DANGER_DO_NOT_ENERGIZE',
            notes: 'Live chassis short detected',
          }}
        />
        <SafetyBanner
          patInitial={{
            testerName: 'Alex Rivera',
            testedAt: '2026-10-19T10:10:00.000Z',
            applianceClass: 'CLASS_II',
            visualInspectionPass: true,
            outcome: 'UNTESTABLE',
            notes: 'Proprietary PSU missing',
          }}
        />
      </div>
    );
  });

  it('audits TermsModal when open', async () => {
    await renderAndAudit(<TermsModal isOpen={true} onClose={() => {}} />);
  });

  it('audits PinModal when open', async () => {
    await renderAndAudit(
      <PinModal
        isOpen={true}
        sessionName={SAMPLE_SESSION.name}
        onVerify={async () => true}
        onClose={() => {}}
      />
    );
  });

  it('audits PoliciesModal rendering POL04 Accessibility VPAT', async () => {
    await renderAndAudit(
      <PoliciesModal isOpen={true} onClose={() => {}} initialPolicyId="POL04" />
    );
  });

  it('audits PhotoViewerModal when open', async () => {
    await renderAndAudit(
      <PhotoViewerModal
        photos={SAMPLE_REPAIR_ITEM.photos!}
        initialIndex={0}
        itemTitle="Dualit 2-Slice Toaster"
        cardNumber={7}
        canDelete={true}
        onDeletePhoto={async () => {}}
        onClose={() => {}}
      />
    );
  });

  it('audits PatInstrumentModal when open', async () => {
    await renderAndAudit(
      <PatInstrumentModal
        isOpen={true}
        onClose={() => {}}
        instruments={[SAMPLE_INSTRUMENT]}
        onInstrumentsChanged={() => {}}
      />
    );
  });

  it('audits Station 1: CustomerRegisterView', async () => {
    await renderAndAudit(
      <CustomerRegisterView
        session={SAMPLE_SESSION}
        systemSettings={{ activeSessionId: SAMPLE_SESSION.id, allowRegistration: true }}
      />
    );
  });

  it('audits Station 2: FrontDeskView, VolunteerRegisterPanel, and SessionAttendanceBar', async () => {
    await renderAndAudit(
      <div>
        <FrontDeskView
          session={SAMPLE_SESSION}
          systemSettings={{ activeSessionId: SAMPLE_SESSION.id, allowRegistration: true }}
        />
        <VolunteerRegisterPanel isAdmin={true} currentUserEmail="admin@suttonrepaircafe.org" />
        <SessionAttendanceBar session={SAMPLE_SESSION} isAdmin={true} />
      </div>
    );
  });

  it('audits Station 3: PatStationView with active item loaded', async () => {
    await act(async () => {
      root.render(
        <MemoryRouter>
          <PatStationView session={SAMPLE_SESSION} />
        </MemoryRouter>
      );
    });
    await act(async () => {
      const lookupInput = container.querySelector<HTMLInputElement>('#pat-repair-item-lookup');
      if (lookupInput) {
        const nativeInputValueSetter = Object.getOwnPropertyDescriptor(
          window.HTMLInputElement.prototype,
          'value'
        )?.set;
        nativeInputValueSetter?.call(lookupInput, '7');
        lookupInput.dispatchEvent(new Event('input', { bubbles: true }));
      }
    });
    await act(async () => {
      const lookupInput = container.querySelector<HTMLInputElement>('#pat-repair-item-lookup');
      lookupInput?.form?.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
    });
    await act(async () => {
      await new Promise((r) => setTimeout(r, 0));
    });

    const results = await axe.run(container, {
      runOnly: { type: 'tag', values: WCAG_TAGS },
    });
    expect(results.violations.map((v) => ({ id: v.id, nodes: v.nodes.map((n) => n.html) }))).toEqual([]);
  });

  it('audits Station 4: FixerStationView with active item loaded', async () => {
    await act(async () => {
      root.render(
        <MemoryRouter>
          <FixerStationView session={SAMPLE_SESSION} />
        </MemoryRouter>
      );
    });
    await act(async () => {
      const lookupInput = container.querySelector<HTMLInputElement>('#fixer-repair-item-lookup');
      if (lookupInput) {
        const nativeInputValueSetter = Object.getOwnPropertyDescriptor(
          window.HTMLInputElement.prototype,
          'value'
        )?.set;
        nativeInputValueSetter?.call(lookupInput, '7');
        lookupInput.dispatchEvent(new Event('input', { bubbles: true }));
      }
    });
    await act(async () => {
      const lookupInput = container.querySelector<HTMLInputElement>('#fixer-repair-item-lookup');
      lookupInput?.form?.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
    });
    await act(async () => {
      await new Promise((r) => setTimeout(r, 0));
    });

    const results = await axe.run(container, {
      runOnly: { type: 'tag', values: WCAG_TAGS },
    });
    expect(results.violations.map((v) => ({ id: v.id, nodes: v.nodes.map((n) => n.html) }))).toEqual([]);
  });

  it('audits Station 5: ReportsView with session archive and category breakdown', async () => {
    await renderAndAudit(<ReportsView />);
  });
});
