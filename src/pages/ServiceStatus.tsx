import { href } from '../components/ui'
import './ServiceStatus.css'

const STATUS_PAGE = 'https://chefsergioandco.betteruptime.com/'

/** Better Stack remains the source of service status and incident updates. */
export function ServiceStatus() {
  return (
    <div className="service-status">
      <header className="service-status-header">
        <a href={href('/')} data-native-navigation>Back to Chef Sergio &amp; Co.</a>
        <h1 className="sr-only">Service status</h1>
        <a href={STATUS_PAGE} className="service-status-direct">Open status page directly</a>
      </header>
      <main id="main" className="service-status-content">
        <iframe src={STATUS_PAGE} title="Chef Sergio & Co. service status and incident updates" />
      </main>
    </div>
  )
}
