// Converts raw records from both sources into the same internal shape (key:value) pairs

const { DateTime } = require('luxon');
const { TIMEZONE, FIRM_DOMAIN } = require('./config');
const { locationMode } = require('./text');

const EMAIL_RE = /^[^@\s]+@[^@\s]+\.[a-z]{2,}$/i;
const CANONICAL_ISO_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}$/;

function issue(source, recordId, field, severity, message) {
  return { source, recordId, field, severity, message };
}

function blankToNull(v) {
  if (v === undefined || v === null) return null;
  if (typeof v === 'string' && v.trim() === '') return null;
  return typeof v === 'string' ? v.trim() : v;
}

// Status

const STATUS_MAP = {
  confirmed: 'confirmed',
  scheduled: 'scheduled',
  tentative: 'tentative',
  cancelled: 'cancelled',
  canceled: 'cancelled',
  completed: 'completed',
};

function normalizeStatus(raw, issues, source, id) {
  const v = blankToNull(raw);
  if (!v) {
    issues.push(issue(source, id, 'status', 'warning', 'Status missing; assumed "scheduled".'));
    return 'scheduled';
  }
  const mapped = STATUS_MAP[String(v).toLowerCase()];
  if (!mapped) {
    issues.push(issue(source, id, 'status', 'warning', `Unknown status "${v}"; assumed "scheduled".`));
    return 'scheduled';
  }
  return mapped;
}

// Dates

// Accepts YYYY-MM-DD, plus US-style month-first variants with mixed separators
// (MM/DD/YYYY, MM-DD-YYYY, MM-DD/YYYY ...). Returns { date: 'YYYY-MM-DD' } or { date: null }.
function parseCrmDate(raw, issues, id) {
  const v = blankToNull(raw);
  if (!v) {
    issues.push(issue('crm', id, 'meeting_date', 'error', 'Meeting date missing; record cannot be placed on the calendar.'));
    return null;
  }
  let dt = DateTime.fromFormat(v, 'yyyy-MM-dd', { zone: TIMEZONE });
  if (dt.isValid) return dt.toISODate();

  const m = /^(\d{1,2})[-/.](\d{1,2})[-/.](\d{4})$/.exec(v);
  if (m) {
    dt = DateTime.fromObject({ year: +m[3], month: +m[1], day: +m[2] }, { zone: TIMEZONE });
    if (dt.isValid) {
      issues.push(issue('crm', id, 'meeting_date', 'warning',
        `Malformed date "${v}" interpreted as ${dt.toISODate()} (month-first, US format).`));
      return dt.toISODate();
    }
  }
  issues.push(issue('crm', id, 'meeting_date', 'error', `Unparseable date "${v}"; record cannot be placed on the calendar.`));
  return null;
}

function parseCrmTime(raw, issues, id) {
  const v = blankToNull(raw);
  if (!v) {
    issues.push(issue('crm', id, 'meeting_time', 'warning', 'Meeting time missing.'));
    return null;
  }
  const m = /^(\d{1,2}):(\d{2})$/.exec(v);
  if (!m || +m[1] > 23 || +m[2] > 59) {
    issues.push(issue('crm', id, 'meeting_time', 'warning', `Unparseable time "${v}"; ignored.`));
    return null;
  }
  return { hour: +m[1], minute: +m[2] };
}

// Calendar timestamps are ISO 8601. Ones without an offset are taken as local time in TIMEZONE,
// and ones with an offset get converted to TIMEZONE, so everything is compared on the same clock.
function parseCalendarDateTime(raw, field, issues, id) {
  const v = blankToNull(raw);
  if (!v) {
    issues.push(issue('calendar', id, field, 'error', `${field} missing.`));
    return null;
  }
  const dt = DateTime.fromISO(v, { zone: TIMEZONE });
  if (!dt.isValid) {
    issues.push(issue('calendar', id, field, 'error', `Unparseable timestamp "${v}".`));
    return null;
  }
  if (/[zZ]$|[+-]\d{2}:?\d{2}$/.test(v)) {
    issues.push(issue('calendar', id, field, 'info',
      `"${v}" carries an explicit UTC offset unlike other records; converted to ${TIMEZONE} (${dt.toFormat('HH:mm ZZZZ')}).`));
  } else if (!CANONICAL_ISO_RE.test(v)) {
    issues.push(issue('calendar', id, field, 'info', `Non-standard timestamp format "${v}"; parsed as ${dt.toFormat("yyyy-MM-dd'T'HH:mm:ss")}.`));
  }
  return dt;
}

// People

function cleanAttendees(list, issues, id) {
  if (!Array.isArray(list)) {
    if (list != null) issues.push(issue('calendar', id, 'attendees', 'warning', 'Attendees is not a list; ignored.'));
    return [];
  }
  const out = [];
  for (const rawA of list) {
    const a = blankToNull(rawA);
    if (!a) continue;
    if (EMAIL_RE.test(a)) {
      out.push({ email: a.toLowerCase(), label: a.toLowerCase(), valid: true });
      continue;
    }
    const repaired = a.replace(/\s*\[at\]\s*|\s*\(at\)\s*/gi, '@').replace(/\s*\[dot\]\s*/gi, '.');
    if (repaired !== a && EMAIL_RE.test(repaired)) {
      issues.push(issue('calendar', id, 'attendees', 'warning', `Obfuscated email "${a}" repaired to "${repaired}".`));
      out.push({ email: repaired.toLowerCase(), label: repaired.toLowerCase(), valid: true, repairedFrom: a });
      continue;
    }
    issues.push(issue('calendar', id, 'attendees', 'warning', `"${a}" is not an email address; kept as a placeholder label.`));
    out.push({ email: null, label: a, valid: false });
  }
  return out;
}

// "Sarah Chen" -> "sarah.chen@firma.com". All firm staff in the calendar data follow this pattern.
function guessFirmEmail(name) {
  if (!name) return null;
  const parts = name.toLowerCase().replace(/[^a-z\s]/g, '').trim().split(/\s+/);
  if (parts.length < 2) return null;
  return `${parts[0]}.${parts[parts.length - 1]}@${FIRM_DOMAIN}`;
}

// Per-source normalizers

function normalizeCrm(rec, index) {
  const issues = [];
  const id = blankToNull(rec.crm_id) || `CRM-row-${index + 1}`;
  if (!rec.crm_id) issues.push(issue('crm', id, 'crm_id', 'warning', 'Record has no ID; generated one from its row number.'));

  const date = parseCrmDate(rec.meeting_date, issues, id);
  const time = parseCrmTime(rec.meeting_time, issues, id);
  const start = date && time ? DateTime.fromISO(date, { zone: TIMEZONE }).set({ ...time, second: 0 }) : null;

  let clientName = blankToNull(rec.client_name);
  if (clientName && /^(multiple|various|n\/a|tbd)$/i.test(clientName)) {
    issues.push(issue('crm', id, 'client_name', 'info', `Client name is a placeholder ("${clientName}").`));
    clientName = null;
  }

  const meetingType = blankToNull(rec.meeting_type);
  const owner = blankToNull(rec.relationship_owner);

  return {
    source: 'crm',
    id,
    title: blankToNull(rec.subject),
    date,
    start,
    end: null,
    hasTime: Boolean(time),
    clientName,
    clientCompany: blankToNull(rec.client_company),
    owner,
    ownerEmail: guessFirmEmail(owner),
    meetingType,
    mode: meetingType === 'Virtual' || meetingType === 'In-Person' ? meetingType : locationMode(rec.location),
    location: blankToNull(rec.location),
    notes: blankToNull(rec.notes),
    status: normalizeStatus(rec.status, issues, 'crm', id),
    createdAt: blankToNull(rec.created_at),
    issues,
    raw: rec,
  };
}

function normalizeCalendar(rec, index) {
  const issues = [];
  const id = blankToNull(rec.event_id) || `CAL-row-${index + 1}`;
  if (!rec.event_id) issues.push(issue('calendar', id, 'event_id', 'warning', 'Record has no ID; generated one from its row number.'));

  const start = parseCalendarDateTime(rec.start_time, 'start_time', issues, id);
  let end = parseCalendarDateTime(rec.end_time, 'end_time', issues, id);
  if (start && end && end <= start) {
    issues.push(issue('calendar', id, 'end_time', 'warning', 'End time is not after start time; ignored.'));
    end = null;
  }

  const location = blankToNull(rec.location);
  if (!location) issues.push(issue('calendar', id, 'location', 'info', 'Location missing.'));

  return {
    source: 'calendar',
    id,
    title: blankToNull(rec.title),
    date: start ? start.toISODate() : null,
    start,
    end,
    hasTime: Boolean(start),
    organizer: blankToNull(rec.organizer)?.toLowerCase() || null,
    attendees: cleanAttendees(rec.attendees, issues, id),
    location,
    mode: locationMode(location),
    description: blankToNull(rec.description),
    isRecurring: Boolean(rec.is_recurring),
    status: normalizeStatus(rec.status, issues, 'calendar', id),
    createdAt: blankToNull(rec.created_at),
    issues,
    raw: rec,
  };
}

module.exports = { normalizeCrm, normalizeCalendar, guessFirmEmail };
