// Small display helpers shared by the components.

export const SOURCE_META = {
  crm: { label: 'CRM', className: 'src-crm', title: 'Value comes from the CRM API' },
  calendar: { label: 'Calendar', className: 'src-cal', title: 'Value comes from the Calendar API' },
  both: { label: 'Both', className: 'src-both', title: 'Both sources agree on this value' },
  derived: { label: 'Derived', className: 'src-derived', title: 'Not in either source; inferred by the sync service' },
};

export const MATCH_META = {
  matched: { label: 'CRM + Calendar', className: 'src-both' },
  crm_only: { label: 'CRM only', className: 'src-crm' },
  calendar_only: { label: 'Calendar only', className: 'src-cal' },
};

export function SourceBadge({ source }) {
  if (!source) return <span className="badge src-none">—</span>;
  const meta = SOURCE_META[source];
  return <span className={`badge ${meta.className}`} title={meta.title}>{meta.label}</span>;
}

export function StatusBadge({ status }) {
  return <span className={`badge status status-${status}`}>{status}</span>;
}

export function fmtValue(v) {
  if (v === null || v === undefined || v === '') return <span className="muted">—</span>;
  if (Array.isArray(v)) return v.length ? v.join(', ') : <span className="muted">—</span>;
  if (typeof v === 'boolean') return v ? 'Yes' : 'No';
  return String(v);
}

const dateFmt = new Intl.DateTimeFormat('en-US', { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' });
export function fmtDate(localIso) {
  if (!localIso) return '';
  const [y, m, d] = localIso.slice(0, 10).split('-').map(Number);
  return dateFmt.format(new Date(y, m - 1, d));
}
export const fmtTime = (localIso) => (localIso ? localIso.slice(11, 16) : '');
