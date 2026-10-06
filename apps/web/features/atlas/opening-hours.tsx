import { openingHoursPresentation } from '../../product/application/catalog/operating-hours';
import './opening-hours.css';

/** Readable schedule rows, with source advisories available without crowding the hours. */
export function OpeningHours({ value }: { readonly value?: string }) {
  const presentation = value?.trim()
    ? openingHoursPresentation(value)
    : { lines: [], notes: [] };

  return (
    <div className="opening-hours">
      {presentation.lines.length ? (
        <ul className="opening-hours-lines" aria-label="営業時間">
          {presentation.lines.map((line, index) => (
            <li key={`${index}-${line}`}>{line}</li>
          ))}
        </ul>
      ) : (
        <span className="opening-hours-unavailable">Unavailable</span>
      )}
      {presentation.notes.length ? (
        <details className="opening-hours-notes">
          <summary>注意事項</summary>
          {presentation.notes.map((note, index) => (
            <p key={`${index}-${note}`}>{note}</p>
          ))}
        </details>
      ) : null}
    </div>
  );
}
