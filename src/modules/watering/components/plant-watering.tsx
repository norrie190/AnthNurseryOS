import {
  NURSERY_TIME_ZONE,
  nurseryDateTimeInputValue,
  sqlToDate,
} from '../../../lib/calendar-date';
import type { PlantWateringDetail } from '../watering-schedule-queries';
import { RecordWateringForm, WateringScheduleForm } from './watering-forms';
import { EventHistoryRow, ScheduleHistoryRow } from './watering-history-controls';
import styles from './plant-watering.module.css';
import { StatusBadge, type StatusBadgeVariant } from '../../../components/ui/status-badge';

const calendarDate = new Intl.DateTimeFormat('en-GB', { dateStyle: 'long', timeZone: 'UTC' });
const eventTime = new Intl.DateTimeFormat('en-GB', {
  dateStyle: 'medium',
  timeStyle: 'short',
  timeZone: NURSERY_TIME_ZONE,
});

function dateLabel(value: string) {
  return calendarDate.format(new Date(`${value}T12:00:00.000Z`));
}

function dueLabel(due: PlantWateringDetail['due']) {
  switch (due.status) {
    case 'NOT_CONFIGURED':
      return 'Watering schedule not configured';
    case 'NEEDS_FIRST_WATERING':
      return 'Schedule configured — no watering recorded yet';
    case 'OVERDUE':
      return `${Math.abs(due.daysUntilDue!)} ${Math.abs(due.daysUntilDue!) === 1 ? 'day' : 'days'} overdue`;
    case 'DUE_TODAY':
      return 'Due today';
    case 'DUE_SOON':
      return `Due in ${due.daysUntilDue} ${due.daysUntilDue === 1 ? 'day' : 'days'}`;
    case 'UPCOMING':
      return `Due in ${due.daysUntilDue} days`;
  }
}

function dueVariant(status: PlantWateringDetail['due']['status']): StatusBadgeVariant {
  if (status === 'OVERDUE') return 'danger';
  if (status === 'DUE_TODAY') return 'attention';
  if (status === 'NOT_CONFIGURED') return 'neutral';
  if (status === 'NEEDS_FIRST_WATERING') return 'info';
  return 'neutral';
}

function periodState(period: PlantWateringDetail['periods'][number], nurseryDate: string) {
  if (period.voidedAt) return 'Voided';
  const from = sqlToDate(period.effectiveFrom);
  const to = period.effectiveTo ? sqlToDate(period.effectiveTo) : null;
  if (from > nurseryDate) return 'Future';
  if (to && to <= nurseryDate) return 'Historical';
  return 'Current';
}

export function PlantWatering({ watering }: { watering: PlantWateringDetail }) {
  const { due, schedule, plant, events, periods } = watering;
  return (
    <section className={styles.section} aria-labelledby="watering-heading">
      <div className={styles.sectionHeader}>
        <div>
          <p className={styles.eyebrow}>Plant care</p>
          <h2 id="watering-heading">Watering</h2>
        </div>
        <StatusBadge variant={dueVariant(due.status)}>{dueLabel(due)}</StatusBadge>
      </div>

      <div className={styles.summaryGrid}>
        <div>
          <span>Current interval</span>
          <strong>
            {due.intervalDays === null
              ? 'Not configured'
              : `Every ${due.intervalDays} ${due.intervalDays === 1 ? 'day' : 'days'}`}
          </strong>
        </div>
        <div>
          <span>Latest qualifying watering</span>
          <strong>
            {due.latestWateredDate ? dateLabel(due.latestWateredDate) : 'Not recorded'}
          </strong>
        </div>
        <div>
          <span>Next estimated due date</span>
          <strong>{due.nextDueDate ? dateLabel(due.nextDueDate) : 'Not calculable'}</strong>
        </div>
      </div>
      <p className={styles.disclaimer}>
        Due dates are calendar-based care estimates from recorded history and the schedule applying
        today.
      </p>

      <div className={styles.currentSchedule}>
        <h3>Current schedule</h3>
        {schedule ? (
          <dl>
            <div>
              <dt>Interval</dt>
              <dd>
                Every {schedule.intervalDays} {schedule.intervalDays === 1 ? 'day' : 'days'}
              </dd>
            </div>
            <div>
              <dt>Effective from</dt>
              <dd>
                <time dateTime={sqlToDate(schedule.effectiveFrom)}>
                  {dateLabel(sqlToDate(schedule.effectiveFrom))}
                </time>
              </dd>
            </div>
            <div>
              <dt>Effective to</dt>
              <dd>
                {schedule.effectiveTo ? (
                  <time dateTime={sqlToDate(schedule.effectiveTo)}>
                    {dateLabel(sqlToDate(schedule.effectiveTo))} (exclusive)
                  </time>
                ) : (
                  'Open-ended'
                )}
              </dd>
            </div>
            <div className={styles.fullWidth}>
              <dt>Notes</dt>
              <dd>{schedule.notes || 'No notes'}</dd>
            </div>
          </dl>
        ) : (
          <p className={styles.empty}>
            No schedule applies today. This may be an unconfigured Plant or a genuine gap in its
            schedule history.
          </p>
        )}
      </div>

      {plant.activeCareEligible ? (
        <div className={styles.formsGrid}>
          <RecordWateringForm
            plantId={plant.id}
            defaultWateredAt={nurseryDateTimeInputValue(new Date())}
          />
          <details className={styles.scheduleDisclosure}>
            <summary>
              {due.intervalDays === null
                ? 'Configure watering schedule'
                : 'Change watering schedule'}
            </summary>
            <WateringScheduleForm
              plantId={plant.id}
              nurseryDate={due.nurseryDate}
              currentIntervalDays={due.intervalDays}
            />
          </details>
        </div>
      ) : (
        <div className={styles.readOnlyNotice} role="status">
          <h3>Watering history is read-only</h3>
          <p>
            New waterings and normal schedule changes are available only for active Growing or
            Quarantine Plants. Existing history remains visible below.
          </p>
        </div>
      )}

      <div className={styles.historyGrid}>
        <details className={styles.historyDisclosure}>
          <summary>
            <span>Watering history</span>
            <span>{events.length} events</span>
          </summary>
          <section aria-labelledby="watering-event-history-heading">
            <h3 id="watering-event-history-heading">Watering history</h3>
            {events.length ? (
              <ol className={styles.historyList}>
                {events.map((event) => (
                  <li key={event.id} className={event.voidedAt ? styles.voided : undefined}>
                    <div className={styles.historyHeading}>
                      <time dateTime={event.wateredAt.toISOString()}>
                        {eventTime.format(event.wateredAt)}
                      </time>
                      {event.voidedAt && <span>Voided — excluded from due calculations</span>}
                    </div>
                    {event.notes && <p>{event.notes}</p>}
                    {event.correctionReason && (
                      <p className={styles.reason}>
                        {event.voidedAt ? 'Void reason' : 'Correction reason'}:{' '}
                        {event.correctionReason}
                      </p>
                    )}
                    <EventHistoryRow plantId={plant.id} event={event} />
                  </li>
                ))}
              </ol>
            ) : (
              <p className={styles.empty}>No watering has been recorded yet.</p>
            )}
          </section>
        </details>

        <details className={styles.historyDisclosure}>
          <summary>
            <span>Schedule history</span>
            <span>{periods.length} periods</span>
          </summary>
          <section aria-labelledby="watering-schedule-history-heading">
            <h3 id="watering-schedule-history-heading">Schedule history</h3>
            {periods.length ? (
              <ol className={styles.historyList}>
                {periods.map((period) => {
                  const state = periodState(period, due.nurseryDate);
                  const from = sqlToDate(period.effectiveFrom);
                  const to = period.effectiveTo ? sqlToDate(period.effectiveTo) : null;
                  return (
                    <li key={period.id} className={state === 'Voided' ? styles.voided : undefined}>
                      <div className={styles.historyHeading}>
                        <strong>
                          Every {period.intervalDays} {period.intervalDays === 1 ? 'day' : 'days'}
                        </strong>
                        <span>{state}</span>
                      </div>
                      <p>
                        <time dateTime={from}>{dateLabel(from)}</time> –{' '}
                        {to ? (
                          <>
                            <time dateTime={to}>{dateLabel(to)}</time> (exclusive)
                          </>
                        ) : (
                          'Open-ended'
                        )}
                      </p>
                      {period.notes && <p>{period.notes}</p>}
                      {period.correctionReason && (
                        <p className={styles.reason}>
                          {period.voidedAt ? 'Void reason' : 'Correction reason'}:{' '}
                          {period.correctionReason}
                        </p>
                      )}
                      <ScheduleHistoryRow plantId={plant.id} period={period} />
                    </li>
                  );
                })}
              </ol>
            ) : (
              <p className={styles.empty}>No watering schedule history yet.</p>
            )}
          </section>
        </details>
      </div>
    </section>
  );
}
