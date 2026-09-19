import { useEffect, useState } from 'react';

type Job = { job_id: string; customer_id: string | null; due_at: string | null; target_quantity: number | null; last_activity: string; blocked_hours: number; blocker: { reason: string; since: string } | null };
type Overview = { as_of: string; blocked_count: number; jobs: Job[]; quality: Record<string, number> };
type Detail = { job: Job & { timeline: { event_id: string; timestamp: string; event_type: string; machine_id: string | null; quantity: number; metadata: unknown; row_number: number }[] } };
const date = (value: string | null) => value ? new Date(value).toLocaleString('en-GB', { timeZone: 'UTC' }) + ' UTC' : 'Unknown';
async function get<T>(url: string, signal: AbortSignal): Promise<T> {
  const response = await fetch(url, { signal });
  const body = await response.json();
  if (!response.ok) throw new Error(body.detail || 'Could not load dashboard.');
  return body;
}
export function BlockedDashboard({ datasetId, initialSelection }: { datasetId: string; initialSelection?: string }) {
  const [overview, setOverview] = useState<Overview | null>(null);
  const [selected, setSelected] = useState(initialSelection || '');
  const [detail, setDetail] = useState<Detail | null>(null);
  const [error, setError] = useState('');
  const [detailError, setDetailError] = useState('');
  useEffect(() => {
    const controller = new AbortController();
    get<Overview>(`/api/datasets/${datasetId}/blocked`, controller.signal).then(setOverview).catch(e => { if (e.name !== 'AbortError') setError(e.message); });
    return () => controller.abort();
  }, [datasetId]);
  useEffect(() => {
    if (!selected) return;
    const controller = new AbortController();
    setDetail(null); setDetailError('');
    get<Detail>(`/api/datasets/${datasetId}/jobs/${encodeURIComponent(selected)}`, controller.signal).then(setDetail).catch(e => { if (e.name !== 'AbortError') setDetailError(e.message); });
    return () => controller.abort();
  }, [datasetId, selected]);
  if (error) return <section className="dashboard"><h2>Blocked jobs</h2><p role="status">{error}</p><p className="muted">You can still browse the original records below.</p></section>;
  if (!overview) return <section className="dashboard" role="status">Loading blocked jobs…</section>;
  const maximum = overview.jobs[0]?.blocked_hours || 1;
  return <section className="dashboard" aria-label="Blocked jobs dashboard">
    <div className="dashboard-heading"><div><p className="eyebrow">PRODUCTION FOLLOW-UP</p><h2>Blocked Jobs</h2><p className="muted">As of {date(overview.as_of)} · latest event in this dataset</p></div><div className="blocked-count"><strong>{overview.blocked_count}</strong><span>unfinished blocked jobs</span></div></div>
    <p className="muted">Top {overview.jobs.length} by hours blocked. Only unfinished jobs with unresolved recorded blockers are included, regardless of due date. Select a bar to inspect the evidence.</p>
    <div className="chart-legend"><span className="blocked-label">● Unresolved recorded blocker</span></div>
    {overview.jobs.length ? <div className="bar-chart" aria-label="Jobs ranked by hours blocked">{overview.jobs.map(job => <button key={job.job_id} className={`bar-row ${selected === job.job_id ? 'selected' : ''}`} aria-pressed={selected === job.job_id} onClick={() => setSelected(job.job_id)} aria-label={`${job.job_id}, ${job.blocked_hours.toFixed(1)} hours blocked, ${job.blocker ? job.blocker.reason : 'no unresolved recorded blocker'}`}>
      <span className="bar-name">{job.job_id}<small>{job.customer_id || 'Unknown customer'}</small></span><span className="bar-track"><span className={`bar-fill ${job.blocker ? 'blocked' : ''}`} style={{ width: `${job.blocked_hours / maximum * 100}%` }} /></span><span className="bar-value">{job.blocked_hours.toFixed(1)} h<small>{job.blocker?.reason.replaceAll('_', ' ') || 'No recorded blocker'}</small></span>
    </button>)}<div className="chart-axis"><span>0 h</span><span>Hours in current block →</span><span>{maximum.toFixed(1)} h</span></div></div> : <p className="empty-chart">No unfinished jobs have unresolved recorded blockers at this dataset’s latest timestamp.</p>}
    <details className="quality-note"><summary>How this is calculated & data quality</summary><p>Events are ordered by timestamp, then source record. For repeated event IDs, the first imported record is used. A recorded block stays unresolved until an unblock or completion event; later production activity alone does not clear it. Duration starts at the first block since the last resolution; repeated block events update the reason without resetting the clock.</p><p>{overview.quality.duplicates} identical duplicates excluded · {overview.quality.conflicts} conflicting duplicates (first record used) · {overview.quality.invalid_records} invalid records excluded · {overview.quality.jobs_without_due_date} blocked jobs without a valid due date (included).</p></details>
    {selected && <section className="job-detail" aria-label="Selected job evidence" aria-live="polite"><h3>{selected} · job evidence</h3>{detailError ? <p role="alert">{detailError}</p> : !detail ? <p>Loading timeline…</p> : <>
      <dl className="job-facts"><div><dt>Customer</dt><dd>{detail.job.customer_id || 'Unknown'}</dd></div><div><dt>Due date</dt><dd>{date(detail.job.due_at)}</dd></div><div><dt>Target quantity</dt><dd>{detail.job.target_quantity ?? 'Unknown'}</dd></div><div><dt>Last activity</dt><dd>{date(detail.job.last_activity)}</dd></div><div><dt>Recorded blocker</dt><dd>{detail.job.blocker ? `${detail.job.blocker.reason.replaceAll('_', ' ')} · since ${date(detail.job.blocker.since)}` : 'No unresolved recorded blocker'}</dd></div></dl>
      <h4>Event timeline · {detail.job.timeline.length} events</h4><ol className="event-timeline">{detail.job.timeline.map(event => <li key={event.event_id}><time>{date(event.timestamp)}</time><strong>{event.event_type.replaceAll('_', ' ')}</strong><span>{event.machine_id || 'No machine recorded'} · quantity {event.quantity ?? 'unknown'}</span><details><summary>Event details · record {event.row_number}</summary><pre>{JSON.stringify(event, null, 2)}</pre></details></li>)}</ol>
    </>}</section>}
  </section>;
}
