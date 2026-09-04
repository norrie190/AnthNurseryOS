'use client';

import { useEffect, useId, useRef, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { saveEnergyAction } from '../energy-actions';
import {
  changeReview,
  compactDecimal,
  correctionReview,
  exclusiveEnd,
  humanRange,
  shiftDay,
  type EnergyActionResult,
  type EnergyContext,
  type EnergyMode,
  type EnergyRow,
} from '../energy-browser';
import { includesDate } from '../energy-periods';
import styles from './energy.module.css';
import { InlineNotice, STALE_CONFLICT_MESSAGE } from '../../../components/ui/inline-notice';

type Props = {
  kind: 'power' | 'tariff';
  equipmentId?: string;
  token: string;
  rows: EnergyRow[];
  today: string;
  canRecord?: boolean;
};
type Editor = { context: EnergyContext; rows: EnergyRow[]; row?: EnergyRow };
const labels: Record<string, string> = {
  powerWatts: 'Power (W)',
  hoursPerDay: 'Operating duration (hours/day)',
  unitRateMinorPerKwh: 'Unit rate (pence per kWh)',
  effectiveFrom: 'First day',
  lastDay: 'Last day (optional)',
  notes: 'Notes (optional)',
  correctionReason: 'Correction reason',
};

export function EnergyHistory({ kind, equipmentId, token, rows, today, canRecord = true }: Props) {
  const router = useRouter();
  const [editor, setEditor] = useState<Editor | null>(null);
  const [message, setMessage] = useState('');
  const [refreshing, startRefresh] = useTransition();
  const heading = useRef<HTMLHeadingElement>(null);
  const subject = kind === 'power' ? 'power settings' : 'tariff';

  function open(mode: EnergyMode, row?: EnergyRow) {
    setMessage('');
    // Freeze both the preview and token for this edit, including across refreshes.
    setEditor({ context: { kind, equipmentId, mode, periodId: row?.id, token }, rows, row });
  }
  function close() {
    setEditor(null);
    heading.current?.focus();
  }
  return (
    <div className={styles.stack}>
      <h3 ref={heading} tabIndex={-1}>
        {kind === 'power' ? 'Power history' : 'Tariff history'}
      </h3>
      <p>Dates include both the first and last day shown. Gaps mean unknown data, not zero.</p>
      {message && (
        <InlineNotice variant="success" role="status">
          {message}
        </InlineNotice>
      )}
      {!editor && canRecord && (
        <div className={styles.actions}>
          <button className={styles.primary} disabled={refreshing} onClick={() => open('record')}>
            Record {subject}
          </button>
          {rows.some((row) => !row.voidedAt) && (
            <button
              className={styles.secondary}
              disabled={refreshing}
              onClick={() => open('change')}
            >
              Change {subject}
            </button>
          )}
        </div>
      )}
      {editor && (
        <EnergyEditor
          key={`${editor.context.mode}-${editor.context.periodId ?? 'new'}`}
          editor={editor}
          today={today}
          onCancel={close}
          onSaved={(text) => {
            close();
            setMessage(text);
            startRefresh(() => router.refresh());
          }}
        />
      )}
      {!rows.length ? (
        <p>
          No {kind === 'power' ? 'operating settings' : 'electricity tariffs'} have been recorded.
        </p>
      ) : (
        <ol
          className={styles.history}
          aria-label={kind === 'power' ? 'Power history' : 'Tariff history'}
        >
          {rows.map((row) => (
            <li key={row.id} className={styles.historyRow}>
              <div className={styles.stack}>
                <strong>{humanRange(row.effectiveFrom, row.effectiveTo)}</strong>
                <span>
                  {kind === 'power'
                    ? `${compactDecimal(row.powerWatts!)} W · ${compactDecimal(row.hoursPerDay!)} hours/day`
                    : `${compactDecimal(row.unitRateMinorPerKwh!)} p/kWh`}
                </span>
                {row.voidedAt ? (
                  <strong>Voided — excluded from calculations</strong>
                ) : includesDate(row, today) ? (
                  <span className={styles.badge}>Currently applicable</span>
                ) : row.effectiveFrom > today ? (
                  <span className={styles.badge}>Scheduled</span>
                ) : null}
                {row.notes && <p className={styles.notes}>{row.notes}</p>}
                {row.correctionReason && (
                  <p className={styles.notes}>Reason: {row.correctionReason}</p>
                )}
              </div>
              {!row.voidedAt && (
                <div className={styles.actions}>
                  <button
                    className={styles.secondary}
                    disabled={!!editor || refreshing}
                    aria-label={`Correct ${humanRange(row.effectiveFrom, row.effectiveTo)}`}
                    onClick={() => open('correct', row)}
                  >
                    Correct
                  </button>
                  <button
                    className={styles.secondary}
                    disabled={!!editor || refreshing}
                    aria-label={`Void record ${humanRange(row.effectiveFrom, row.effectiveTo)}`}
                    onClick={() => open('void', row)}
                  >
                    Void record
                  </button>
                </div>
              )}
            </li>
          ))}
        </ol>
      )}
    </div>
  );
}

function EnergyEditor({
  editor,
  today,
  onCancel,
  onSaved,
}: {
  editor: Editor;
  today: string;
  onCancel: () => void;
  onSaved: (message: string) => void;
}) {
  const { context, rows, row } = editor;
  const { kind, mode } = context;
  const current = rows.find((entry) => !entry.voidedAt && includesDate(entry, today));
  const source = row ?? (mode === 'change' ? current : undefined);
  const [values, setValues] = useState<Record<string, string>>({
    powerWatts: source?.powerWatts ?? '',
    hoursPerDay: source?.hoursPerDay ?? '',
    unitRateMinorPerKwh: source?.unitRateMinorPerKwh ?? '',
    effectiveFrom: row?.effectiveFrom ?? today,
    lastDay: row?.effectiveTo ? shiftDay(row.effectiveTo, -1) : '',
    notes: source?.notes ?? '',
    correctionReason: '',
  });
  const [confirmed, setConfirmed] = useState(false);
  const [result, setResult] = useState<EnergyActionResult | null>(null);
  const [pending, startTransition] = useTransition();
  const submitting = useRef(false);
  const titleRef = useRef<HTMLHeadingElement>(null);
  const errorRef = useRef<HTMLDivElement>(null);
  const prefix = useId();
  useEffect(() => {
    titleRef.current?.focus();
  }, []);
  useEffect(() => {
    if (result && !result.success) errorRef.current?.focus();
  }, [result]);

  let preview: string[] = [];
  let previewError = '';
  let adjacent = false;
  try {
    if (mode === 'change') {
      const plan = changeReview(rows, values.effectiveFrom);
      preview = [
        `New settings: ${humanRange(values.effectiveFrom, plan.effectiveTo)}.`,
        ...(plan.previous
          ? [
              `Previous settings will end on ${humanRange(plan.previous.effectiveFrom, values.effectiveFrom)}.`,
            ]
          : []),
        'Any later scheduled records remain unchanged. Existing gaps are not automatically filled.',
      ];
    } else if (mode === 'correct' && row) {
      const review = correctionReview(
        rows,
        row,
        values.effectiveFrom,
        exclusiveEnd(values.lastDay),
      );
      adjacent = review.neighbours.length > 0;
      preview = review.neighbours.map((entry) => {
        const original = rows.find((old) => old.id === entry.id)!;
        return `Adjacent period: ${humanRange(original.effectiveFrom, original.effectiveTo)} will become ${humanRange(entry.effectiveFrom, entry.effectiveTo)}. Its operating values/rate remain unchanged.`;
      });
    }
  } catch (error) {
    previewError = error instanceof Error ? error.message : 'Review these dates.';
  }

  const fields =
    mode === 'void'
      ? ['correctionReason']
      : [
          ...(kind === 'power' ? ['powerWatts', 'hoursPerDay'] : ['unitRateMinorPerKwh']),
          'effectiveFrom',
          ...(mode !== 'change' ? ['lastDay'] : []),
          'notes',
          ...(mode === 'correct' ? ['correctionReason'] : []),
        ];
  const title =
    mode === 'void'
      ? 'Void record'
      : mode === 'correct'
        ? `Correct ${kind === 'power' ? 'power period' : 'tariff'}`
        : `${mode === 'change' ? 'Change' : 'Record'} ${kind === 'power' ? 'power settings' : 'tariff'}`;
  return (
    <form
      className={styles.editor}
      noValidate
      aria-busy={pending}
      onSubmit={(event) => {
        event.preventDefault();
        if (pending || submitting.current) return;
        submitting.current = true;
        setResult(null);
        const data = new FormData(event.currentTarget);
        startTransition(async () => {
          try {
            const response = await saveEnergyAction(context, data);
            if (response.success) onSaved(response.message);
            else setResult(response);
          } catch {
            setResult({
              success: false,
              message:
                'We could not confirm this save. Your values have been kept. Reload to check the history before trying again.',
            });
          } finally {
            submitting.current = false;
          }
        });
      }}
    >
      <h4 ref={titleRef} tabIndex={-1}>
        {title}
      </h4>
      {mode === 'change' && (
        <p>
          Use this for a genuine operational/rate change from today or a future date. Earlier
          history is preserved; new rates do not replace previous rates in historical estimates.
          {current && (
            <>
              {' '}
              Currently applicable:{' '}
              {kind === 'power'
                ? `${compactDecimal(current.powerWatts!)} W / ${compactDecimal(current.hoursPerDay!)} hours/day`
                : `${compactDecimal(current.unitRateMinorPerKwh!)} p/kWh`}
              .
            </>
          )}
        </p>
      )}
      {mode === 'correct' && (
        <p>
          Use correction only for information entered incorrectly. This may change historical
          estimates. Review any adjacent boundary changes below.
        </p>
      )}
      {mode === 'void' && (
        <p>
          This record remains stored but will be excluded from calculations. This may leave a gap in
          known {kind === 'power' ? 'energy history' : 'cost coverage'}. Neighbouring periods are
          not automatically stretched. This does not delete the record.
        </p>
      )}
      {mode !== 'void' && (
        <p id={`${prefix}-guidance`}>
          {kind === 'tariff'
            ? 'Enter the electricity unit rate in pence per kWh. For example, 24.5 (not £0.245). GBP only, up to 5 decimal places. Standing charges are excluded.'
            : 'Use watts and hours per day, up to 2 decimal places. For example, 70 W and 12 hours/day. Zero is a known zero; 24 hours/day is allowed.'}
        </p>
      )}
      {result && !result.success && (
        <InlineNotice
          variant={result.stale ? 'warning' : 'error'}
          role="alert"
          tabIndex={-1}
          ref={errorRef}
          className={styles.warning}
        >
          <p>{result.message}</p>
          {!!result.issues?.length && (
            <ul>
              {result.issues.map((issue, index) => (
                <li key={index}>
                  {labels[issue.field] ? (
                    <a href={`#${prefix}-${issue.field}`}>
                      {labels[issue.field]}: {issue.message}
                    </a>
                  ) : (
                    issue.message
                  )}
                </li>
              ))}
            </ul>
          )}
          {result.stale && (
            <p>
              {STALE_CONFLICT_MESSAGE} Copy any values you want to keep before{' '}
              <a href={kind === 'power' ? `/equipment/${context.equipmentId}` : '/energy/tariffs'}>
                reloading the latest history
              </a>
              . No newer changes have been overwritten.
            </p>
          )}
        </InlineNotice>
      )}
      <fieldset disabled={pending} className={styles.fields}>
        <legend className={styles.srOnly}>{title}</legend>
        {fields.map((field) => {
          const issue =
            result && !result.success
              ? result.issues?.find((item) => item.field === field)
              : undefined;
          const textarea = field === 'notes' || field === 'correctionReason';
          const date = field === 'effectiveFrom' || field === 'lastDay';
          const props = {
            id: `${prefix}-${field}`,
            name: field,
            value: values[field],
            onChange: (event: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => {
              setValues({ ...values, [field]: event.target.value });
              setConfirmed(false);
            },
            'aria-invalid': !!issue,
            'aria-describedby': issue
              ? `${prefix}-${field}-error`
              : mode !== 'void'
                ? `${prefix}-guidance`
                : undefined,
          };
          return (
            <div key={field} className={textarea ? styles.full : styles.field}>
              <label htmlFor={props.id}>{labels[field]}</label>
              {textarea ? (
                <textarea {...props} rows={3} maxLength={10000} />
              ) : (
                <input
                  {...props}
                  type={date ? 'date' : 'text'}
                  inputMode={date ? undefined : 'decimal'}
                  maxLength={date ? undefined : 32}
                  min={date && mode === 'change' ? today : undefined}
                />
              )}
              {field === 'lastDay' && (
                <small>Included in this period. Leave blank for ongoing settings.</small>
              )}
              {issue && <p id={`${prefix}-${field}-error`}>{issue.message}</p>}
            </div>
          );
        })}
        {!!preview.length && (
          <div className={styles.full} aria-live="polite">
            <strong>Before saving</strong>
            {preview.map((line) => (
              <p key={line}>{line}</p>
            ))}
          </div>
        )}
        {previewError && (
          <p className={styles.full} aria-live="polite">
            {previewError}
          </p>
        )}
        {(mode === 'void' || adjacent) && (
          <label className={styles.confirm}>
            <input
              type="checkbox"
              name={mode === 'void' ? 'confirmVoid' : 'confirmAdjacent'}
              value="yes"
              checked={confirmed}
              onChange={(event) => setConfirmed(event.target.checked)}
            />
            {mode === 'void'
              ? 'I confirm this record should be excluded from calculations.'
              : 'I have reviewed and approve these adjacent boundary changes.'}
          </label>
        )}
        <div className={`${styles.actions} ${styles.full}`}>
          <button type="button" className={styles.secondary} onClick={onCancel}>
            Cancel
          </button>
          <button
            type="submit"
            className={styles.primary}
            disabled={pending || !!previewError || ((mode === 'void' || adjacent) && !confirmed)}
          >
            {pending ? 'Saving…' : mode === 'void' ? 'Confirm Void' : 'Save'}
          </button>
        </div>
      </fieldset>
    </form>
  );
}
