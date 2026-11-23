/** Account pages live alongside the public site; bearer transport is owned by the SPA provider. */
export const ACCOUNT_ORIGIN = 'https://chefsergioandco.github.io'
export type AccountDestination = 'bookings' | 'admin' | 'signIn' | 'signOut' | 'createAccount' | 'verifyEmail'
const paths: Record<AccountDestination, string> = { bookings: '/dashboard/', admin: '/admin/', signIn: '/account/sign-in/', signOut: '/auth/logout/', createAccount: '/account/create/', verifyEmail: '/account/verify-email/' }
export const accountHref = (destination: AccountDestination) => paths[destination]
