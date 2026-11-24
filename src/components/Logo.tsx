import { site } from '../content/site'
import { href } from './ui'
import './Logo.css'

type LogoProps = {
  variant?: 'primary' | 'compact' | 'responsive'
  reversed?: boolean
  decorative?: boolean
  className?: string
}

/** Fixed, outlined artwork: the compact optical drawing replaces the full mark on phones. */
export function Logo({ variant = 'primary', reversed = false, decorative = false, className = '' }: LogoProps) {
  const compact = variant === 'compact'
  const artwork = (tone: 'ink' | 'reverse', themed: boolean) => {
    const asset = (kind: 'primary' | 'compact') => href(`/brand/logo-${kind}-${tone}.svg?v=salon-1`)
    // The ink mark has a reverse twin for dark appearance; CSS shows exactly one
    // (see --logo-ink-display in styles.css). The twin is never announced.
    const twin = themed && tone === 'reverse'
    return (
      <picture key={tone} className={`brand-logo brand-logo--${variant}${themed ? ` brand-logo--tone-${tone}` : ''} ${className}`.trim()}
        data-brand-logo={twin ? undefined : variant} aria-hidden={twin || undefined}>
        {variant === 'responsive' && <source media="(max-width: 700px)" type="image/svg+xml" srcSet={asset('compact')} />}
        <img src={asset(compact ? 'compact' : 'primary')} alt={decorative || twin ? '' : site.name}
          width={compact ? 273 : 426} height={compact ? 43 : 65} draggable={false} />
      </picture>
    )
  }
  // Already-reversed marks sit on dark bands in both appearances.
  if (reversed) return artwork('reverse', false)
  return <>{artwork('ink', true)}{artwork('reverse', true)}</>
}
