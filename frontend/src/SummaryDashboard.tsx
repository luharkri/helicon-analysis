import { useEffect, useState } from 'react';
type Tab = 'Jobs' | 'Tooling' | 'Materials' | 'Parts' | 'Customer Shortfalls' | 'Run Size vs Scrap';
type Destination = { tab: Tab; entity: string; metric?: string };
type Job = { job_id: string; due_at: string | null; blocked_hours: number; blocker: { reason: string } };
type Part = { part_id: string; good_quantity: number; scrap_quantity: number; scrap_rate: number | null; jobs: unknown[] };
type Customer = { customer_id: string; shortfall: number; affected_jobs: number };
type Overview = { as_of: string; blocked_count: number; jobs: Job[]; quality: Record<string, number> };
type Data = { blocked: Overview; parts: { parts: Part[]; excluded_jobs: number }; customers: { customers: Customer[]; shortfall: number; affected_jobs: number; completed_jobs: number; excluded_jobs: number } };
const date = (s: string) => new Date(s).toLocaleString('en-GB', { timeZone: 'UTC' }) + ' UTC';
export function SummaryDashboard({ datasetId, onOpen }: { datasetId: string; onOpen: (item: Destination) => void }) {
  const [data, setData] = useState<Data | null>(null);
  const [error, setError] = useState('');
  useEffect(() => {
    const controller = new AbortController();
    async function load() {
      const [blocked, parts, customers] = await Promise.all(['production-overview', 'parts', 'good-output'].map(async endpoint => {
        const response = await fetch(`/api/datasets/${datasetId}/${endpoint}`, { signal: controller.signal });
        const body = await response.json();
        if (!response.ok) throw new Error(body.detail || 'Could not load overview.');
        return body;
      }));
      setData({ blocked, parts, customers });
    }
    load().catch(e => { if (e.name !== 'AbortError') setError(e.message); });
    return () => controller.abort();
  }, [datasetId]);
  if (error) return <section className="dashboard" role="alert">{error}</section>;
  if (!data) return <section className="dashboard" role="status">Loading production overview…</section>;
  const { blocked, parts, customers } = data;
  const overdue = blocked.jobs.filter(j => j.due_at && new Date(j.due_at) < new Date(blocked.as_of)).sort((a,b) => new Date(a.due_at!).getTime() - new Date(b.due_at!).getTime());
  const scrap = parts.parts.reduce((s,p) => s + p.scrap_quantity, 0);
  const output = parts.parts.reduce((s,p) => s + p.scrap_quantity + p.good_quantity, 0);
  const losses = parts.parts.filter(p => p.scrap_quantity > 0 && p.scrap_rate !== null).sort((a, b) => b.scrap_rate! - a.scrap_rate! || b.scrap_quantity - a.scrap_quantity).slice(0, 2);
  return <section className="dashboard">
    <p className="eyebrow">PRODUCTION OVERVIEW</p><h2>Production Summary</h2><p className="muted">As of {date(blocked.as_of)} · latest event in this dataset</p>
    <section className="stats" aria-label="Production overview"><div><span>Overdue and blocked</span><strong>{overdue.length}</strong><span>{blocked.blocked_count} unfinished jobs blocked in total</span></div><div><span>Recorded scrap</span><strong>{scrap.toLocaleString()}</strong><span>{output ? `${(scrap / output * 100).toFixed(2)}% of completed output` : 'No eligible completed output'}</span></div><div><span>Good-output shortfall</span><strong>{customers.shortfall.toLocaleString()}</strong><span>{customers.affected_jobs} / {customers.completed_jobs} eligible completed jobs below target</span></div></section>
    <h3>Overdue Blocked Jobs</h3><p className="muted">Unresolved blockers, earliest due date first.</p>
    {overdue.length ? overdue.slice(0, 3).map(job => <article className="overview-finding" key={job.job_id}><p className="eyebrow">DELIVERY RISK</p><h3>{job.job_id} is overdue with an unresolved {job.blocker.reason.replaceAll('_', ' ')} block.</h3><p>Due {date(job.due_at!)} · blocked for {job.blocked_hours.toFixed(1)} hours.</p><p className="muted">No later recorded unblock or completion clears the current block. Inspect the history to determine the next action.</p><button className="job-link" onClick={() => onOpen({ tab: 'Jobs', entity: job.job_id })}>Inspect job →</button></article>) : <p>No unfinished jobs are both overdue and recorded as blocked.</p>}
    {overdue.length > 3 && <p className="muted">Showing 3 of {overdue.length} overdue blocked jobs.</p>}
    <h3>Highest Scrap Rate by Part</h3><p className="muted">Top two parts by scrap rate, with scrap units and completed-job counts.</p>
    {losses.length ? losses.map(part => <article className="overview-finding" key={part.part_id}><p className="eyebrow">OUTPUT LOSS</p><h3>{part.part_id} · {part.scrap_rate?.toFixed(2)}% scrap</h3><p>{part.scrap_quantity.toLocaleString()} scrap units · {part.jobs.length} completed jobs.</p><p className="muted">Based on each job’s latest completion snapshot. Review the jobs to investigate where losses occurred; the part itself is not an established cause.</p><button className="job-link" onClick={() => onOpen({ tab: 'Parts', entity: part.part_id })}>Review part output →</button></article>) : <p>No scrap recorded in eligible completed jobs.</p>}
    <details className="quality-note"><summary>Customer shortfalls · separate from scrap</summary><p>Shortfalls compare original targets with good output. They can overlap with scrap losses and must not be added to them. Shipments and replacement production are not established here.</p>{customers.customers.filter(c => c.shortfall > 0).slice(0,3).map(c => <p key={c.customer_id}><button className="job-link" onClick={() => onOpen({ tab: 'Customer Shortfalls', entity: c.customer_id })}>{c.customer_id} →</button> · {c.shortfall.toLocaleString()} shortfall units across {c.affected_jobs} jobs below target</p>)}</details>
    <h3>Run Size vs Scrap Analysis</h3><p className="muted">Peer-based anomaly detection is not yet validated. The existing run-size plot compares pooled jobs; it is an exploratory view, not evidence that a job is unusual for its part.</p><button className="job-link" onClick={() => onOpen({ tab: 'Run Size vs Scrap', entity: '' })}>Explore run size vs scrap →</button>
    <details className="quality-note"><summary>Evidence & data coverage</summary><p>Delivery findings use recorded job blocks and completions. No numerical priority score is applied. Parts rank by scrap rate; small samples can produce unstable rates.</p><p>{parts.excluded_jobs} completed jobs excluded from scrap metrics; {customers.excluded_jobs} excluded from shortfall metrics because required quantities are invalid or missing. {blocked.quality.jobs_without_due_date} blocked jobs lack a valid due date and cannot be classified as overdue.</p><p>{blocked.quality.duplicates} identical duplicates excluded · {blocked.quality.conflicts} conflicting duplicates (first imported record used) · {blocked.quality.invalid_records} invalid events excluded.</p></details>
  </section>;
}
