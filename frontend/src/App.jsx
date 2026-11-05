import { useEffect, useMemo, useRef, useState } from 'react';
import FullCalendar from '@fullcalendar/react';
import dayGridPlugin from '@fullcalendar/daygrid';
import timeGridPlugin from '@fullcalendar/timegrid';
import listPlugin from '@fullcalendar/list';
import interactionPlugin from '@fullcalendar/interaction';
import Sidebar from './Sidebar.jsx';
import MeetingDetail from './MeetingDetail.jsx';

const DEFAULT_FILTERS = {
  person: '',
  showCancelled: true,
  conflictsOnly: false,
  matchTypes: { matched: true, crm_only: true, calendar_only: true },
};

export default function App() {
  const [view, setView] = useState(null);
  const [error, setError] = useState(null);
  // Keep the open meeting in the URL (?meeting=<id>) so it can be linked to.
  const [selectedId, setSelectedIdState] = useState(() => new URLSearchParams(window.location.search).get('meeting'));
  const setSelectedId = (id) => {
    setSelectedIdState(id);
    const url = new URL(window.location.href);
    if (id) url.searchParams.set('meeting', id);
    else url.searchParams.delete('meeting');
    window.history.replaceState(null, '', url);
  };
  const [filters, setFilters] = useState(DEFAULT_FILTERS);
  const calendarRef = useRef(null);

  const load = () => {
    setError(null);
    fetch('/api/meetings')
      .then(async (r) => {
        if (!r.ok) throw new Error((await r.json().catch(() => ({}))).error || `HTTP ${r.status}`);
        return r.json();
      })
      .then(setView)
      .catch((e) => setError(e.message));
  };
  useEffect(load, []);

  const meetings = useMemo(() => {
    if (!view) return [];
    return view.meetings.filter((m) => {
      if (filters.person && !m.participants.includes(filters.person)) return false;
      if (!filters.showCancelled && m.status === 'cancelled') return false;
      if (filters.conflictsOnly && !m.conflicts.length) return false;
      return filters.matchTypes[m.matchType];
    });
  }, [view, filters]);

  const visibleIds = useMemo(() => new Set(meetings.map((m) => m.id)), [meetings]);
  const clashes = useMemo(
    () => (view ? view.clashes.filter((c) => c.meetingIds.every((id) => visibleIds.has(id))) : []),
    [view, visibleIds],
  );
  const clashedIds = useMemo(() => {
    const ids = new Set();
    clashes.filter((c) => c.type === 'clash').forEach((c) => c.meetingIds.forEach((id) => ids.add(id)));
    return ids;
  }, [clashes]);

  const events = useMemo(() => meetings.map((m) => ({
    id: m.id,
    title: m.title,
    start: m.allDay ? m.date : m.startLocal,
    end: m.allDay ? undefined : m.endLocal,
    allDay: m.allDay,
    classNames: [
      `ev-${m.matchType}`,
      m.status === 'cancelled' && 'ev-cancelled',
      m.status === 'tentative' && 'ev-tentative',
      clashedIds.has(m.id) && 'ev-clash',
      m.conflicts.length && 'ev-conflict',
    ].filter(Boolean),
    extendedProps: { meeting: m },
  })), [meetings, clashedIds]);

  const selected = view?.meetings.find((m) => m.id === selectedId) || null;
  const initialDate = selected?.date || view?.meetings[0]?.date;

  const openMeeting = (id) => {
    const m = view.meetings.find((x) => x.id === id);
    if (!m) return;
    setSelectedId(id);
    calendarRef.current?.getApi().gotoDate(m.date);
  };

  if (error) {
    return (
      <div className="center-msg">
        <h2>Could not load meetings</h2>
        <p className="muted">{error}</p>
        <button type="button" onClick={load}>Retry</button>
      </div>
    );
  }
  if (!view) return <div className="center-msg">Loading meetings…</div>;

  return (
    <div className="app">
      <header className="topbar">
        <div>
          <h1>Unified Meetings Calendar</h1>
          <span className="muted small">
            {view.summary.sourceRecords.crm} CRM records + {view.summary.sourceRecords.calendar} Calendar events →{' '}
            {view.summary.totalMeetings} reconciled meetings · times shown in {view.timezone}
          </span>
        </div>
        <button type="button" className="ghost" onClick={load} title="Re-ingest both sources">↻ Re-sync</button>
      </header>
      <div className="layout">
        <Sidebar
          view={view}
          filters={filters}
          setFilters={setFilters}
          meetings={meetings}
          clashes={clashes}
          onOpen={openMeeting}
        />
        <main className="calendar-wrap">
          <FullCalendar
            ref={calendarRef}
            plugins={[dayGridPlugin, timeGridPlugin, listPlugin, interactionPlugin]}
            initialView="timeGridWeek"
            initialDate={initialDate}
            headerToolbar={{
              left: 'prev,next today',
              center: 'title',
              right: 'dayGridMonth,timeGridWeek,timeGridDay,listMonth',
            }}
            buttonText={{ today: 'Today', month: 'Month', week: 'Week', day: 'Day', list: 'List' }}
            events={events}
            height="100%"
            slotMinTime="07:00:00"
            slotMaxTime="23:00:00"
            scrollTime="08:00:00"
            nowIndicator
            dayMaxEvents={4}
            eventClick={(info) => setSelectedId(info.event.id)}
            eventContent={renderEvent}
          />
        </main>
      </div>
      {selected && (
        <MeetingDetail
          meeting={selected}
          clashes={view.clashes.filter((c) => selected.clashIds.includes(c.id))}
          allMeetings={view.meetings}
          onClose={() => setSelectedId(null)}
          onOpen={openMeeting}
        />
      )}
    </div>
  );
}

function renderEvent(arg) {
  const m = arg.event.extendedProps.meeting;
  const isList = arg.view.type.startsWith('list');
  const flags = (
    <span className="ev-flags">
      {m.conflicts.length > 0 && <span className="flag flag-conflict" title={`${m.conflicts.length} source conflict(s)`}>⚠ {m.conflicts.length}</span>}
      {m.clashIds.length > 0 && <span className="flag flag-clash" title="Overlaps another meeting">⇄</span>}
      {m.duplicates.length > 0 && <span className="flag" title="Merged an in-source duplicate">⧉</span>}
      {m.status === 'cancelled' && <span className="flag">cancelled</span>}
      {m.status === 'tentative' && <span className="flag">tentative</span>}
    </span>
  );
  if (isList) {
    return (
      <div className="ev-list">
        <span className="ev-title">{arg.event.title}</span>
        <span className="ev-src">{m.sources.map((s) => (s === 'crm' ? 'CRM' : 'Calendar')).join(' + ')}</span>
        {flags}
      </div>
    );
  }
  return (
    <div className="ev">
      <div className="ev-top">
        <span className="ev-time">{arg.timeText}</span>
        {flags}
      </div>
      <div className="ev-title">{arg.event.title}</div>
    </div>
  );
}
