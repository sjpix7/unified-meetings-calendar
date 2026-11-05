import { useEffect } from 'react';
import { MATCH_META, SourceBadge, StatusBadge, fmtDate, fmtTime, fmtValue } from './ui.jsx';

const FIELD_ORDER = [
  'title', 'start', 'end', 'status', 'location', 'format', 'category',
  'client', 'company', 'owner', 'organizer', 'attendees', 'recurring', 'notes', 'description',
];

export default function MeetingDetail({ meeting: m, clashes, allMeetings, onClose, onOpen }) {
  useEffect(() => {
    const onKey = (e) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const match = MATCH_META[m.matchType];
  const titleOf = (id) => allMeetings.find((x) => x.id === id)?.title || id;

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal" role="dialog" aria-modal="true" onClick={(e) => e.stopPropagation()}>
        <header className="modal-head">
          <div>
            <h2>{m.title}</h2>
            <div className="muted">
              {fmtDate(m.startLocal || m.date)}{' '}
              {m.allDay ? '(time unknown)' : `${fmtTime(m.startLocal)}–${fmtTime(m.endLocal)}`}
            </div>
            <div className="badges">
              <StatusBadge status={m.status} />
              <span className={`badge ${match.className}`}>{match.label}</span>
              {m.sourceRecordIds.crm.map((id) => <code key={id}>{id}</code>)}
              {m.sourceRecordIds.calendar.map((id) => <code key={id}>{id}</code>)}
            </div>
          </div>
          <button type="button" className="ghost close" onClick={onClose} aria-label="Close">✕</button>
        </header>

        {m.conflicts.length > 0 && (
          <section className="box box-warn">
            <h3>⚠ Sources disagree ({m.conflicts.length})</h3>
            <table className="tbl">
              <thead><tr><th>Field</th><th>CRM says</th><th>Calendar says</th><th>Shown</th><th>Why</th></tr></thead>
              <tbody>
                {m.conflicts.map((c) => (
                  <tr key={c.field}>
                    <td><b>{c.label}</b> <span className={`sev sev-${c.severity}`}>{c.severity}</span></td>
                    <td>{fmtValue(c.crm)}</td>
                    <td>{fmtValue(c.calendar)}</td>
                    <td><b>{fmtValue(c.resolvedTo)}</b></td>
                    <td className="small muted">{c.rule}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </section>
        )}

        {clashes.length > 0 && (
          <section className="box box-danger">
            <h3>⇄ Overlaps with</h3>
            <ul className="list">
              {clashes.map((c) => {
                const other = c.meetingIds.find((id) => id !== m.id);
                return (
                  <li key={c.id}>
                    <button type="button" className="link" onClick={() => onOpen(other)}>{titleOf(other)}</button>{' '}
                    <span className="small muted">
                      {fmtTime(c.startLocal)}–{fmtTime(c.endLocal)}
                      {c.sharedParticipants.length ? ` · double-booked: ${c.sharedParticipants.join(', ')}` : ' · no shared attendees'}
                    </span>
                  </li>
                );
              })}
            </ul>
          </section>
        )}

        <section>
          <h3>Fields &amp; where they came from</h3>
          <table className="tbl fields">
            <thead><tr><th>Field</th><th>Value shown</th><th>Source</th><th>CRM value</th><th>Calendar value</th></tr></thead>
            <tbody>
              {FIELD_ORDER.filter((k) => m.fields[k]).map((k) => {
                const f = m.fields[k];
                return (
                  <tr key={k} className={f.conflict ? 'row-conflict' : ''}>
                    <td>{f.label}</td>
                    <td>{fmtValue(f.value)}{f.note && <div className="small muted">{f.note}</div>}</td>
                    <td><SourceBadge source={f.source} /></td>
                    <td className={f.crm === undefined ? 'na' : ''}>{f.crm === undefined ? 'n/a' : fmtValue(f.crm)}</td>
                    <td className={f.calendar === undefined ? 'na' : ''}>{f.calendar === undefined ? 'n/a' : fmtValue(f.calendar)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          <p className="small muted">“n/a” = the source has no such field (or this meeting is not in that source).</p>
        </section>

        {m.duplicates.length > 0 && (
          <section className="box">
            <h3>⧉ Merged duplicates</h3>
            {m.duplicates.map((d) => (
              <div key={d.recordId} className="small">
                <code>{d.recordId}</code> “{d.title}” {fmtTime(d.start)}–{fmtTime(d.end)} — {d.reason}
              </div>
            ))}
          </section>
        )}

        {(m.issues.length > 0 || m.notes.length > 0) && (
          <section>
            <h3>Data quality &amp; assumptions</h3>
            <ul className="list">
              {m.issues.map((i, idx) => (
                <li key={idx} className={`issue issue-${i.severity} small`}><b>{i.recordId}</b> · {i.field}: {i.message}</li>
              ))}
              {m.notes.map((n) => <li key={n} className="issue issue-info small">{n}</li>)}
            </ul>
          </section>
        )}

        {m.match && (
          <details>
            <summary>Why these records were matched (score {m.match.score})</summary>
            <ul className="small">{m.match.reasons.map((r) => <li key={r}>{r}</li>)}</ul>
          </details>
        )}
        <details>
          <summary>Raw source records</summary>
          <div className="raw-grid">
            {m.raw.crm && <pre><b>CRM</b>{'\n'}{JSON.stringify(m.raw.crm, null, 2)}</pre>}
            {m.raw.calendar && <pre><b>Calendar</b>{'\n'}{JSON.stringify(m.raw.calendar, null, 2)}</pre>}
            {m.duplicates.map((d) => <pre key={d.recordId}><b>Duplicate ({d.recordId})</b>{'\n'}{JSON.stringify(d.raw, null, 2)}</pre>)}
          </div>
        </details>
      </div>
    </div>
  );
}
