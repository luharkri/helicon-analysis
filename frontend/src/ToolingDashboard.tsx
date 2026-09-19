import { useEffect, useState } from 'react';
import { ToolScrapDashboard } from './ToolScrapDashboard';
type Interval = { job_id: string; customer_id: string | null; start: string; end: string; status: string; hours: number };
type Tool = { tool_id: string; job_hours: number; job_count: number; intervals: Interval[] };
type Overview = { as_of: string; tools: Tool[]; quality: Record<string, number> };
type Timeline = { job: { timeline: { event_id: string; timestamp: string; event_type: string; metadata: unknown }[] } };
const date = (value: string) => new Date(value).toLocaleString('en-GB', { timeZone: 'UTC' }) + ' UTC';
async function get<T>(url: string, signal: AbortSignal): Promise<T> {
  const response = await fetch(url, { signal });
  const body = await response.json();
  if (!response.ok) throw new Error(body.detail || 'Could not load tooling delays.');
  return body;
}
export function ToolingDashboard({ datasetId, initialSelection, initialMetric }: { datasetId: string; initialSelection?: string; initialMetric?: string }) {
  const [metric, setMetric] = useState(initialMetric || 'delays');
  return <><label className="dashboard-picker">Metric <select value={metric} onChange={e => setMetric(e.target.value)}><option value="delays">Tool delays</option><option value="scrap">Scrap by tool</option></select></label>{metric === 'delays' ? <ToolDelaysDashboard datasetId={datasetId} initialSelection={initialSelection} /> : <ToolScrapDashboard datasetId={datasetId} initialSelection={initialSelection} />}</>;
}
function ToolDelaysDashboard({ datasetId, initialSelection, initialMetric }: { datasetId: string; initialSelection?: string; initialMetric?: string }) {
  const [scope, setScope] = useState('unresolved');
  const [data, setData] = useState<Overview | null>(null);
  const [toolId, setToolId] = useState('');
  const [jobId, setJobId] = useState('');
  const [timeline, setTimeline] = useState<Timeline | null>(null);
  const [error, setError] = useState('');
  const [jobError, setJobError] = useState('');
  useEffect(() => {
    const controller = new AbortController();
    setData(null); setError(''); setToolId(initialSelection || ''); setJobId('');
    get<Overview>(`/api/datasets/${datasetId}/tooling?scope=${scope}`, controller.signal).then(setData).catch(e => { if (e.name !== 'AbortError') setError(e.message); });
    return () => controller.abort();
  }, [datasetId, scope]);
  useEffect(() => {
    setTimeline(null); setJobError('');
    if (!jobId) return;
    const controller = new AbortController();
    get<Timeline>(`/api/datasets/${datasetId}/jobs/${encodeURIComponent(jobId)}`, controller.signal).then(setTimeline).catch(e => { if (e.name !== 'AbortError') setJobError(e.message); });
    return () => controller.abort();
  }, [datasetId, jobId]);
  const selected = data?.tools.find(tool => tool.tool_id === toolId);
  const maximum = data?.tools[0]?.job_hours || 1;
  return <section className="dashboard">
    <p className="eyebrow">TOOLING FOLLOW-UP</p><h2>Tooling Delays</h2>
    <p className="muted">Missing-tool job-delay hours by inferred associated tool. Overlapping job delays count separately; this does not measure physical tool downtime.</p>
    <label className="dashboard-picker">Show <select value={scope} onChange={e => setScope(e.target.value)}><option value="unresolved">Unresolved delays</option><option value="all">All recorded delays</option></select></label>
    {error ? <p role="alert">{error}</p> : !data ? <p role="status">Loading tooling delays…</p> : <>
      <p className="muted">As of {date(data.as_of)} · latest event in this dataset</p>
      {data.tools.length ? <div className="bar-chart" aria-label="Tools ranked by missing-tool job-delay hours">{data.tools.map(tool => <button key={tool.tool_id} className={`bar-row ${toolId === tool.tool_id ? 'selected' : ''}`} aria-pressed={toolId === tool.tool_id} onClick={() => { setToolId(tool.tool_id); setJobId(''); }}>
        <span className="bar-name">{tool.tool_id}<small>{tool.job_count} affected jobs</small></span><span className="bar-track"><span className="bar-fill blocked" style={{ width: `${tool.job_hours / maximum * 100}%` }} /></span><span className="bar-value">{tool.job_hours.toFixed(1)} job-hours</span>
      </button>)}<div className="chart-axis"><span>0</span><span>Job-delay hours →</span><span>{maximum.toFixed(1)}</span></div></div> : <p className="empty-chart">No {scope === 'unresolved' ? 'unresolved ' : ''}missing-tool delays recorded.</p>}
      <details className="quality-note"><summary>Association rules & data quality</summary><p>A tool is inferred only when a job’s events reference exactly one distinct tool ID. Missing or multiple IDs are grouped under Unknown / ambiguous. Missing-tool intervals end at unblock, completion, or a recorded change to another blocking reason. Repeated missing-tool events do not reset the clock. Open intervals end at the displayed as-of time.</p><p>{data.quality.duplicates} identical duplicates excluded · {data.quality.conflicts} conflicting duplicates (first imported record used) · {data.quality.invalid_records} invalid records excluded.</p></details>
      {selected && <section className="job-detail"><h3>{selected.tool_id} · affected jobs</h3><div className="table-scroll"><table><thead><tr><th>Job</th><th>Customer</th><th>Blocked since</th><th>End / as of</th><th>Status</th><th>Job-hours</th></tr></thead><tbody>{selected.intervals.map((interval, i) => <tr key={i}><td><button className="job-link" onClick={() => setJobId(interval.job_id)}>{interval.job_id}</button></td><td>{interval.customer_id || 'Unknown'}</td><td>{date(interval.start)}</td><td>{date(interval.end)}</td><td>{interval.status}</td><td>{interval.hours.toFixed(1)}</td></tr>)}</tbody></table></div></section>}
      {jobId && <section className="job-detail" aria-live="polite"><h3>{jobId} · event timeline</h3>{jobError ? <p role="alert">{jobError}</p> : !timeline ? <p>Loading timeline…</p> : <ol className="event-timeline">{timeline.job.timeline.map(event => <li key={event.event_id}><time>{date(event.timestamp)}</time><strong>{event.event_type.replaceAll('_', ' ')}</strong><details><summary>Event evidence</summary><pre>{JSON.stringify(event, null, 2)}</pre></details></li>)}</ol>}</section>}
    </>}
  </section>;
}
