// @vitest-environment happy-dom
import React, { act } from 'react';
import { createRoot, Root } from 'react-dom/client';
import { MemoryRouter } from 'react-router-dom';
import axe from 'axe-core';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  Session,
  RepairItem,
  Volunteer,
  PatInstrument,
  SessionAnalytics,
} from '../src/types';

const SAMPLE_VOLUNTEER: Volunteer = {
  id: 'vol-1',
  name: 'Alice Tester',
  email: 'alice@suttonrepaircafe.org.uk',
  phone: '07700900111',
  skills: 'Electrical, PAT Testing',
  isOrganiser: true,
  isPatTrained: true,
  inducted: true,
  inductedAt: 1768039200000,
  emergencyContactName: 'Bob Tester',
  emergencyContactPhone: '07700900222',
  emergencyContactRelationship: 'Spouse',
  createdAt: 1767261600000,
  updatedAt: 1768039200000,
};

const SAMPLE_SESSION: Session = {
  id: 'session-2026-10',
  name: 'October 2026 Repair Café',
  date: '2026-10-17',
  status: 'ACTIVE',
  volunteerPinHash: 'abc123hash',
  cardRangeStart: 1,
  cardRangeEnd: 50,
  createdAt: 1792227600000,
  attendingVolunteerIds: [SAMPLE_VOLUNTEER.id],
  attendingVolunteers: [
    {
      id: SAMPLE_VOLUNTEER.id,
      name: SAMPLE_VOLUNTEER.name,
      isOrganiser: true,
      isPatTrained: true,
      inducted: true,
    },
  ],
};

const SAMPLE_REPAIR_ITEM: RepairItem = {
  id: 'repair-1',
  sessionId: SAMPLE_SESSION.id,
  registrationId: 'reg-1',
  referenceToken: 'REF-A38F',
  cardNumber: 7,
  customerName: 'Sarah',
  status: 'WAITING_PAT1',
  createdAt: 1792228500000,
  updatedAt: 1792228800000,
  item: {
    category: 'ELECTRICAL',
    brandModel: 'Dualit 2-Slice Toaster',
    faultDescription: 'Lever does not stay down when pressed',
    powerType: 'MAINS_240V',
    weightKg: 2.4,
  },
};

const SAMPLE_PAT_INSTRUMENT: PatInstrument = {
  id: 'inst-1',
  displayName: 'Seaward PrimeTest 100',
  manufacturer: 'Seaward',
  model: 'PrimeTest 100',
  serialNumber: 'SW-90421',
  lastCalibratedDate: '2026-06-01',
  createdAt: 1780308000000,
  updatedAt: 1780308000000,
};

const SAMPLE_ANALYTICS: SessionAnalytics = {
  sessionId: 'session-2026-09',
  sessionName: 'September 2026 Repair Café',
  date: '2026-09-19',
  totalItems: 24,
  repairedCount: 18,
  partialCount: 2,
  adviceCount: 2,
  unfixableCount: 2,
  takenHomeCount: 0,
  totalWeightDivertedKg: 34.5,
  totalRepairTimeMinutes: 540,
  averageRepairTimeMinutes: 22.5,
  successRatePercent: 83.3,
  mainsItemsCount: 11,
  patTestedCount: 11,
  patFailureRatePercent: 9.1,
  categoryBreakdown: {
    ELECTRICAL: 11,
    TEXTILES: 7,
    MECHANICAL: 6,
  },
  volunteerCount: 14,
  finalizedAt: 1789826400000,
};

vi.mock('../src/services/firebase', () => ({
  app: {},
  db: {},
  auth: {},
  googleAuthProvider: {},
  functions: {},
}));

vi.mock('../src/hooks/useAuth', () => ({
  useAuth: () => ({
    user: {
      uid: 'org-1',
      email: 'info@suttonrepaircafe.org.uk',
      displayName: 'Organiser',
    },
    loading: false,
    isAdmin: true,
    isUnauthorisedUser: false,
    signInWithGoogle: vi.fn(),
    signOut: vi.fn(),
  }),
}));

vi.mock('../src/hooks/useVolunteerPin', () => ({
  useVolunteerPin: () => ({
    isUnlocked: true,
    isPinUnlocked: true,
    unlock: vi.fn().mockResolvedValue(true),
    lock: vi.fn(),
    error: null,
  }),
}));

vi.mock('../src/hooks/useRepairs', () => ({
  useRepairs: () => ({
    repairs: [SAMPLE_REPAIR_ITEM],
    loading: false,
    error: null,
  }),
}));

vi.mock('../src/services/volunteerService', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../src/services/volunteerService')>();
  return {
    ...actual,
    listVolunteers: vi.fn().mockResolvedValue([SAMPLE_VOLUNTEER]),
    syncOrganiserEmailsToSystemSettings: vi.fn().mockResolvedValue(undefined),
  };
});

vi.mock('../src/services/patInstrumentService', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../src/services/patInstrumentService')>();
  return {
    ...actual,
    listPatInstruments: vi.fn().mockResolvedValue([SAMPLE_PAT_INSTRUMENT]),
  };
});

vi.mock('../src/services/analyticsService', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../src/services/analyticsService')>();
  return {
    ...actual,
    listAllAnalytics: vi.fn().mockResolvedValue([SAMPLE_ANALYTICS]),
  };
});

vi.mock('../src/services/sessionService', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../src/services/sessionService')>();
  return {
    ...actual,
    publishAppVersionToSystemSettings: vi.fn().mockResolvedValue(undefined),
  };
});

vi.mock('../src/services/repairService', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../src/services/repairService')>();
  return {
    ...actual,
    getRepairByCardNumber: vi.fn().mockResolvedValue(SAMPLE_REPAIR_ITEM),
    fetchRepairPhotos: vi.fn().mockResolvedValue([]),
  };
});

import { UnsavedWorkProvider } from '../src/context/UnsavedWorkContext';
import { CustomerRegisterView } from '../src/views/CustomerRegisterView';
import { FrontDeskView } from '../src/views/FrontDeskView';
import { PatStationView } from '../src/views/PatStationView';
import { FixerStationView } from '../src/views/FixerStationView';
import { ReportsView } from '../src/views/ReportsView';
import { TermsModal } from '../src/components/common/TermsModal';
import { PinModal } from '../src/components/common/PinModal';
import { PoliciesModal } from '../src/components/common/PoliciesModal';
import { PhotoViewerModal } from '../src/components/common/PhotoViewerModal';
import { PatInstrumentModal } from '../src/components/pat/PatInstrumentModal';
import { resetDialogStackForTesting } from '../src/hooks/useDialogFocusTrap';

async function runAxeWcagAudit(container: HTMLElement): Promise<axe.Result[]> {
  const results = await axe.run(container, {
    runOnly: {
      type: 'tag',
      values: ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'],
    },
    rules: {
      // Colour contrast is verified statically in tests/wcagStaticGuardrails.test.ts because happy-dom does not rasterize 2D canvas styles
      'color-contrast': { enabled: false },
    },
  });
  return results.violations;
}

describe('Automated axe-core WCAG 2.2 Level AA Audits across Stations & Modals', () => {
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

  it('Station 1: CustomerRegisterView passes axe WCAG 2.2 AA audit', async () => {
    await act(async () => {
      root.render(
        <MemoryRouter initialEntries={['/register']}>
          <UnsavedWorkProvider>
            <CustomerRegisterView session={SAMPLE_SESSION} />
          </UnsavedWorkProvider>
        </MemoryRouter>
      );
    });

    const violations = await runAxeWcagAudit(container);
    expect(violations).toEqual([]);
  });

  it('Station 2: FrontDeskView (active session board & attendance bar) passes axe WCAG 2.2 AA audit', async () => {
    await act(async () => {
      root.render(
        <MemoryRouter initialEntries={['/frontdesk']}>
          <UnsavedWorkProvider>
            <FrontDeskView
              session={SAMPLE_SESSION}
              systemSettings={{ activeSessionId: SAMPLE_SESSION.id, allowRegistration: true }}
            />
          </UnsavedWorkProvider>
        </MemoryRouter>
      );
    });

    const violations = await runAxeWcagAudit(container);
    expect(violations).toEqual([]);
  });

  it('Station 3: PatStationView (with active Mains Class I item loaded) passes axe WCAG 2.2 AA audit', async () => {
    await act(async () => {
      root.render(
        <MemoryRouter initialEntries={['/pat']}>
          <UnsavedWorkProvider>
            <PatStationView session={SAMPLE_SESSION} />
          </UnsavedWorkProvider>
        </MemoryRouter>
      );
    });

    // Look up Card #7 so the full PAT 1 safety inspection form renders
    const lookupInput = container.querySelector<HTMLInputElement>('#pat-repair-item-lookup');
    expect(lookupInput).not.toBeNull();
    await act(async () => {
      if (lookupInput) {
        const setter = Object.getOwnPropertyDescriptor(
          window.HTMLInputElement.prototype,
          'value'
        )?.set;
        setter?.call(lookupInput, '7');
        lookupInput.dispatchEvent(new Event('input', { bubbles: true }));
      }
      const form = lookupInput?.closest('form');
      form?.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
    });

    const violations = await runAxeWcagAudit(container);
    expect(violations).toEqual([]);
  });

  it('Station 4: FixerStationView (with active item loaded) passes axe WCAG 2.2 AA audit', async () => {
    await act(async () => {
      root.render(
        <MemoryRouter initialEntries={['/fixer']}>
          <UnsavedWorkProvider>
            <FixerStationView session={SAMPLE_SESSION} />
          </UnsavedWorkProvider>
        </MemoryRouter>
      );
    });

    const lookupInput = container.querySelector<HTMLInputElement>('#fixer-repair-item-lookup');
    expect(lookupInput).not.toBeNull();
    await act(async () => {
      if (lookupInput) {
        const setter = Object.getOwnPropertyDescriptor(
          window.HTMLInputElement.prototype,
          'value'
        )?.set;
        setter?.call(lookupInput, '7');
        lookupInput.dispatchEvent(new Event('input', { bubbles: true }));
      }
      const form = lookupInput?.closest('form');
      form?.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
    });

    const violations = await runAxeWcagAudit(container);
    expect(violations).toEqual([]);
  });

  it('Station 5: ReportsView (with KPI cards, category progressbars, and session archive table) passes axe WCAG 2.2 AA audit', async () => {
    await act(async () => {
      root.render(
        <MemoryRouter initialEntries={['/reports']}>
          <UnsavedWorkProvider>
            <ReportsView />
          </UnsavedWorkProvider>
        </MemoryRouter>
      );
    });

    const violations = await runAxeWcagAudit(container);
    expect(violations).toEqual([]);
  });

  it('Shared Modals (TermsModal, PinModal, PoliciesModal, PhotoViewerModal, PatInstrumentModal) each pass axe WCAG 2.2 AA audit', async () => {
    const modals: React.ReactElement[] = [
      <TermsModal key="terms" isOpen={true} onClose={vi.fn()} onAccept={vi.fn()} />,
      <PinModal
        key="pin"
        isOpen={true}
        stationName="PAT Safety Station"
        onVerify={vi.fn().mockResolvedValue(true)}
        onClose={vi.fn()}
      />,
      <PoliciesModal key="policies" isOpen={true} onClose={vi.fn()} />,
      <PhotoViewerModal
        key="photo"
        isOpen={true}
        onClose={vi.fn()}
        sessionId={SAMPLE_SESSION.id}
        repairItem={SAMPLE_REPAIR_ITEM}
        initialPhotos={[]}
      />,
      <PatInstrumentModal
        key="instrument"
        isOpen={true}
        mode="add"
        existingInstruments={[SAMPLE_PAT_INSTRUMENT]}
        onClose={vi.fn()}
        onSaved={vi.fn()}
      />,
    ];

    for (const modalElement of modals) {
      resetDialogStackForTesting();
      await act(async () => {
        root.render(<UnsavedWorkProvider>{modalElement}</UnsavedWorkProvider>);
      });
      const violations = await runAxeWcagAudit(container);
      expect(violations).toEqual([]);
    }
  });
});
