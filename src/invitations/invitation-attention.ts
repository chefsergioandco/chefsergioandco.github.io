/** Stores only document-version markers, never invitation tokens or guest data. */
export type InvitationAttention = { viewed: true; availableVersion: string | null; openedVersion: string | null; newVersion: string | null }
const version = (value: unknown): value is string => typeof value === 'string' && /^[A-Za-z0-9_.:-]{1,160}$/.test(value)
export function parseInvitationAttention(raw: string | null): InvitationAttention | null {
  if (!raw || raw.length > 1000) return null
  try {
    const value = JSON.parse(raw)
    if (value?.viewed !== true || !['availableVersion','openedVersion','newVersion'].every(key => value[key] === null || version(value[key]))) return null
    return { viewed: true, availableVersion: value.availableVersion, openedVersion: value.openedVersion, newVersion: value.newVersion }
  } catch { return null }
}
export function observeInvitation(previous: InvitationAttention | null, available: string | null): InvitationAttention {
  const next = available && version(available) ? available : null
  const newlyAdded = !!previous && !!next && previous.availableVersion !== next && previous.openedVersion !== next
  return { viewed: true, availableVersion: next, openedVersion: previous?.openedVersion ?? null, newVersion: next && (newlyAdded || previous?.newVersion === next && previous.openedVersion !== next) ? next : null }
}
export function acknowledgeMenu(state: InvitationAttention, opened: string): InvitationAttention {
  return state.availableVersion === opened ? { ...state, openedVersion: opened, newVersion: null } : state
}
