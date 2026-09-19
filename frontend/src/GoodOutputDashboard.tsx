import { useEffect, useState } from 'react';
type Job = { job_id: string; target_quantity: number; good_quantity: number; scrap_quantity: number | null; shortfall: number; completed_at: string };
type Customer = { customer_id: string; target_quantity: number; shortfall: number; shortfall_percent: number | null; affected_jobs: number; completed_jobs: number; jobs: Job[] };
type Overview = { as_of: string; customers: Customer[]; shortfall: number; shortfall_percent: number | null; affected_jobs: number; completed_jobs: number; excluded_jobs: number; multiple_completions: number; quality: Record<string, number> };
const percent = (value: number | null) => value === null ? 'N/A' : `${value.toFixed(1)}%`;
const date = (value: string) => new Date(value).toLocaleString('en-GB', { timeZone: 'UTC' }) + ' UTC';
export function GoodOutputDashboard({ datasetId, initialSelection }: { datasetId: string; initialSelection?: string }) {
  const [data, setData] = useState<Overview | null>(null);
  const [error, setError] = useState('');
  const [selected, setSelected] = useState(initialSelection || '');
  useEffect(() => {
    const controller = new AbortController();
    async function load() {
      try {
        const response = await fetch(`/api/datasets/${datasetId}/good-output`, { signal: controller.signal });
        const body = await response.json();
        if (!response.ok) throw new Error(body.detail || 'Could not load good output.');
        setData(body);
      } catch (e) { if (e instanceof Error && e.name !== 'AbortError') setError(e.message); }
    }
    load();
    return () => controller.abort();
  }, [datasetId]);
  if (error) return <section className="dashboard"><h2>Good-output shortfall</h2><p role="alert">{error}</p></section>;
  if (!data) return <section className="dashboard" role="status">Loading good output…</section>;
  const customer = data.customers.find(c => c.customer_id === selected);
  const maximum = data.customers[0]?.shortfall || 1;
  return <section className="dashboard">
    <p className="eyebrow">CUSTOMER FOLLOW-UP</p><h2>Customer Shortfalls</h2>
    <p className="muted">Recorded good-output shortfall by customer · as of {date(data.as_of)}</p>
    <p className="muted">Compare recorded good output with each job’s original target. Shipment fulfillment and replacement production are not established by these events.</p>
    <section className="stats" aria-label="Good-output summary"><div><span>Shortfall units</span><strong>{data.shortfall.toLocaleString()}</strong></div><div><span>Shortfall / target</span><strong>{percent(data.shortfall_percent)}</strong></div><div><span>Completed jobs below target</span><strong>{data.affected_jobs} / {data.completed_jobs}</strong></div></section>
    {data.completed_jobs === 0 ? <p className="empty-chart">No completed jobs with valid target and good quantities.</p> : data.affected_jobs === 0 ? <p className="empty-chart">No recorded good-output shortfalls among eligible completed jobs.</p> : <>
      <p className="muted">Select a customer to inspect jobs below target. Percentages use targets across all eligible completed jobs for that customer.</p>
      <div className="bar-chart" aria-label="Customer shortfall in units">{data.customers.map(c => <button key={c.customer_id} className={`bar-row ${selected === c.customer_id ? 'selected' : ''}`} aria-pressed={selected === c.customer_id} onClick={() => setSelected(c.customer_id)}>
        <span className="bar-name">{c.customer_id}<small>{c.affected_jobs} / {c.completed_jobs} jobs below target</small></span><span className="bar-track"><span className="bar-fill blocked" style={{ width: `${c.shortfall / maximum * 100}%`, minWidth: c.shortfall ? 2 : 0 }} /></span><span className="bar-value">{c.shortfall.toLocaleString()} units<small>{percent(c.shortfall_percent)} of target</small></span>
      </button>)}<div className="chart-axis"><span>0</span><span>Shortfall units →</span><span>{maximum.toLocaleString()}</span></div></div>
    </>}
    <details className="quality-note"><summary>Calculation & data quality</summary><p>For each completed job: max(original target − recorded good quantity, 0). Customer totals add these shortfalls; excess output on one job cannot offset another. The latest completion event supplies good and scrap quantities; completion snapshots are not summed. Missing scrap is shown as unknown.</p><p>{data.excluded_jobs} completed jobs excluded for missing or invalid target/good quantities · {data.multiple_completions} jobs with multiple completion events (latest used) · {data.quality.duplicates} identical duplicates excluded · {data.quality.conflicts} conflicting duplicates (first imported record used) · {data.quality.invalid_records} invalid events excluded.</p></details>
    {customer && <section className="job-detail"><h3>{customer.customer_id} · jobs below target</h3>{customer.jobs.length ? <div className="table-scroll"><table><thead><tr><th>Job</th><th>Target</th><th>Good output</th><th>Scrap</th><th>Shortfall</th><th>Completed</th></tr></thead><tbody>{customer.jobs.map(job => <tr key={job.job_id}><td>{job.job_id}</td><td>{job.target_quantity.toLocaleString()}</td><td>{job.good_quantity.toLocaleString()}</td><td>{job.scrap_quantity?.toLocaleString() ?? 'Unknown'}</td><td>{job.shortfall.toLocaleString()}</td><td>{date(job.completed_at)}</td></tr>)}</tbody></table></div> : <p>No jobs below target for this customer.</p>}</section>}
  </section>;
}
