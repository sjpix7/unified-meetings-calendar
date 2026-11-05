const express = require('express');
const { PORT, DATA_DIR } = require('./config');
const { buildUnifiedView, readSource, SOURCES } = require('./ingest');

const app = express();

const wrap = (fn) => (req, res, next) => fn(req, res, next).catch(next);

app.get('/api/health', (req, res) => res.json({ status: 'ok' }));

// The merged meeting list with clashes and summary counts. Optional filters:
// ?person=<email> keeps that person's meetings (and the clashes between them),
// ?conflicts=true keeps only meetings where the sources disagree.
app.get('/api/meetings', wrap(async (req, res) => {
  const view = await buildUnifiedView();
  let { meetings, clashes } = view;
  if (req.query.person) {
    const p = String(req.query.person).toLowerCase();
    meetings = meetings.filter((m) => m.participants.includes(p));
    const ids = new Set(meetings.map((m) => m.id));
    clashes = clashes.filter((c) => c.meetingIds.every((id) => ids.has(id)));
  }
  if (req.query.conflicts === 'true') meetings = meetings.filter((m) => m.conflicts.length);
  res.json({ ...view, meetings, clashes });
}));

app.get('/api/meetings/:id', wrap(async (req, res) => {
  const { meetings, clashes } = await buildUnifiedView();
  const meeting = meetings.find((m) => m.id === req.params.id);
  if (!meeting) return res.status(404).json({ error: `Meeting ${req.params.id} not found` });
  res.json({ ...meeting, clashes: clashes.filter((c) => meeting.clashIds.includes(c.id)) });
}));

// Raw source data as ingested. Handy for checking the reconciliation by hand.
app.get('/api/sources/:source', wrap(async (req, res) => {
  if (!SOURCES[req.params.source]) {
    return res.status(404).json({ error: `Unknown source. Use one of: ${Object.keys(SOURCES).join(', ')}` });
  }
  res.json(await readSource(req.params.source));
}));

app.use('/api', (req, res) => res.status(404).json({ error: 'Not found' }));

// eslint-disable-next-line no-unused-vars
app.use((err, req, res, next) => {
  console.error(err);
  res.status(500).json({ error: err.message });
});

app.listen(PORT, () => {
  console.log(`Event Sync API listening on http://localhost:${PORT} (data: ${DATA_DIR})`);
});
