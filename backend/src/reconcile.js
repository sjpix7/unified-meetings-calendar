// Reconciliation. Roughly: collapse duplicates inside each source (clusterDuplicates), pair up
// CRM and Calendar records (scorePair, then a greedy one-to-one pick), merge each pair into a
// single meeting that remembers where every field came from (merge), and finally look for
// meetings that overlap in time (findClashes).

const { DEFAULT_DURATION_MIN, FIRM_DOMAIN, MATCH_THRESHOLD } = require('./config');
const {
  titleSimilarity, personKey, companyKeyTokens, emailDomain, locationsCompatible, tokens,
} = require('./text');

const LOCAL_FMT = "yyyy-MM-dd'T'HH:mm:ss";

// Duplicates within a single source

function overlaps(a, b) {
  if (!a.start || !b.start) return false;
  const aEnd = a.end || a.start.plus({ minutes: DEFAULT_DURATION_MIN });
  const bEnd = b.end || b.start.plus({ minutes: DEFAULT_DURATION_MIN });
  return a.start < bEnd && b.start < aEnd;
}

function externalEmails(cal) {
  return new Set(cal.attendees.filter((a) => a.email && emailDomain(a.email) !== FIRM_DOMAIN).map((a) => a.email));
}

// Two records in the same source "look like the same meeting" when they are on the same day,
// owned/organized by the same person, overlap in time, and involve the same counterparty
// (or have clearly similar titles). Recurring instances on different days aren't duplicates.
function isDuplicatePair(a, b) {
  if (!a.date || a.date !== b.date) return false;
  if (a.source === 'calendar') {
    if (a.organizer !== b.organizer || !overlaps(a, b)) return false;
    const ea = externalEmails(a);
    const sharedExternal = [...externalEmails(b)].some((e) => ea.has(e));
    return sharedExternal || titleSimilarity(a.title, b.title) >= 0.5;
  }
  // CRM: same owner, same client (or similar subject), times within an hour (or unknown)
  if (a.owner !== b.owner) return false;
  const timeClose = !a.start || !b.start || Math.abs(a.start.diff(b.start, 'minutes').minutes) <= 60;
  const sameClient = a.clientName && b.clientName && personKey(a.clientName) === personKey(b.clientName);
  return timeClose && (sameClient || titleSimilarity(a.title, b.title) >= 0.5);
}

// Returns clusters of { primary, duplicates[] }. The newest record becomes the primary since it's
// most likely the updated invite.
function clusterDuplicates(records) {
  const parent = records.map((_, i) => i);
  const find = (i) => (parent[i] === i ? i : (parent[i] = find(parent[i])));
  for (let i = 0; i < records.length; i++) {
    for (let j = i + 1; j < records.length; j++) {
      if (isDuplicatePair(records[i], records[j])) parent[find(i)] = find(j);
    }
  }
  const groups = new Map();
  records.forEach((r, i) => {
    const root = find(i);
    if (!groups.has(root)) groups.set(root, []);
    groups.get(root).push(r);
  });
  return [...groups.values()].map((members) => {
    const sorted = [...members].sort((x, y) => String(y.createdAt || '').localeCompare(String(x.createdAt || '')));
    return { primary: sorted[0], duplicates: sorted.slice(1), members };
  });
}

// Matching CRM records to Calendar events

// How likely is it that a CRM record and a Calendar event are the same meeting? They have to be
// on the same local day, and we also need some identity evidence (the client, their company, or
// a similar title). Otherwise two unrelated meetings at the same time could get merged.
function scorePair(crm, cal) {
  const result = { score: 0, reasons: [], identity: false };
  if (!crm.date || !cal.date || crm.date !== cal.date) return result;
  const add = (pts, reason) => { result.score += pts; result.reasons.push(`+${pts} ${reason}`); };

  if (crm.start && cal.start) {
    const diff = Math.abs(cal.start.diff(crm.start, 'minutes').minutes);
    if (diff <= 15) add(3, 'start times match');
    else if (diff <= 60) add(2, `start times within ${diff} min`);
    else if (diff <= 180) add(1, `start times within ${diff} min`);
  }

  const people = [cal.organizer, ...cal.attendees.map((a) => a.email)].filter(Boolean);
  const peopleKeys = new Set(people.map(personKey));

  if (crm.clientName && peopleKeys.has(personKey(crm.clientName))) {
    add(4, `client ${crm.clientName} is an attendee`);
    result.identity = true;
  }
  const companyToks = companyKeyTokens(crm.clientCompany);
  if (companyToks.length) {
    const domains = people.map(emailDomain);
    const titleToks = new Set(tokens(cal.title));
    if (companyToks.some((t) => domains.some((d) => d.includes(t)) || titleToks.has(t))) {
      add(2, `client company ${crm.clientCompany} appears in attendees/title`);
      result.identity = true;
    }
  }
  if (crm.ownerEmail && people.includes(crm.ownerEmail)) add(1, `owner ${crm.owner} is on the invite`);

  const sim = titleSimilarity(crm.title, cal.title);
  if (sim > 0) add(Math.round(sim * 30) / 10, `title similarity ${Math.round(sim * 100)}%`);
  if (sim >= 0.3) result.identity = true;

  if (crm.location && cal.location && locationsCompatible(crm.location, cal.location)) add(1, 'locations agree');

  result.score = Math.round(result.score * 10) / 10;
  return result;
}

function bestScore(crmCluster, calCluster) {
  let best = { score: 0, reasons: [], identity: false };
  for (const c of crmCluster.members) {
    for (const k of calCluster.members) {
      const s = scorePair(c, k);
      if (s.identity && s.score > best.score) best = s;
    }
  }
  return best;
}

function matchClusters(crmClusters, calClusters) {
  const candidates = [];
  crmClusters.forEach((c, i) => calClusters.forEach((k, j) => {
    const s = bestScore(c, k);
    if (s.identity && s.score >= MATCH_THRESHOLD) candidates.push({ i, j, ...s });
  }));
  candidates.sort((a, b) => b.score - a.score);

  const usedCrm = new Set();
  const usedCal = new Set();
  const pairs = [];
  for (const cand of candidates) {
    if (usedCrm.has(cand.i) || usedCal.has(cand.j)) continue;
    usedCrm.add(cand.i);
    usedCal.add(cand.j);
    pairs.push({ crm: crmClusters[cand.i], cal: calClusters[cand.j], match: cand });
  }
  crmClusters.forEach((c, i) => { if (!usedCrm.has(i)) pairs.push({ crm: c, cal: null, match: null }); });
  calClusters.forEach((k, j) => { if (!usedCal.has(j)) pairs.push({ crm: null, cal: k, match: null }); });
  return pairs;
}

// Merging a matched pair into one meeting

function field(label, crmVal, calVal, opts = {}) {
  const has = (v) => v !== null && v !== undefined && !(Array.isArray(v) && v.length === 0);
  let value;
  let source;
  if (opts.value !== undefined) {
    ({ value, source } = opts);
  } else if (has(calVal) && has(crmVal)) {
    value = opts.prefer === 'crm' ? crmVal : calVal;
    source = opts.equal ? 'both' : opts.prefer === 'crm' ? 'crm' : 'calendar';
  } else if (has(calVal)) {
    value = calVal; source = 'calendar';
  } else if (has(crmVal)) {
    value = crmVal; source = 'crm';
  } else {
    value = null; source = null;
  }
  return {
    label,
    value,
    source,
    crm: crmVal === undefined ? undefined : crmVal,
    calendar: calVal === undefined ? undefined : calVal,
    conflict: Boolean(opts.conflict),
    note: opts.note || null,
  };
}

const fmtTime = (dt) => (dt ? dt.toFormat('HH:mm') : null);

function resolveStatus(crmStatus, calStatus) {
  const statuses = [crmStatus, calStatus].filter(Boolean);
  if (statuses.length < 2) return { value: statuses[0] || 'scheduled', conflict: false };
  const cancelled = statuses.filter((s) => s === 'cancelled').length;
  if (cancelled === 1) {
    return { value: 'cancelled', conflict: true, rule: 'A cancellation in either source wins, so it is never hidden.' };
  }
  if (statuses.includes('completed')) return { value: 'completed', conflict: false };
  const tentative = statuses.filter((s) => s === 'tentative').length;
  if (tentative === 1) {
    return { value: 'tentative', conflict: true, rule: 'If either source is tentative, the meeting is shown as tentative.' };
  }
  return { value: calStatus, conflict: false };
}

function merge(pair) {
  const crm = pair.crm?.primary || null;
  const cal = pair.cal?.primary || null;
  const conflicts = [];
  const notes = [];
  const fields = {};

  const addConflict = (key, label, crmVal, calVal, resolvedTo, rule, severity = 'medium') => {
    conflicts.push({ field: key, label, crm: crmVal, calendar: calVal, resolvedTo, rule, severity });
  };

  // time
  let start = null;
  let end = null;
  let allDay = false;
  if (cal?.start) {
    start = cal.start;
    end = cal.end || cal.start.plus({ minutes: DEFAULT_DURATION_MIN });
    if (!cal.end) notes.push(`Calendar end time unusable; assumed ${DEFAULT_DURATION_MIN} min duration.`);
    if (crm?.start) {
      const diff = Math.round(cal.start.diff(crm.start, 'minutes').minutes);
      if (diff !== 0) {
        addConflict('start', 'Start time', fmtTime(crm.start), fmtTime(cal.start), fmtTime(cal.start),
          'Calendar is authoritative for scheduling (it is what attendees were invited to).',
          Math.abs(diff) >= 30 ? 'high' : 'medium');
      }
    } else if (crm && !crm.hasTime) {
      notes.push('CRM record has no time; time taken from Calendar.');
    }
  } else if (crm?.start) {
    start = crm.start;
    end = crm.start.plus({ minutes: DEFAULT_DURATION_MIN });
    notes.push(`CRM records have no end time; assumed ${DEFAULT_DURATION_MIN} min duration.`);
  } else {
    const date = crm?.date || cal?.date;
    if (date) {
      allDay = true;
      notes.push('No usable start time in any source; shown as an all-day item.');
    }
  }
  const timesAgree = crm?.start && cal?.start && +crm.start === +cal.start;
  fields.start = field('Start', crm ? fmtTime(crm.start) : undefined, cal ? fmtTime(cal.start) : undefined, {
    value: start ? fmtTime(start) : null,
    source: cal?.start ? (timesAgree ? 'both' : 'calendar') : crm?.start ? 'crm' : null,
    conflict: conflicts.some((c) => c.field === 'start'),
  });
  fields.end = field('End', crm ? null : undefined, cal ? fmtTime(cal.end) : undefined, {
    value: end ? fmtTime(end) : null,
    source: cal?.end ? 'calendar' : end ? 'derived' : null,
    note: !cal?.end && end ? `Assumed ${DEFAULT_DURATION_MIN} min duration` : null,
  });

  // title
  fields.title = field('Title', crm ? crm.title : undefined, cal ? cal.title : undefined);

  // location
  let locConflict = false;
  let locValue;
  let locSource;
  if (crm?.location && cal?.location) {
    if (locationsCompatible(crm.location, cal.location)) {
      locValue = cal.location.length >= crm.location.length ? cal.location : crm.location;
      locSource = 'both';
    } else {
      locConflict = true;
      locValue = cal.location;
      locSource = 'calendar';
      addConflict('location', 'Location', crm.location, cal.location, cal.location,
        'Calendar is authoritative for logistics (location / link on the actual invite).',
        crm.mode !== cal.mode ? 'high' : 'low');
    }
  }
  fields.location = field('Location', crm ? crm.location : undefined, cal ? cal.location : undefined,
    locValue !== undefined ? { value: locValue, source: locSource, conflict: locConflict } : {});

  // format (virtual / in-person)
  const crmMode = crm?.mode || null;
  const calMode = cal?.mode || null;
  const modeConflict = Boolean(crmMode && calMode && crmMode !== calMode);
  if (modeConflict) {
    addConflict('format', 'Format', crm.meetingType || crmMode, calMode, calMode,
      'Format is derived from the Calendar location, which is authoritative for logistics.', 'high');
  }
  fields.format = field('Format', crm ? crmMode : undefined, cal ? calMode : undefined,
    { equal: crmMode === calMode, conflict: modeConflict });

  // category (client vs internal)
  let category;
  let categorySource;
  if (crm) {
    category = crm.meetingType === 'Internal' ? 'Internal' : 'Client';
    categorySource = 'crm';
  } else {
    const external = cal.attendees.some((a) => !a.email || emailDomain(a.email) !== FIRM_DOMAIN);
    category = external ? 'Client' : 'Internal';
    categorySource = 'derived';
  }
  fields.category = field('Category', crm ? category : undefined, undefined, {
    value: category, source: categorySource,
    note: categorySource === 'derived' ? 'Inferred from attendee email domains' : `From CRM meeting_type "${crm.meetingType}"`,
  });

  // status
  const st = resolveStatus(crm?.status, cal?.status);
  if (st.conflict) addConflict('status', 'Status', crm.status, cal.status, st.value, st.rule, 'high');
  fields.status = field('Status', crm ? crm.status : undefined, cal ? cal.status : undefined, {
    value: st.value,
    source: crm && cal
      ? (crm.status === cal.status ? 'both' : st.value === cal.status ? 'calendar' : 'crm')
      : crm ? 'crm' : 'calendar',
    conflict: st.conflict,
  });

  // business context (CRM) and invite details (Calendar)
  fields.client = field('Client', crm ? crm.clientName : undefined, undefined);
  fields.company = field('Company', crm ? crm.clientCompany : undefined, undefined);
  fields.owner = field('Relationship owner', crm ? crm.owner : undefined, undefined);
  fields.organizer = field('Organizer', undefined, cal ? cal.organizer : undefined);
  fields.attendees = field('Attendees', undefined, cal ? cal.attendees.map((a) => a.label) : undefined);
  fields.notes = field('CRM notes', crm ? crm.notes : undefined, undefined);
  fields.description = field('Calendar description', undefined, cal ? cal.description : undefined);
  fields.recurring = field('Recurring', undefined, cal ? cal.isRecurring : undefined);

  // participants (for clash detection + "view as" filter)
  const participants = new Set();
  if (cal) {
    if (cal.organizer) participants.add(cal.organizer);
    cal.attendees.forEach((a) => a.email && participants.add(a.email));
  }
  if (crm?.ownerEmail) participants.add(crm.ownerEmail);

  // duplicates + issues
  const duplicates = [];
  for (const cluster of [pair.crm, pair.cal]) {
    if (!cluster || !cluster.duplicates.length) continue;
    for (const d of cluster.duplicates) {
      duplicates.push({
        source: d.source,
        recordId: d.id,
        keptRecordId: cluster.primary.id,
        title: d.title,
        start: d.start ? d.start.toFormat(LOCAL_FMT) : null,
        end: d.end ? d.end.toFormat(LOCAL_FMT) : null,
        reason: `Same day, same ${d.source === 'calendar' ? 'organizer' : 'owner'}, overlapping time and same counterparty as ${cluster.primary.id}. Kept the most recently created record (${cluster.primary.id}).`,
        raw: d.raw,
      });
    }
  }
  const members = [...(pair.crm?.members || []), ...(pair.cal?.members || [])];
  const issues = members.flatMap((m) => m.issues);

  const crmIds = pair.crm ? pair.crm.members.map((m) => m.id) : [];
  const calIds = pair.cal ? pair.cal.members.map((m) => m.id) : [];
  const id = [crm?.id, cal?.id].filter(Boolean).join('__');

  return {
    id,
    title: fields.title.value || '(untitled)',
    start: start ? start.toISO() : null,
    end: end ? end.toISO() : null,
    startLocal: start ? start.toFormat(LOCAL_FMT) : null,
    endLocal: end ? end.toFormat(LOCAL_FMT) : null,
    date: start ? start.toISODate() : crm?.date || cal?.date || null,
    allDay,
    status: st.value,
    category,
    format: fields.format.value,
    location: fields.location.value,
    sources: [crm && 'crm', cal && 'calendar'].filter(Boolean),
    matchType: crm && cal ? 'matched' : crm ? 'crm_only' : 'calendar_only',
    match: pair.match ? { score: pair.match.score, reasons: pair.match.reasons } : null,
    sourceRecordIds: { crm: crmIds, calendar: calIds },
    fields,
    conflicts,
    notes,
    issues,
    duplicates,
    participants: [...participants].sort(),
    clashIds: [],
    raw: {
      crm: crm ? crm.raw : null,
      calendar: cal ? cal.raw : null,
    },
  };
}

// Clashes and overlaps

// A clash is two active meetings at the same time with at least one person in both, i.e. someone
// is double-booked. An overlap is the same thing but with nobody in common.
function findClashes(meetings) {
  const timed = meetings
    .filter((m) => m.start && !m.allDay && m.status !== 'cancelled')
    .sort((a, b) => a.start.localeCompare(b.start));
  const clashes = [];
  for (let i = 0; i < timed.length; i++) {
    for (let j = i + 1; j < timed.length; j++) {
      const a = timed[i];
      const b = timed[j];
      if (new Date(b.start) >= new Date(a.end)) break; // sorted by start, so nothing after this overlaps a
      const shared = a.participants.filter((p) => b.participants.includes(p));
      const startLocal = a.startLocal > b.startLocal ? a.startLocal : b.startLocal;
      const endLocal = a.endLocal < b.endLocal ? a.endLocal : b.endLocal;
      const clash = {
        id: `clash-${clashes.length + 1}`,
        type: shared.length ? 'clash' : 'overlap',
        meetingIds: [a.id, b.id],
        titles: [a.title, b.title],
        startLocal,
        endLocal,
        sharedParticipants: shared,
      };
      clashes.push(clash);
      a.clashIds.push(clash.id);
      b.clashIds.push(clash.id);
    }
  }
  return clashes;
}

function reconcile(crmRecords, calRecords) {
  const crmClusters = clusterDuplicates(crmRecords);
  const calClusters = clusterDuplicates(calRecords);

  // Without a usable date we can't match or place a record, so list these separately.
  const placeable = (c) => Boolean(c.primary.date);
  const unplaced = [...crmClusters, ...calClusters].filter((c) => !placeable(c)).flatMap((c) => c.members.map((m) => ({
    source: m.source, recordId: m.id, title: m.title, issues: m.issues, raw: m.raw,
  })));

  const pairs = matchClusters(crmClusters.filter(placeable), calClusters.filter(placeable));
  const meetings = pairs.map(merge).sort((a, b) => String(a.startLocal || a.date).localeCompare(String(b.startLocal || b.date)));
  const clashes = findClashes(meetings);

  const firmPeople = [...new Set(meetings.flatMap((m) => m.participants))]
    .filter((p) => emailDomain(p) === FIRM_DOMAIN).sort();

  const allIssues = [...crmRecords, ...calRecords].flatMap((r) => r.issues);
  const summary = {
    totalMeetings: meetings.length,
    matched: meetings.filter((m) => m.matchType === 'matched').length,
    crmOnly: meetings.filter((m) => m.matchType === 'crm_only').length,
    calendarOnly: meetings.filter((m) => m.matchType === 'calendar_only').length,
    withConflicts: meetings.filter((m) => m.conflicts.length).length,
    conflicts: meetings.reduce((n, m) => n + m.conflicts.length, 0),
    duplicatesMerged: meetings.reduce((n, m) => n + m.duplicates.length, 0),
    clashes: clashes.filter((c) => c.type === 'clash').length,
    overlaps: clashes.filter((c) => c.type === 'overlap').length,
    cancelled: meetings.filter((m) => m.status === 'cancelled').length,
    dataIssues: allIssues.length,
    unplaced: unplaced.length,
    sourceRecords: { crm: crmRecords.length, calendar: calRecords.length },
  };

  return { summary, meetings, clashes, unplaced, firmPeople };
}

module.exports = { reconcile, scorePair, clusterDuplicates, findClashes, resolveStatus };
