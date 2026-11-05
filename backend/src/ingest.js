// Reads both source files, normalizes them and runs the reconciliation.

const fs = require('fs/promises');
const path = require('path');
const { DATA_DIR, TIMEZONE } = require('./config');
const { normalizeCrm, normalizeCalendar } = require('./normalize');
const { reconcile } = require('./reconcile');

const SOURCES = {
  crm: { file: 'crm_events.json', label: 'CRM API', normalize: normalizeCrm },
  calendar: { file: 'calendar_events.json', label: 'Calendar API', normalize: normalizeCalendar },
};

async function readSource(key) {
  const { file } = SOURCES[key];
  const filePath = path.join(DATA_DIR, file);
  const text = await fs.readFile(filePath, 'utf8');
  let data;
  try {
    data = JSON.parse(text);
  } catch (err) {
    throw new Error(`${file} is not valid JSON: ${err.message}`);
  }
  if (!Array.isArray(data)) throw new Error(`${file} must contain a JSON array of records`);
  return data;
}

async function buildUnifiedView() {
  const [crmRaw, calRaw] = await Promise.all([readSource('crm'), readSource('calendar')]);
  const crm = crmRaw.map((r, i) => SOURCES.crm.normalize(r, i));
  const calendar = calRaw.map((r, i) => SOURCES.calendar.normalize(r, i));
  return {
    generatedAt: new Date().toISOString(),
    timezone: TIMEZONE,
    ...reconcile(crm, calendar),
  };
}

module.exports = { buildUnifiedView, readSource, SOURCES };
