export const INVITATION_FOLD_DISTANCE = 400
export const MENU_REVEAL_DISTANCE = 540
const clamp = (value: number, low: number, high: number) => Math.min(high, Math.max(low, value))

/** One input distance: invitation fold, flat menu extraction, then ordinary page travel. */
export function invitationSequence(position: number, hasMenu: boolean, pageMaximum: number) {
  const ceremonyDistance = INVITATION_FOLD_DISTANCE + (hasMenu ? MENU_REVEAL_DISTANCE : 0)
  const distance = clamp(Number.isFinite(position) ? position : 0, 0, ceremonyDistance + Math.max(0, pageMaximum))
  return {
    distance, ceremonyDistance,
    fold: clamp(distance / INVITATION_FOLD_DISTANCE, 0, 1),
    menu: hasMenu ? clamp((distance - INVITATION_FOLD_DISTANCE) / MENU_REVEAL_DISTANCE, 0, 1) : 0,
    scroll: Math.max(0, distance - ceremonyDistance),
  }
}
