import { useState } from 'react'
import { money, WebsiteContent } from './model'
import { useAdmin } from './store'
import { Icon, Modal } from './ui'
import './Website.css'

type Section = 'Words & images' | 'Menus & prices' | 'Guest information'
type FieldErrors = Partial<Record<keyof WebsiteContent, string>>
const startingPrice = (value:number) => value > 0 ? 'From ' + money(value) : 'Price to be set'
const equal = (a: WebsiteContent, b: WebsiteContent) => JSON.stringify(a) === JSON.stringify(b)
function validate(content: WebsiteContent): FieldErrors {
  const errors: FieldErrors = {}
  for (const key of ['dinnerPrice', 'classPrice', 'tablePrice'] as const) {
    if (!Number.isFinite(content[key]) || content[key] < 0 || content[key] > 10000) errors[key] = 'Enter a price from $0 to $10,000. Leave unset prices at $0 while drafting.'
  }
  return errors
}
function publicationDate(value: string) {
  return new Date(value).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })
}

function FoodIllustration({ variant = 'dinner', compact = false }: { variant?: string; compact?: boolean }) {
  if (variant.startsWith('data:image/')) return <img className={'website-food-photo ' + (compact ? 'compact' : '')} src={variant} alt="Uploaded opening image" />
  return <div className={'website-food-art ' + variant + (compact ? ' compact' : '')} aria-hidden="true">
    <div className="website-art-napkin" />
    <div className="website-art-plate"><div className="website-art-sauce" /><span className="website-art-food food-one" /><span className="website-art-food food-two" /><span className="website-art-food food-three" /><i className="website-art-leaf leaf-one" /><i className="website-art-leaf leaf-two" /><i className="website-art-leaf leaf-three" /></div>
    {variant === 'table' && <div className="website-art-sideplate" />}
    <div className="website-art-fork" /><div className="website-art-knife" />
  </div>
}

function GuestPreview({ content, onClose }: { content: WebsiteContent; onClose: () => void }) {
  return <Modal title="Preview your changes" subtitle="A private draft preview. Public website publishing is not connected." onClose={onClose} wide>
    <div className="website-guest-preview">
      <div className="website-guest-top"><img src="/brand/logo-compact-ink.svg" alt="Chef Sergio & Co." /><span>Private dinners · Cooking classes · Shared tables</span></div>
      <div className="website-guest-hero"><div><span className="eyebrow">MADE TO BE SHARED</span><h2>{content.headline}</h2><p>{content.introduction}</p><span className="website-preview-cta">Gather around the table</span></div><FoodIllustration variant={content.photo} /></div>
      <div className="website-guest-prices"><div><span>Private dinners</span><strong>{startingPrice(content.dinnerPrice)}{content.dinnerPrice > 0 && <small> / guest</small>}</strong></div><div><span>Cooking classes</span><strong>{startingPrice(content.classPrice)}{content.classPrice > 0 && <small> / guest</small>}</strong></div><div><span>Sergio’s Table</span><strong>{startingPrice(content.tablePrice)}{content.tablePrice > 0 && <small> / seat</small>}</strong></div></div>
      <div className="website-guest-bottom"><section><span className="eyebrow">A TASTE OF WHAT’S POSSIBLE</span><h3>A seasonal dinner</h3>{content.dinnerMenu.split('\n').filter(Boolean).map((line, i) => <p key={i}>{line}</p>)}</section><aside><h3>Before we gather</h3><h4>A personal reply</h4><p>{content.replyTime}</p><h4>If plans change</h4><p>{content.cancellation}</p></aside></div>
      <p className="website-guest-footnote">Private draft preview · Nothing is sent to the public website</p>
    </div>
    <footer className="website-modal-actions"><button className="button secondary" onClick={onClose}>Back to editing</button></footer>
  </Modal>
}

export default function Website({embedded=false}:{embedded?:boolean}) {
  const { state, update, notify, pending, capabilities } = useAdmin()
  const { website } = state
  const [draft, setDraft] = useState<WebsiteContent>(() => ({ ...website.draft }))
  const [section, setSection] = useState<Section>('Words & images')
  const [errors, setErrors] = useState<FieldErrors>({})
  const [preview, setPreview] = useState(false)
  const [history, setHistory] = useState(false)
  const dirty = !equal(draft, website.draft)
  const changes = (Object.keys(draft) as (keyof WebsiteContent)[]).filter(key => draft[key] !== website.published[key])
  const change = <K extends keyof WebsiteContent>(key: K, value: WebsiteContent[K]) => {
    setDraft(current => ({ ...current, [key]: value }))
    setErrors(current => ({ ...current, [key]: undefined }))
  }
  const check = () => {
    const next = validate(draft)
    setErrors(next)
    const key = Object.keys(next)[0] as keyof WebsiteContent | undefined
    if (!key) return true
    setSection(['headline', 'introduction', 'photo'].includes(key) ? 'Words & images' : ['dinnerPrice', 'classPrice', 'tablePrice', 'dinnerMenu'].includes(key) ? 'Menus & prices' : 'Guest information')
    notify('Please check the highlighted fields.')
    setTimeout(() => document.getElementById('website-' + key)?.focus(), 20)
    return false
  }
  const save = async () => {
    if (!check()) return
    const saved = await update('Website draft saved', next => { next.website.draft = { ...draft } })
    if (!saved) return
    notify('Website draft saved securely. Public publishing is not connected.')
  }
  const error = (key: keyof WebsiteContent) => errors[key] ? <span className="website-field-error" id={'website-error-' + key} role="alert">{errors[key]}</span> : null
  const a11y = (key: keyof WebsiteContent) => ({ id: 'website-' + key, 'aria-invalid': !!errors[key], 'aria-describedby': errors[key] ? 'website-error-' + key : undefined })
  return <div className={"website-page"+(embedded?" embedded":"")}>
    <div className="website-page-heading"><div><p className="eyebrow">YOUR WEBSITE</p><h1>A little polish. Your own words.</h1><p className="muted">Keep the details current, without touching the design.</p></div><button className="button secondary" onClick={() => setHistory(true)}><Icon name="history" size={17} />Version history</button></div>
    <div className="website-draft-bar"><div><span className={'website-draft-dot ' + (dirty ? 'unsaved' : '')} /><strong>{dirty ? 'You have unsaved edits' : 'Your draft is saved'}</strong><span>{dirty ? 'Save when you’re ready.' : 'Public website publishing is not connected.'}</span></div><div><button className="button secondary" onClick={() => setPreview(true)}><Icon name="globe" size={17} />Preview</button><button className="button secondary" disabled={pending || !dirty} onClick={save}>{pending ? 'Saving…' : 'Save draft'}</button><button className="button" disabled={!capabilities.websitePublishing || !changes.length || pending} title="Public website publishing is not connected">Publish changes</button></div></div>
    <div className="website-layout">
      <section className="panel website-editor" aria-label="Website content editor">
        <div className="website-tabs" role="tablist" aria-label="Content sections">{(['Words & images', 'Menus & prices', 'Guest information'] as Section[]).map((item, i, tabs) => <button key={item} role="tab" tabIndex={section === item ? 0 : -1} aria-selected={section === item} aria-controls={'website-panel-' + i} id={'website-tab-' + i} onClick={() => setSection(item)} onKeyDown={e => {
          let next = i
          if (e.key === 'ArrowRight') next = (i + 1) % tabs.length
          else if (e.key === 'ArrowLeft') next = (i + tabs.length - 1) % tabs.length
          else if (e.key === 'Home') next = 0
          else if (e.key === 'End') next = tabs.length - 1
          else return
          e.preventDefault(); setSection(tabs[next]); document.getElementById('website-tab-' + next)?.focus()
        }}>{item}</button>)}</div>
        {section === 'Words & images' && <div className="website-editor-section" role="tabpanel" id="website-panel-0" aria-labelledby="website-tab-0"><div className="website-section-intro"><span className="website-section-icon"><Icon name="edit" size={19} /></span><div><h2>The first invitation</h2><p>What guests read when they first arrive.</p></div></div>
          <label className="field" htmlFor="website-headline">Opening headline<input {...a11y('headline')} maxLength={100} value={draft.headline} onChange={e => change('headline', e.target.value)} />{error('headline')}<small>Keep it short, warm, and unmistakably you.</small></label>
          <label className="field" htmlFor="website-introduction">Introduction<textarea {...a11y('introduction')} rows={4} maxLength={500} value={draft.introduction} onChange={e => change('introduction', e.target.value)} />{error('introduction')}<small>{draft.introduction.length} / 500 characters</small></label>
          <div className="website-image-heading"><div><h3>Opening image</h3><p className="muted">Choose an illustrated direction for your saved draft.</p></div><button className="button secondary" disabled title="Photo uploads require connected media storage">Upload image</button></div>
          <div className="website-image-choices">{[{ key: 'dinner', label: 'Dinner detail' }, { key: 'table', label: 'Around the table' }, { key: 'kitchen', label: 'In the kitchen' }].map(image => <button key={image.key} className={'website-image-option ' + (draft.photo === image.key ? 'selected' : '')} onClick={() => change('photo', image.key)} aria-pressed={draft.photo === image.key}><FoodIllustration variant={image.key} compact /><span>{image.label}{draft.photo === image.key && <Icon name="check" size={16} />}</span></button>)}</div>
          {draft.photo.startsWith('data:image/') && <div className="website-uploaded"><img src={draft.photo} alt="Your uploaded draft image" /><span><strong>Your uploaded image</strong><small>Selected for the opening</small></span><Icon name="check" size={18} /></div>}
          <p className="website-editor-note">Photo uploads are unavailable until media storage is connected.</p>
        </div>}
        {section === 'Menus & prices' && <div className="website-editor-section" role="tabpanel" id="website-panel-1" aria-labelledby="website-tab-1"><div className="website-section-intro"><span className="website-section-icon"><Icon name="cutlery" size={19} /></span><div><h2>A taste of what you do</h2><p>Starting prices and a sample of your cooking.</p></div></div><div className="website-price-fields">{([{ key: 'dinnerPrice', label: 'Private dinner', unit: 'per guest' }, { key: 'classPrice', label: 'Cooking class', unit: 'per guest' }, { key: 'tablePrice', label: 'Sergio’s Table', unit: 'per seat' }] as const).map(item => <label className="field" key={item.key} htmlFor={'website-' + item.key}>{item.label}<div className="website-currency"><span>$</span><input {...a11y(item.key)} type="number" min={0} max={10000} step={1} value={draft[item.key]} onChange={e => change(item.key, Number(e.target.value))} /></div><small>Starting price, {item.unit}</small>{error(item.key)}</label>)}</div><div className="website-info"><Icon name="info" size={18} /><p>These draft starting prices do not change your public website or any agreed booking prices. Set unfinished prices to $0 while drafting.</p></div><label className="field" htmlFor="website-dinnerMenu">Sample dinner menu<textarea {...a11y('dinnerMenu')} rows={7} maxLength={2500} value={draft.dinnerMenu} onChange={e => change('dinnerMenu', e.target.value)} />{error('dinnerMenu')}<small>One course per line. This is an invitation, not a fixed menu.</small></label></div>}
        {section === 'Guest information' && <div className="website-editor-section" role="tabpanel" id="website-panel-2" aria-labelledby="website-tab-2"><div className="website-section-intro"><span className="website-section-icon"><Icon name="people" size={19} /></span><div><h2>A few helpful details</h2><p>Set clear expectations before guests get in touch.</p></div></div><label className="field" htmlFor="website-replyTime">When can guests expect a reply?<input {...a11y('replyTime')} maxLength={120} value={draft.replyTime} onChange={e => change('replyTime', e.target.value)} />{error('replyTime')}<small>For example, “Within 24 hours”.</small></label><label className="field" htmlFor="website-cancellation">Cancellation policy<textarea {...a11y('cancellation')} rows={7} maxLength={1500} value={draft.cancellation} onChange={e => change('cancellation', e.target.value)} />{error('cancellation')}<small>Explain the timing, deposit terms, and options for changing a date.</small></label><div className="website-info"><Icon name="shield" size={18} /><p>Policy edits apply to new requests. Existing guests keep the terms they booked under.</p></div></div>}
      </section>
      <aside className="website-side"><div className="panel website-preview-card"><div className="website-preview-label"><span className="eyebrow">YOUR DRAFT, AT A GLANCE</span><Icon name="globe" size={17} /></div><FoodIllustration variant={draft.photo} /><div className="website-preview-copy"><span className="eyebrow">CHEF SERGIO & CO.</span><h2>{draft.headline || 'Your opening headline'}</h2><p>{draft.introduction || 'Your invitation to gather, in your own words.'}</p><div><span>Private dinners</span><strong>{startingPrice(draft.dinnerPrice)}</strong></div><div><span>Cooking classes</span><strong>{startingPrice(draft.classPrice)}</strong></div><div><span>Sergio’s Table</span><strong>{startingPrice(draft.tablePrice)}</strong></div></div><button className="website-full-preview" onClick={() => setPreview(true)}>Open full preview<Icon name="external" size={16} /></button></div><div className="website-side-note"><Icon name="lock" size={18} /><p><strong>A safe place to try things.</strong> Drafts are saved to your workspace. Public website publishing is not connected yet.</p></div></aside>
    </div>
    {preview && <GuestPreview content={draft} onClose={() => setPreview(false)} />}
    {history && <Modal title="Version history" subtitle="Bring an earlier saved version back into your draft." onClose={() => setHistory(false)}><div className="website-history-list">{!website.revisions.length && <p>No earlier saved versions yet.</p>}{website.revisions.map((revision, index) => <article key={revision.id}><span className="website-history-icon"><Icon name={index === 0 ? 'check' : 'history'} size={19} /></span><div><strong>{revision.label}</strong><p>{publicationDate(revision.date)}{index === 0 ? ' · Most recent version' : ''}</p><small>{revision.content.headline}</small></div><button className="button secondary" disabled={pending || equal(revision.content, draft)} onClick={async () => { const restored = { ...revision.content }; const saved = await update('Earlier website version restored to draft', next => { next.website.draft = restored }); if (!saved) return; setDraft(restored); setHistory(false); notify('Version restored to your saved draft.') }}>{equal(revision.content, draft) ? 'In your draft' : 'Restore to draft'}</button></article>)}</div><footer className="website-modal-actions"><button className="button secondary" onClick={() => setHistory(false)}>Done</button></footer></Modal>}
  </div>
}
