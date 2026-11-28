import { isOperationsTarget, type OperationsTarget } from './service-operations-types'

/** Administrator-only record IDs are navigation context, never private access proofs. */
export function operationsTargetHash(target: OperationsTarget): string {
  if (!isOperationsTarget(target)) throw new TypeError('Choose a supported workspace record.')
  const query = new URLSearchParams()
  for (const key of ['recordId', 'bookingId', 'view', 'filter'] as const) if (target[key]) query.set(key, target[key]!)
  return '#' + target.section + (query.size ? '?' + query.toString() : '')
}

export function operationsTargetFromHash(hash: string): OperationsTarget | null {
  const [section, query = ''] = hash.replace(/^#/, '').split('?')
  const params = new URLSearchParams(query)
  const value: Record<string, unknown> = { section }
  if ([...params.keys()].some(key => !['recordId', 'bookingId', 'view', 'filter'].includes(key))) return null
  for (const key of ['recordId', 'bookingId', 'view', 'filter']) if (params.has(key)) {
    if (params.getAll(key).length !== 1) return null
    value[key] = params.get(key)
  }
  return isOperationsTarget(value) ? value : null
}
