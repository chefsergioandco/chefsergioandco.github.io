import { menuDocumentFromInvitation, renderMenuSvg, type DinnerMenuDocument } from '../../prototypes/sergio-admin/shared/invitations/menu-artwork'
import type { InvitationDocument } from '../../prototypes/sergio-admin/shared/invitations/types'
import { DinnerMenuCard } from './DinnerMenuCard'
import { InvitationCard } from './InvitationCard'

export type InvitationAssemblyProps = {
  document: InvitationDocument
  /** Supplied only by an explicit design preview. Never inferred from an unready live menu. */
  specimenMenu?: DinnerMenuDocument
  openProgress?: number
  maxSheetWidth?: number
  menuNew?: boolean
  menuVersion?: string | null
  menuProgress?: number
  onOpenRequest?: () => void
  onMenuOpen?: () => void
  onMenuRevealRequest?: (reveal: boolean) => void
}

/** One policy boundary for the existing invitation master and its physical menu enclosure. */
export function InvitationAssembly({ document, specimenMenu, openProgress, maxSheetWidth, menuNew = false, menuVersion, menuProgress = 0, onOpenRequest, onMenuOpen, onMenuRevealRequest }: InvitationAssemblyProps) {
  const liveReady = document.menuConfirmed && document.menu.some(line => line.trim())
  const explicitSpecimen = specimenMenu?.status === 'specimen' && specimenMenu.courses.some(course => course.name.trim()) ? specimenMenu : undefined
  const source = liveReady
    ? menuDocumentFromInvitation(document.experience === 'table' ? { ...document, hostName: 'Sergio' } : document)
    : explicitSpecimen
  // General invitation revisions do not close an unchanged menu or replace its physical state.
  // Its actual artwork content, including dedication and date, owns the enclosure identity.
  const menu = source ? (({ version: _revision, ...content }) => content)(source) : undefined
  const enclosure = menu ? <DinnerMenuCard key={`${menuVersion ?? ''}:${JSON.stringify(menu)}`} document={menu} inserted revealProgress={menuProgress} onOpen={onMenuOpen} onRevealRequest={onMenuRevealRequest} /> : undefined
  // On paper the folded card hides most of the tucked-in menu, so a printout gets the whole menu as its own page:
  // the same flat artwork the print set uses (text escaped by the renderer), shown only when printing.
  const printMenu = source ? <div className="invitation-print-menu" aria-hidden="true" dangerouslySetInnerHTML={{ __html: renderMenuSvg(source) }} /> : null
  return <><InvitationCard document={document} openProgress={openProgress} maxSheetWidth={maxSheetWidth} showTranscript={false} onOpenRequest={onOpenRequest} enclosure={enclosure} enclosureProgress={enclosure ? menuProgress : 0} menuNew={!!enclosure && menuNew} />{printMenu}</>
}

export default InvitationAssembly
