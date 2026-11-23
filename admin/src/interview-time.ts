/** Interview inputs are always Orlando/Eastern wall time, regardless of the admin's device timezone. */
export function localInterview(value: string | null) {
  if (!value || !Number.isFinite(Date.parse(value))) return ''
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).formatToParts(new Date(value))
  const get = (name: string) => parts.find(part => part.type === name)?.value ?? ''
  return `${get('year')}-${get('month')}-${get('day')}T${get('hour')}:${get('minute')}`
}
export function interviewInstant(value: string) {
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(value)) return ''
  let guess = new Date(value + ':00Z')
  if (!Number.isFinite(guess.getTime()) || guess.toISOString().slice(0, 16) !== value) return ''
  for (let attempt = 0; attempt < 4; attempt++) {
    const offset = new Intl.DateTimeFormat('en-US', { timeZone: 'America/New_York', timeZoneName: 'longOffset' }).formatToParts(guess).find(part => part.type === 'timeZoneName')?.value.replace('GMT', '') || '+00:00'
    const candidate = new Date(value + ':00' + offset)
    if (!Number.isFinite(candidate.getTime())) return ''
    if (localInterview(candidate.toISOString()) === value) return candidate.toISOString()
    guess = candidate
  }
  // A daylight-saving gap cannot be represented as a real interview time.
  return ''
}
