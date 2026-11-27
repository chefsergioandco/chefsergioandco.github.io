import type { OpenDay } from './types'
import { addMonths, longDate, monthLabel } from './format'
import { Icon } from '../components/Icons'

const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']

/**
 * Month grid of Sergio's open days. Only open days are buttons, so there are no dead ends and Tab skips closed days.
 * Selected day takes the one accent (brand fill); everything else is ink on paper.
 */
export function Calendar({
  month,
  days,
  loading,
  error,
  onRetry,
  value,
  minMonth,
  nextOpen,
  onSelect,
  onMonth,
}: {
  month: string
  days: OpenDay[]
  loading: boolean
  error?: string
  onRetry?: () => void
  value?: string
  minMonth: string
  nextOpen: string | null
  onSelect: (date: string) => void
  onMonth: (month: string) => void
}) {
  const [y, m] = month.split('-').map(Number)
  const first = new Date(Date.UTC(y, m - 1, 1)).getUTCDay()
  const count = new Date(Date.UTC(y, m, 0)).getUTCDate()
  const open = new Set(days.map((d) => d.date))
  const cells: (string | null)[] = [...Array(first).fill(null), ...Array.from({ length: count }, (_, i) => `${month}-${String(i + 1).padStart(2, '0')}`)]

  return (
    <div data-calendar aria-busy={loading || undefined}>
      <div className="booking-calendar-heading">
        <button type="button" className="btn-quiet min-h-[44px] w-11 px-0" aria-label="Previous month" disabled={month <= minMonth} onClick={() => onMonth(addMonths(month, -1))}>
          <Icon name="chevron-left" size={20} />
        </button>
        <p className="font-medium" aria-live="polite">
          {monthLabel(month)}
        </p>
        <button type="button" className="btn-quiet min-h-[44px] w-11 px-0" aria-label="Next month" onClick={() => onMonth(addMonths(month, 1))}>
          <Icon name="chevron-right" size={20} />
        </button>
      </div>
      {error ? <div className="booking-notice" role="alert"><p>{error}</p>{onRetry && <button type="button" className="link booking-calendar-retry" onClick={onRetry}>Reload this month</button>}</div> : <div className="mt-3 grid grid-cols-7 gap-1 text-center" role="group" aria-label={`Open dates in ${monthLabel(month)}`}>
        {WEEKDAYS.map((w) => (
          <span key={w} aria-hidden className="pb-1 text-xs text-ink-muted">
            {w}
          </span>
        ))}
        {cells.map((date, i) =>
          !date ? (
            <span key={`b${i}`} aria-hidden />
          ) : open.has(date) && !loading ? (
            <button
              key={date}
              type="button"
              data-date={date}
              aria-pressed={value === date}
              aria-label={`${longDate(date)}, open`}
              onClick={() => onSelect(date)}
              className="h-11 rounded-btn text-base font-medium tabular-nums text-ink transition-colors duration-150 hover:bg-ink/5 aria-pressed:bg-brand aria-pressed:text-onbrand"
            >
              {Number(date.slice(8))}
            </button>
          ) : (
            <span key={date} aria-hidden className={`flex h-11 items-center justify-center text-base tabular-nums ${loading ? 'text-ink-muted/40' : 'text-ink-muted/50'}`}>
              {Number(date.slice(8))}
            </span>
          ),
        )}
      </div>}
      {!loading && !error && days.length === 0 && (
        <p className="mt-3 text-ink-muted">
          No open dates in {monthLabel(month).split(' ')[0]}.{' '}
          {nextOpen && (
            <button type="button" className="link font-medium text-ink" onClick={() => onMonth(nextOpen.slice(0, 7))}>
              Next open date: {longDate(nextOpen)}
            </button>
          )}
        </p>
      )}
    </div>
  )
}
