import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, expect, test, vi } from 'vitest';
import { Prisma } from '../../../generated/prisma/client';
import { EnergyHistory } from './energy-history';
import { EquipmentEnergy } from './equipment-energy';
import { equipmentEnergyView } from '../energy-view';
import { saveEnergyAction } from '../energy-actions';
import { getElectricityTariffHistory } from '../energy-queries';
import TariffsPage from '../../../app/energy/tariffs/page';
import type { EnergyActionResult, EnergyRow } from '../energy-browser';

const { refresh } = vi.hoisted(() => ({ refresh: vi.fn() }));
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh }) }));
vi.mock('next/server', () => ({ connection: vi.fn() }));
vi.mock('../energy-actions', () => ({ saveEnergyAction: vi.fn() }));
vi.mock('../energy-queries', () => ({ getElectricityTariffHistory: vi.fn() }));
const row: EnergyRow = {
  id: 'p',
  effectiveFrom: '2026-09-01',
  effectiveTo: null,
  powerWatts: '70.00',
  hoursPerDay: '12.00',
  unitRateMinorPerKwh: '25.00000',
  notes: 'Light',
  correctionReason: null,
  voidedAt: null,
};
const props = {
  kind: 'power' as const,
  equipmentId: 'e',
  token: 'original-token',
  rows: [] as EnergyRow[],
  today: '2026-09-15',
};
beforeEach(() => {
  vi.resetAllMocks();
  vi.mocked(saveEnergyAction).mockResolvedValue({
    success: true,
    message: 'Energy history saved.',
  });
});
function set(label: string, value: string) {
  fireEvent.change(screen.getByLabelText(label), { target: { value } });
}

test.each([true, false])('empty Equipment section usesPower=%s', (usesPower) => {
  render(
    <EquipmentEnergy
      view={equipmentEnergyView({
        equipmentId: 'e',
        usesPower,
        token: 't',
        rows: [],
        tariffs: [],
        today: props.today,
      })}
    />,
  );
  expect(screen.getByRole('heading', { name: 'Power / Energy' })).toBeInTheDocument();
  if (usesPower) {
    expect(screen.getByRole('button', { name: 'Record power settings' })).toBeInTheDocument();
    expect(screen.getByText(/No power settings are recorded for part/)).toBeInTheDocument();
  } else {
    expect(screen.queryByRole('button', { name: 'Record power settings' })).not.toBeInTheDocument();
    expect(screen.getByText(/Power tracking is not enabled/)).toBeInTheDocument();
  }
});
test('current settings show engine values and projections without live claims', () => {
  render(
    <EquipmentEnergy
      view={equipmentEnergyView({
        equipmentId: 'e',
        usesPower: true,
        token: 't',
        rows: [row],
        tariffs: [row],
        today: props.today,
      })}
    />,
  );
  for (const text of [
    '0.84 kWh/day',
    '£0.21',
    '£76.65',
    'Configured operating power',
    'Estimated 30-day cost',
  ])
    expect(screen.getByText(text)).toBeInTheDocument();
  expect(screen.getByText(/Projections assume/)).toBeInTheDocument();
  expect(screen.queryByText('Power being used now')).not.toBeInTheDocument();
});
test.each([false, true])('missing tariff preserves energy and known zero=%s', (zero) => {
  render(
    <EquipmentEnergy
      view={equipmentEnergyView({
        equipmentId: 'e',
        usesPower: true,
        token: 't',
        rows: [{ ...row, powerWatts: zero ? '0' : '70' }],
        tariffs: [],
        today: props.today,
      })}
    />,
  );
  expect(screen.getByRole('link', { name: 'Manage electricity tariffs' })).toHaveAttribute(
    'href',
    '/energy/tariffs',
  );
  if (zero) expect(screen.getByText(/known zero energy consumption/)).toBeInTheDocument();
  else {
    expect(screen.getByText(/cost cannot currently be calculated/)).toBeInTheDocument();
    expect(screen.getByText(/known cost subtotal — incomplete coverage/)).toBeInTheDocument();
  }
});
test('record form preserves decimal strings, zero and 24 hours; successful save refreshes', async () => {
  const user = userEvent.setup();
  render(<EnergyHistory {...props} />);
  await user.click(screen.getByRole('button', { name: 'Record power settings' }));
  set('Power (W)', '0.00');
  set('Operating duration (hours/day)', '24');
  await user.click(screen.getByRole('button', { name: 'Save' }));
  const [context, data] = vi.mocked(saveEnergyAction).mock.calls[0];
  expect(context).toMatchObject({ mode: 'record', token: 'original-token' });
  expect(data.get('powerWatts')).toBe('0.00');
  expect(data.get('hoursPerDay')).toBe('24');
  expect(refresh).toHaveBeenCalledOnce();
  expect(screen.queryByLabelText('Power (W)')).not.toBeInTheDocument();
  expect(screen.getByRole('status')).toHaveTextContent('Energy history saved.');
});
test('validation and stale failures retain exact text and frozen token after refresh', async () => {
  const user = userEvent.setup();
  vi.mocked(saveEnergyAction).mockResolvedValue({
    success: false,
    stale: true,
    message: 'History changed. Values kept.',
    issues: [{ field: 'powerWatts', message: 'Review precision.' }],
  });
  const { rerender } = render(<EnergyHistory {...props} />);
  await user.click(screen.getByRole('button', { name: 'Record power settings' }));
  set('Power (W)', '70.001');
  set('Operating duration (hours/day)', '12.00');
  rerender(<EnergyHistory {...props} token="new-token" />);
  await user.click(screen.getByRole('button', { name: 'Save' }));
  expect(screen.getByLabelText('Power (W)')).toHaveValue('70.001');
  expect(screen.getByRole('alert')).toHaveFocus();
  expect(screen.getByRole('link', { name: 'reloading the latest history' })).toHaveAttribute(
    'href',
    '/equipment/e',
  );
  expect(vi.mocked(saveEnergyAction).mock.calls[0][0].token).toBe('original-token');
});
test('pending state prevents duplicate save and Cancel', async () => {
  let finish!: (value: EnergyActionResult) => void;
  vi.mocked(saveEnergyAction).mockImplementation(
    () =>
      new Promise((resolve) => {
        finish = resolve;
      }),
  );
  render(<EnergyHistory {...props} />);
  fireEvent.click(screen.getByRole('button', { name: 'Record power settings' }));
  const form = screen.getByRole('button', { name: 'Save' }).closest('form')!;
  fireEvent.submit(form);
  fireEvent.submit(form);
  expect(saveEnergyAction).toHaveBeenCalledOnce();
  expect(screen.getByRole('button', { name: 'Saving…' })).toBeDisabled();
  expect(screen.getByRole('button', { name: 'Cancel' })).toBeDisabled();
  await act(async () => finish({ success: false, message: 'Try again' }));
});
test('change preview preserves future successor and submits no end date', async () => {
  render(
    <EnergyHistory
      {...props}
      rows={[
        { ...row, effectiveTo: '2026-10-01' },
        { ...row, id: 'future', effectiveFrom: '2026-10-01' },
      ]}
    />,
  );
  fireEvent.click(screen.getByRole('button', { name: 'Change power settings' }));
  set('First day', '2026-09-21');
  expect(screen.getByText(/New settings: 21 Sept 2026 – 30 Sept 2026/)).toBeInTheDocument();
  expect(screen.getByText(/Any later scheduled records remain unchanged/)).toBeInTheDocument();
  expect(screen.queryByLabelText('Last day (optional)')).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'Save' }));
  await waitFor(() => expect(saveEnergyAction).toHaveBeenCalledOnce());
  expect(vi.mocked(saveEnergyAction).mock.calls[0][1].has('lastDay')).toBe(false);
});
test('correction reviews adjacent dates and confirmation resets when dates change', async () => {
  render(
    <EnergyHistory
      {...props}
      rows={[
        { ...row, effectiveTo: '2026-10-01' },
        { ...row, id: 'future', effectiveFrom: '2026-10-01' },
      ]}
    />,
  );
  fireEvent.click(screen.getAllByRole('button', { name: /^Correct/ })[0]);
  expect(screen.getByLabelText('Last day (optional)')).toHaveValue('2026-09-30');
  set('Last day (optional)', '2026-10-03');
  set('Correction reason', 'Wrong date');
  expect(screen.getByText(/Adjacent period:.*will become 4 Oct 2026/)).toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Save' })).toBeDisabled();
  fireEvent.click(screen.getByRole('checkbox'));
  expect(screen.getByRole('button', { name: 'Save' })).toBeEnabled();
  set('Last day (optional)', '2026-10-04');
  expect(screen.getByRole('checkbox')).not.toBeChecked();
  fireEvent.click(screen.getByRole('checkbox'));
  fireEvent.click(screen.getByRole('button', { name: 'Save' }));
  await waitFor(() => expect(saveEnergyAction).toHaveBeenCalledOnce());
  expect(vi.mocked(saveEnergyAction).mock.calls[0][1].get('confirmAdjacent')).toBe('yes');
});
test('void requires explicit confirmation; retained voided rows cannot be corrected again', async () => {
  render(
    <EnergyHistory
      {...props}
      rows={[row, { ...row, id: 'void', voidedAt: '2026-09-02', correctionReason: 'Duplicate' }]}
      canRecord={false}
    />,
  );
  expect(screen.getByText('Voided — excluded from calculations')).toBeInTheDocument();
  expect(screen.getAllByRole('button', { name: /^Correct/ })).toHaveLength(1);
  fireEvent.click(screen.getByRole('button', { name: /^Void record/ }));
  expect(
    screen.getByText(/Neighbouring periods are not automatically stretched/),
  ).toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Confirm Void' })).toBeDisabled();
  set('Correction reason', 'Duplicate');
  fireEvent.click(screen.getByRole('checkbox'));
  fireEvent.click(screen.getByRole('button', { name: 'Confirm Void' }));
  await waitFor(() => expect(saveEnergyAction).toHaveBeenCalledOnce());
  expect(vi.mocked(saveEnergyAction).mock.calls[0][1].get('correctionReason')).toBe('Duplicate');
});
test('Cancel and transport failures preserve safe behaviour', async () => {
  vi.mocked(saveEnergyAction).mockRejectedValue(new Error('transport secret'));
  render(<EnergyHistory {...props} />);
  fireEvent.click(screen.getByRole('button', { name: 'Record power settings' }));
  set('Power (W)', '12.50');
  fireEvent.click(screen.getByRole('button', { name: 'Save' }));
  expect(await screen.findByRole('alert')).not.toHaveTextContent('secret');
  expect(screen.getByLabelText('Power (W)')).toHaveValue('12.50');
  fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
  expect(screen.getByRole('heading', { name: 'Power history' })).toHaveFocus();
});
test('tariff empty page links Equipment and describes exact pence entry, not pounds', async () => {
  vi.mocked(getElectricityTariffHistory).mockResolvedValue({
    tariffs: [],
    timelineToken: 'a'.repeat(64),
  });
  render(await TariffsPage());
  expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('Electricity tariffs');
  expect(screen.getByText(/No tariff applies today/)).toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'Record tariff' }));
  expect(screen.getByText(/Enter the electricity unit rate in pence per kWh/)).toBeInTheDocument();
  expect(screen.queryByLabelText('Currency')).not.toBeInTheDocument();
  set('Unit rate (pence per kWh)', '24.50123');
  fireEvent.click(screen.getByRole('button', { name: 'Save' }));
  await waitFor(() => expect(saveEnergyAction).toHaveBeenCalledOnce());
  expect(vi.mocked(saveEnergyAction).mock.calls[0][1].get('unitRateMinorPerKwh')).toBe('24.50123');
});
test('tariff page shows current and void history with natural dates and retained precision', async () => {
  const stored = {
    id: 'tariff',
    unitRateMinorPerKwh: new Prisma.Decimal('24.50123'),
    currency: 'GBP',
    effectiveFrom: new Date('2020-01-01'),
    effectiveTo: null,
    notes: 'Home',
    correctionReason: null,
    voidedAt: null,
    createdAt: new Date('2020-01-01'),
    updatedAt: new Date('2020-01-01'),
  };
  vi.mocked(getElectricityTariffHistory).mockResolvedValue({
    tariffs: [
      stored,
      { ...stored, id: 'void', voidedAt: new Date('2020-01-01'), correctionReason: 'Wrong bill' },
    ],
    timelineToken: 'b'.repeat(64),
  });
  render(await TariffsPage());
  expect(screen.getAllByText('24.50123 p/kWh')).toHaveLength(3);
  expect(screen.getByText('Voided — excluded from calculations')).toBeInTheDocument();
  expect(screen.getByText('Reason: Wrong bill')).toBeInTheDocument();
});
test.each(['change', 'correct', 'void'] as const)(
  'tariff %s form carries frozen timeline token and distinct semantics',
  async (mode) => {
    render(<EnergyHistory {...props} kind="tariff" rows={[row]} token={'a'.repeat(64)} />);
    fireEvent.click(
      screen.getByRole('button', {
        name:
          mode === 'change' ? 'Change tariff' : mode === 'correct' ? /^Correct/ : /^Void record/,
      }),
    );
    if (mode === 'change') set('First day', '2026-09-21');
    if (mode !== 'change') set('Correction reason', 'Reason');
    if (mode === 'void') fireEvent.click(screen.getByRole('checkbox'));
    fireEvent.click(
      screen.getByRole('button', { name: mode === 'void' ? 'Confirm Void' : 'Save' }),
    );
    await waitFor(() => expect(saveEnergyAction).toHaveBeenCalledOnce());
    expect(vi.mocked(saveEnergyAction).mock.calls[0][0]).toMatchObject({
      kind: 'tariff',
      mode,
      token: 'a'.repeat(64),
    });
  },
);
