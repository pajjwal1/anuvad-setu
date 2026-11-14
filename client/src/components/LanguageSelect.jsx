import { useMemo } from 'react';
import { INDIAN_LANGUAGES, ENGLISH, WORLD_LANGUAGES, BY_CODE, OFFLINE_WORLD_CODES } from '../lib/languages.js';

const OFFLINE_WORLD = WORLD_LANGUAGES.filter((l) => OFFLINE_WORLD_CODES.has(l.code));
const ONLINE_WORLD = WORLD_LANGUAGES.filter((l) => !OFFLINE_WORLD_CODES.has(l.code));

const label = (l) => `${l.name}${l.native !== l.name ? ` - ${l.native}` : ''}`;

/**
 * Native <select> keeps the best UX on mobile (OS picker) and is fully accessible.
 * `deviceOnly` (private mode) disables languages that have no on-device model.
 */
export default function LanguageSelect({ value, onChange, recents = [], withAuto = false, label: aria, detected, deviceOnly = false }) {
  const recentLangs = useMemo(() => recents.map((c) => BY_CODE[c]).filter(Boolean), [recents]);
  return (
    <select className="lang-select" aria-label={aria} value={value} onChange={(e) => onChange(e.target.value)}>
      {withAuto && (
        <option value="auto">{detected ? `Detected: ${BY_CODE[detected]?.name ?? detected}` : 'Detect language'}</option>
      )}
      {recentLangs.length > 0 && (
        <optgroup label="Recent">
          {recentLangs.map((l) => (
            <option key={`r-${l.code}`} value={l.code} disabled={deviceOnly && l.group === 'world' && !OFFLINE_WORLD_CODES.has(l.code)}>
              {l.name}
            </option>
          ))}
        </optgroup>
      )}
      <optgroup label="Indian languages (also work offline)">
        {INDIAN_LANGUAGES.map((l) => (
          <option key={l.code} value={l.code}>
            {label(l)}
          </option>
        ))}
      </optgroup>
      <optgroup label="English">
        <option value={ENGLISH.code}>{ENGLISH.name}</option>
      </optgroup>
      <optgroup label="World languages (offline with a download)">
        {OFFLINE_WORLD.map((l) => (
          <option key={l.code} value={l.code}>
            {label(l)}
          </option>
        ))}
      </optgroup>
      <optgroup label={deviceOnly ? 'Other languages (not available in private mode)' : 'Other languages (online only)'}>
        {ONLINE_WORLD.map((l) => (
          <option key={l.code} value={l.code} disabled={deviceOnly}>
            {label(l)}
          </option>
        ))}
      </optgroup>
    </select>
  );
}
