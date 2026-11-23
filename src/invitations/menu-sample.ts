import type { DinnerMenuDocument } from '../../prototypes/sergio-admin/shared/invitations/menu-artwork'

/** Explicit design specimen approved for typesetting; never an issued or confirmed dinner. */
export const SAMPLE_DINNER_MENU: DinnerMenuDocument = {
  hostName: 'Alex', date: '2026-12-12', status: 'specimen',
  courses: [
    { name: 'Lobster Bisque', description: 'lobster, cream, chive' },
    { name: 'Seafood Vol-au-Vent', description: 'shellfish, puff pastry, white wine' },
    { name: 'Beef Stroganoff', description: 'beef, mushroom, crème fraîche' },
  ],
}
