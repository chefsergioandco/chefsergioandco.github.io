import { useId, useMemo, useRef, useState } from 'react'
import * as Dialog from '@radix-ui/react-dialog'
import type { InvitationDocument } from '../../prototypes/sergio-admin/shared/invitations/types'
import { invitationDestination, invitationDirections, invitationMap } from '../../prototypes/sergio-admin/shared/invitations/links'
import { Icon } from '../components/Icons'
import './InvitationLocation.css'

export function InvitationLocation({ document, preview = false }: { document: InvitationDocument; preview?: boolean }) {
  const [choosing, setChoosing] = useState(false), [copyStatus, setCopyStatus] = useState('')
  const trigger = useRef<HTMLButtonElement>(null)
  const heading = useId()
  const destination = useMemo(() => invitationDestination(document), [document])
  const directions = useMemo(() => invitationDirections(document), [document])
  const map = useMemo(() => invitationMap(document), [document])
  const complete = !!directions && (destination.coordinates !== null || !/\[.*\]/.test(destination.address))
  async function copyAddress() { try { await navigator.clipboard.writeText([document.venueName, ...document.address].join('\n')); setCopyStatus('Address copied.') } catch { setCopyStatus('Select the address above to copy it.') } }
  return <section className="invitation-location" aria-labelledby={heading}>
    <header><p className="invitation-kicker">Getting here</p><h3 id={heading}>{document.venueName || 'Your evening’s location'}</h3></header>
    <address>{document.address.length ? document.address.map((line, index) => <span key={`${index}-${line}`}>{line}</span>) : 'Sergio will confirm the exact address before your invitation is released.'}</address>
    {map && <div className="invitation-location-map" role="group" aria-label={`Location map of ${document.venueName || 'the confirmed venue'}. Use Get directions or Open full map for navigation.`}><iframe title={`Map of ${document.venueName || 'the confirmed venue'}`} src={map.embed} loading="lazy" referrerPolicy="no-referrer" tabIndex={-1} aria-hidden="true" /><a className="invitation-map-attribution" href="https://www.openstreetmap.org/copyright" target="_blank" rel="noreferrer">© OpenStreetMap contributors</a></div>}
    {preview && <p className="invitation-location-note">Illustrative pin in central Winter Park. Sergio confirms the final venue pin.</p>}
    <div className="invitation-location-actions"><button ref={trigger} type="button" className="invitation-location-directions" disabled={!complete} onClick={() => setChoosing(true)}><Icon name="map-pin" size={18} />Get directions</button>{document.address.length > 0 && <button className="invitation-location-copy" type="button" onClick={() => void copyAddress()}>Copy address</button>}{map && <a className="invitation-location-fullmap" href={map.full} target="_blank" rel="noreferrer">Open full map</a>}</div>
    {!map && complete && <p className="invitation-location-note">Choose your preferred map app for directions to the address above.</p>}
    <p className="invitation-location-status" role="status" aria-live="polite">{copyStatus}</p>
    <Dialog.Root open={choosing} onOpenChange={setChoosing}><Dialog.Portal><Dialog.Overlay className="invitation-choice-overlay" /><Dialog.Content className="invitation-choice-dialog" onCloseAutoFocus={event => { event.preventDefault(); trigger.current?.focus() }}><header><div><Dialog.Title>Directions to your evening</Dialog.Title><Dialog.Description>Choose a map app. Your device can open its app or website.</Dialog.Description></div><Dialog.Close className="invitation-choice-close" aria-label="Close directions"><Icon name="x" size={22} /></Dialog.Close></header><address>{document.venueName}<br />{document.address.join(', ')}</address><div className="invitation-choice-options">{directions && <><a href={directions.apple} target="_blank" rel="noreferrer"><span>Apple Maps</span><span>Driving directions</span></a><a href={directions.google} target="_blank" rel="noreferrer"><span>Google Maps</span><span>Driving directions</span></a><a href={directions.waze} target="_blank" rel="noreferrer"><span>Waze</span><span>{destination.coordinates ? 'Start a route' : 'Find the address'}</span></a></>}</div><p className="invitation-choice-note">The destination is provided; your chosen map app handles your starting location.</p></Dialog.Content></Dialog.Portal></Dialog.Root>
  </section>
}

export default InvitationLocation
