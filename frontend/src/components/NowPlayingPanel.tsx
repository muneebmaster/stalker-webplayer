import { logoUrl } from "../api";

export interface MediaInfo {
  /** Channel/movie/series name displayed in the header */
  entityName: string;
  /** Channel number (live) or year (VOD) */
  entitySub?: string;
  /** Logo or poster URL */
  logo?: string;
  /** Current programme or movie title */
  title?: string;
  /** Time range (live) or director/actors (VOD) */
  subtitle?: string;
  /** Description text */
  description?: string;
  /** Progress 0-1 (live EPG only) */
  progress?: number;
  /** Up-next programme name */
  upNext?: string;
  /** Up-next time range */
  upNextTime?: string;
}

interface Props {
  info: MediaInfo | null;
}

export default function NowPlayingPanel({ info }: Props) {
  if (!info) {
    return (
      <div className="now-playing-panel now-playing-empty">
        Select a channel or title to see details.
      </div>
    );
  }

  return (
    <div className="now-playing-panel">
      <div className="now-playing-header">
        <div className="now-playing-logo">
          {info.logo ? (
            <img src={info.logo.startsWith("http") ? logoUrl(info.logo) : info.logo} alt="" />
          ) : (
            <span className="placeholder">{info.entityName.slice(0, 2).toUpperCase()}</span>
          )}
        </div>
        <div className="now-playing-channel">
          {info.entitySub && <span className="now-channel-number">{info.entitySub}</span>}
          <span className="now-channel-name">{info.entityName}</span>
        </div>
      </div>

      {info.title && (
        <div className="now-playing-current">
          <div className="now-playing-label">Now Playing</div>
          <div className="now-playing-title">{info.title}</div>
          {info.subtitle && <div className="now-playing-time">{info.subtitle}</div>}
          {info.progress !== undefined && (
            <div className="now-progress">
              <div className="now-progress-fill" style={{ width: `${info.progress * 100}%` }} />
            </div>
          )}
          {info.description && <div className="now-playing-description">{info.description}</div>}
        </div>
      )}

      {info.upNext && (
        <div className="now-playing-next">
          <div className="now-playing-label">Up Next</div>
          <div className="now-playing-title">{info.upNext}</div>
          {info.upNextTime && <div className="now-playing-time">{info.upNextTime}</div>}
        </div>
      )}
    </div>
  );
}
