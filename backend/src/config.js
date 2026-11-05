const path = require('path');

module.exports = {
  PORT: Number(process.env.PORT) || 4000,
  DATA_DIR: process.env.DATA_DIR || path.resolve(__dirname, '../../data'),
  // The firm is on the US East Coast (DC, NYC and Boston offices). Timestamps without an offset
  // are read as local time here, and ones with an offset (like "Z") are converted to it.
  TIMEZONE: process.env.APP_TIMEZONE || 'America/New_York',
  // CRM records have a start time but no end time or duration.
  DEFAULT_DURATION_MIN: 60,
  // Internal email domain, used to tell firm staff apart from external clients.
  FIRM_DOMAIN: 'firma.com',
  // Minimum score for a CRM record and a Calendar event to be considered the same meeting.
  MATCH_THRESHOLD: 5,
};
