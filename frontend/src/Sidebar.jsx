import { MATCH_META, fmtDate, fmtTime } from './ui.jsx';

export default function Sidebar({ view, filters, setFilters, meetings, clashes, onOpen }) {
  const s = view.summary;
  const set = (patch) => setFilters((f) => ({ ...f, ...patch }));
  const conflicted = meetings.filter((m) => m.conflicts.length);
  const allIssues = view.meetings.flatMap((m) => m.issues);
  const realClashes = clashes.filter((c) => c.type === 'clash');
  const overlaps = clashes.filter((c) => c.type === 'overlap');

  return (
    <aside className="sidebar">
      <section className="stats">
        <Stat n={s.matched} label="in both sources" cls="src-both" />
        <Stat n={s.crmOnly} label="CRM only" cls="src-crm" />
        <Stat n={s.calendarOnly} label="Calendar only" cls="src-cal" />
        <Stat n={s.withConflicts} label="with conflicts" cls="warn" />
        <Stat n={s.clashes} label="clashes" cls="danger" />
        <Stat n={s.duplicatesMerged} label="duplicates merged" />
      </section>

      <section>
        <h3>Filters</h3>
        <label className="field">
          <span>View as</span>
          <select value={filters.person} onChange={(e) => set({ person: e.target.value })}>
            <option value="">Everyone</option>
            {view.firmPeople.map((p) => <option key={p} value={p}>{p}</option>)}
          </select>
        </label>
        {Object.entries(MATCH_META).map(([key, meta]) => (
          <label key={key} className="check">
            <input
              type="checkbox"
              checked={filters.matchTypes[key]}
              onChange={(e) => set({ matchTypes: { ...filters.matchTypes, [key]: e.target.checked } })}
            />
            <span className={`swatch ${meta.className}`} /> {meta.label}
          </label>
        ))}
        <label className="check">
          <input type="checkbox" checked={filters.conflictsOnly} onChange={(e) => set({ conflictsOnly: e.target.checked })} />
          Only meetings with conflicts
        </label>
        <label className="check">
          <input type="checkbox" checked={filters.showCancelled} onChange={(e) => set({ showCancelled: e.target.checked })} />
          Show cancelled
        </label>
        <p className="muted small">
          Legend: <b>⚠</b> sources disagree · <b>⇄</b> overlaps another meeting · <b>⧉</b> duplicate merged ·
          red outline = double-booked
        </p>
      </section>

      <section>
        <h3>Clashes &amp; overlaps <span className="count">{clashes.length}</span></h3>
        {clashes.length === 0 ? (
          <p className="muted small">
            No double-bookings{filters.person ? ` for ${filters.person}` : ''} after reconciliation.
            {s.duplicatesMerged > 0 && ' (One same-source duplicate was merged, otherwise it would show up as a clash. See ⧉.)'}
          </p>
        ) : (
          <ul className="list">
            {[...realClashes, ...overlaps].map((c) => (
              <li key={c.id} className={c.type === 'clash' ? 'clash-item' : 'overlap-item'}>
                <div className="small">
                  <b>{c.type === 'clash' ? 'Clash' : 'Overlap'}</b> · {fmtDate(c.startLocal)} {fmtTime(c.startLocal)}–{fmtTime(c.endLocal)}
                </div>
                {c.meetingIds.map((id, i) => (
                  <button type="button" key={id} className="link" onClick={() => onOpen(id)}>{c.titles[i]}</button>
                ))}
                {c.sharedParticipants.length > 0 && (
                  <div className="muted small">Double-booked: {c.sharedParticipants.join(', ')}</div>
                )}
              </li>
            ))}
          </ul>
        )}
      </section>

      <section>
        <h3>Source conflicts <span className="count">{conflicted.length}</span></h3>
        <ul className="list">
          {conflicted.map((m) => (
            <li key={m.id}>
              <button type="button" className="link" onClick={() => onOpen(m.id)}>{m.title}</button>
              <div className="muted small">
                {fmtDate(m.startLocal || m.date)} · {m.conflicts.map((c) => `${c.label}: ${c.crm} (CRM) vs ${c.calendar} (Cal)`).join(' · ')}
              </div>
            </li>
          ))}
        </ul>
      </section>

      <section>
        <details>
          <summary><h3 className="inline">Data quality issues <span className="count">{allIssues.length}</span></h3></summary>
          <ul className="list">
            {allIssues.map((i, idx) => (
              <li key={idx} className={`issue issue-${i.severity}`}>
                <div className="small"><b>{i.recordId}</b> · {i.field}</div>
                <div className="small">{i.message}</div>
              </li>
            ))}
          </ul>
        </details>
      </section>

      {view.unplaced.length > 0 && (
        <section>
          <h3>Could not be placed <span className="count">{view.unplaced.length}</span></h3>
          <ul className="list">
            {view.unplaced.map((u) => (
              <li key={u.recordId} className="issue issue-error">
                <div className="small"><b>{u.recordId}</b> · {u.title}</div>
                {u.issues.map((i, idx) => <div key={idx} className="small">{i.message}</div>)}
              </li>
            ))}
          </ul>
        </section>
      )}
    </aside>
  );
}

function Stat({ n, label, cls = '' }) {
  return (
    <div className={`stat ${cls}`}>
      <div className="stat-n">{n}</div>
      <div className="stat-l">{label}</div>
    </div>
  );
}
