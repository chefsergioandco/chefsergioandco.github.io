import type { Availability } from './types'
import { addMonths, clock, longDate, monthLabel, shortDate } from './format'
import { Icon } from '../components/Icons'
import './Scheduler.css'

const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']
const weekday = (iso: string) => new Date(iso + 'T12:00:00Z').toLocaleDateString('en-US', { weekday: 'long', timeZone: 'UTC' })
const monthDay = (iso: string) => new Date(iso + 'T12:00:00Z').toLocaleDateString('en-US', { month: 'long', day: 'numeric', timeZone: 'UTC' })

/**
 * The guest's scheduler: a month of Sergio's open evenings beside the chosen day's start times, laid out like the
 * Availability view in his dashboard. Only open days are buttons, so Tab skips closed days and there are no dead ends.
 */
export function Scheduler({ month, minMonth, today, availability, loading, error, onRetry, onMonth, date, time, times, undecided, nextOpen, onDate, onTime, onUndecided, dateError, timeError }: {
  month: string
  minMonth: string
  today: string
  availability: Availability | null
  loading: boolean
  error: string
  onRetry: () => void
  onMonth: (month: string) => void
  date?: string
  time?: string
  times: string[]
  undecided: boolean
  nextOpen?: string
  onDate: (date: string) => void
  onTime: (time: string) => void
  onUndecided: (undecided: boolean) => void
  dateError?: string
  timeError?: string
}) {
  const [y, m] = month.split('-').map(Number)
  const first = new Date(Date.UTC(y, m - 1, 1)).getUTCDay()
  const count = new Date(Date.UTC(y, m, 0)).getUTCDate()
  const open = new Set((availability?.days ?? []).filter(day => day.date >= today && day.times.length).map(day => day.date))
  const cells: (string | null)[] = [...Array(first).fill(null), ...Array.from({ length: count }, (_, i) => `${month}-${String(i + 1).padStart(2, '0')}`)]
  while (cells.length % 7) cells.push(null)
  const chosen = !undecided && date ? date : undefined
  const empty = !loading && !error && availability && open.size === 0

  return <div className="scheduler-frame" data-scheduler><div className="scheduler">
    <section className="scheduler-month" aria-busy={loading || undefined}>
      <div className="scheduler-month-heading">
        <p className="scheduler-month-name" aria-live="polite">{monthLabel(month)}</p>
        <div className="scheduler-month-controls">
          <button type="button" className="scheduler-nav" aria-label="Previous month" disabled={month <= minMonth} onClick={() => onMonth(addMonths(month, -1))}><Icon name="chevron-left" size={18}/></button>
          <button type="button" className="scheduler-nav" aria-label="Next month" onClick={() => onMonth(addMonths(month, 1))}><Icon name="chevron-right" size={18}/></button>
        </div>
      </div>
      <div className="scheduler-weekdays" aria-hidden="true">{WEEKDAYS.map(day => <span key={day}>{day}</span>)}</div>
      {error
        ? <div className="scheduler-error" role="alert"><p>{error}</p><button type="button" className="link" onClick={onRetry}>Reload open dates</button></div>
        : <div id="f-date" tabIndex={-1} className="scheduler-grid" role="group" aria-label={`Open evenings in ${monthLabel(month)}`} aria-invalid={!!dateError || undefined} aria-describedby={dateError ? 'f-date-err' : undefined}>
          {cells.map((iso, index) => !iso
            ? <span key={'blank' + index} className="scheduler-day is-blank" aria-hidden="true"/>
            : open.has(iso) && !loading
              ? <button key={iso} type="button" data-date={iso} className={'scheduler-day is-open' + (iso === chosen ? ' is-selected' : '')} aria-pressed={iso === chosen} aria-label={`${longDate(iso)}, open`} onClick={() => onDate(iso)}>
                <span className="scheduler-day-number">{Number(iso.slice(8))}</span><span className="scheduler-open-mark" aria-hidden="true"/>
              </button>
              : <span key={iso} className={'scheduler-day is-closed' + (iso === today ? ' is-today' : '')} aria-hidden="true"><span className="scheduler-day-number">{Number(iso.slice(8))}</span></span>)}
        </div>}
      <div className="scheduler-legend">
        {loading ? <span role="status">Finding open evenings…</span> : <span><i className="scheduler-legend-mark" aria-hidden="true"/>Open evening</span>}
        <span>Eastern time</span>
      </div>
      {empty && <p className="scheduler-empty">No open evenings in {monthLabel(month).split(' ')[0]}.{availability?.nextOpen && <> <button type="button" className="link" onClick={() => onMonth(availability.nextOpen!.slice(0, 7))}>Next open: {shortDate(availability.nextOpen)}</button></>}</p>}
    </section>

    <aside className="scheduler-day-panel" aria-label="Your evening">
      {undecided
        ? <div className="scheduler-day-detail">
          <p className="scheduler-eyebrow">Your evening</p>
          <p className="scheduler-day-title">Date to settle<span>with Sergio</span></p>
          <p className="scheduler-day-note">No date is reserved until you and Sergio agree one.</p>
          <button type="button" className="link scheduler-switch" onClick={() => onUndecided(false)}>Pick a date instead</button>
        </div>
        : chosen
          ? <div className="scheduler-day-detail">
            <p className="scheduler-eyebrow">Your evening</p>
            <p className="scheduler-day-title">{weekday(chosen)}<span>{monthDay(chosen)}</span></p>
            {times.length > 0 && <>
              <p className="scheduler-times-label" id="f-time-label">Start time</p>
              <div id="f-time" tabIndex={-1} className="scheduler-times" role="radiogroup" aria-labelledby="f-time-label" aria-invalid={!!timeError || undefined} aria-describedby={timeError ? 'f-time-err' : undefined}>
                {times.map(slot => <button key={slot} type="button" role="radio" aria-checked={slot === time} className="scheduler-time" onClick={() => onTime(slot)}>{clock(slot)}</button>)}
              </div>
            </>}
            {timeError && <p id="f-time-err" className="booking-field-error">{timeError}</p>}
          </div>
          : <div className="scheduler-day-detail">
            <p className="scheduler-eyebrow">Your evening</p>
            <p className="scheduler-day-title is-prompt">Choose an open evening</p>
            <p className="scheduler-day-note">Sergio cooks one event a day, so your date is his whole evening.</p>
            {nextOpen && <button type="button" className="scheduler-next" onClick={() => onDate(nextOpen)}><Icon name="calendar-days" size={16}/>Next open: {shortDate(nextOpen)}</button>}
          </div>}
      {!undecided && <button type="button" className="link scheduler-switch" onClick={() => onUndecided(true)}>Not sure of the date yet?</button>}
    </aside>
    {dateError && <p id="f-date-err" className="booking-field-error scheduler-wide">{dateError}</p>}
  </div></div>
}
