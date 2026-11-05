// Text helpers for fuzzy matching of titles, locations, names and companies.

const TITLE_STOPWORDS = new Set(['the', 'a', 'an', 'and', 'of', 'with', 'for', 'to', 're', 'meeting', 'call', 'discussion']);
const COMPANY_STOPWORDS = new Set([
  'the', 'capital', 'group', 'partners', 'holdings', 'advisors', 'investments', 'wealth',
  'ventures', 'institutional', 'inc', 'llc', 'fund', 'investors', 'point',
]);
const VIRTUAL_RE = /\b(zoom|teams|virtual|webex|google meet|meet\.google|video|dial[- ]?in)\b/i;

function tokens(str, stopwords = TITLE_STOPWORDS) {
  if (!str) return [];
  return String(str)
    .toLowerCase()
    .replace(/https?:\/\/\S+/g, ' ')
    .split(/[^a-z0-9]+/)
    .filter((t) => t && !stopwords.has(t));
}

// Acronyms built from consecutive tokens. Short tokens (<=2 chars, e.g. "lp") are kept whole,
// so "LP Advisory Committee" -> "lpac" and "Quarterly Business Review" -> "qbr".
function acronyms(toks) {
  const out = new Set();
  for (let i = 0; i < toks.length; i++) {
    let acc = '';
    for (let j = i; j < toks.length; j++) {
      acc += toks[j].length <= 2 ? toks[j] : toks[j][0];
      if (j > i) out.add(acc);
    }
  }
  return out;
}

// Overlap coefficient between two titles (shared tokens / size of the smaller set), counting
// an acronym in one title that expands to words in the other as one shared token.
function titleSimilarity(a, b) {
  const ta = [...new Set(tokens(a))];
  const tb = [...new Set(tokens(b))];
  if (!ta.length || !tb.length) return 0;
  const setB = new Set(tb);
  let shared = ta.filter((t) => setB.has(t)).length;
  const acrA = acronyms(ta);
  const acrB = acronyms(tb);
  if (tb.some((t) => acrA.has(t)) || ta.some((t) => acrB.has(t))) shared += 1;
  return Math.min(1, shared / Math.min(ta.length, tb.length));
}

// "Kevin O'Brien" -> "kevinobrien" ; "kevin.obrien@x.com" -> "kevinobrien"
function personKey(nameOrEmail) {
  if (!nameOrEmail) return '';
  const local = String(nameOrEmail).split('@')[0];
  return local.toLowerCase().replace(/[^a-z]/g, '');
}

function companyKeyTokens(company) {
  return tokens(company, COMPANY_STOPWORDS).filter((t) => t.length >= 3);
}

function emailDomain(email) {
  const at = String(email || '').indexOf('@');
  return at === -1 ? '' : email.slice(at + 1).toLowerCase();
}

// Two locations are compatible when one is just a more specific version of the other, like
// "Conference Room B" and "HQ - Conference Room B", or "Zoom" and "Zoom - https://...".
function locationsCompatible(a, b) {
  const ta = new Set(tokens(a, new Set(['the'])));
  const tb = new Set(tokens(b, new Set(['the'])));
  if (!ta.size || !tb.size) return true;
  const aInB = [...ta].every((t) => tb.has(t));
  const bInA = [...tb].every((t) => ta.has(t));
  return aInB || bInA;
}

function locationMode(location) {
  if (!location) return null;
  return VIRTUAL_RE.test(location) ? 'Virtual' : 'In-Person';
}

module.exports = {
  tokens,
  titleSimilarity,
  personKey,
  companyKeyTokens,
  emailDomain,
  locationsCompatible,
  locationMode,
};
