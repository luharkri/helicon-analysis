import { useEffect, useState } from 'react';
type Job = { job_id: string; customer_id: string | null; good_quantity: number; scrap_quantity: number; scrap_rate: number | null; completed_at: string };
type Tool = { tool_id: string; good_quantity: number; scrap_quantity: number; scrap_rate: number | null; jobs: Job[] };
type Data = { as_of: string; tools: Tool[]; excluded_jobs: number; multiple_completions: number; quality: Record<string, number> };
const rate = (n: number | null) => n === null ? 'N/A' : `${n.toFixed(1)}%`;
const date = (s: string) => new Date(s).toLocaleString('en-GB', { timeZone: 'UTC' }) + ' UTC';
export function ToolScrapDashboard({ datasetId, initialSelection }: { datasetId: string; initialSelection?: string }) {
  const [data, setData] = useState<Data | null>(null);
  const [error, setError] = useState('');
  const [measure, setMeasure] = useState('units');
  const [selected, setSelected] = useState(initialSelection || '');
  useEffect(() => {
    const controller = new AbortController();
    fetch(`/api/datasets/${datasetId}/tool-scrap`, { signal: controller.signal }).then(async response => {
      const body = await response.json();
      if (!response.ok) throw new Error(body.detail || 'Could not load scrap data.');
      setData(body);
    }).catch(e => { if (e.name !== 'AbortError') setError(e.message); });
    return () => controller.abort();
  }, [datasetId]);
  if (error) return <section className="dashboard"><p role="alert">{error}</p></section>;
  if (!data) return <section className="dashboard" role="status">Loading scrap data…</section>;
  const value = (t: Tool) => measure === 'units' ? t.scrap_quantity : t.scrap_rate ?? 0;
  const tools = [...data.tools].sort((a, b) => value(b) - value(a) || a.tool_id.localeCompare(b.tool_id));
  const maximum = Math.max(...tools.map(value), 1);
  const tool = tools.find(t => t.tool_id === selected);
  return <section className="dashboard"><p className="eyebrow">TOOLING QUALITY</p><h2>Scrap associated with tool</h2><p className="muted">Recorded completion quantities grouped by inferred tool association. This does not establish that the tool caused the defects.</p><p className="muted">As of {date(data.as_of)}</p>
    <label className="dashboard-picker">Measure <select value={measure} onChange={e => setMeasure(e.target.value)}><option value="units">Scrap units</option><option value="rate">Scrap rate (%)</option></select></label>
    {!tools.length ? <p>No completed jobs with valid good and scrap quantities.</p> : <div className="bar-chart" aria-label="Scrap by associated tool">{tools.map(t => <button key={t.tool_id} className={`bar-row ${selected === t.tool_id ? 'selected' : ''}`} aria-pressed={selected === t.tool_id} onClick={() => setSelected(t.tool_id)}><span className="bar-name">{t.tool_id}<small>{t.jobs.length} completed jobs · {(t.good_quantity + t.scrap_quantity).toLocaleString()} total units</small></span><span className="bar-track"><span className="bar-fill blocked" style={{ width: `${value(t) / maximum * 100}%`, minWidth: value(t) ? 2 : 0 }} /></span><span className="bar-value">{measure === 'units' ? `${t.scrap_quantity.toLocaleString()} units` : rate(t.scrap_rate)}<small>{measure === 'units' ? rate(t.scrap_rate) : `${t.scrap_quantity.toLocaleString()} scrap units`}</small></span></button>)}<div className="chart-axis"><span>0</span><span>{measure === 'units' ? 'Scrap units' : 'Scrap rate (%)'} →</span><span>{maximum.toFixed(1)}</span></div></div>}
    <details className="quality-note"><summary>Calculation & data quality</summary><p>Scrap rate = summed scrap / summed (good + scrap). Zero output displays N/A. Each job uses its latest completion snapshot. A single distinct tool ID across the job’s history is inferred as its associated tool; absent or multiple IDs are Unknown / ambiguous.</p><p>{data.excluded_jobs} completed jobs excluded for invalid or missing good/scrap quantities · {data.multiple_completions} jobs with multiple completion events (latest used) · {data.quality.duplicates} identical duplicates excluded · {data.quality.conflicts} conflicting duplicates (first imported record used) · {data.quality.invalid_records} invalid events excluded.</p></details>
    {tool && <section className="job-detail"><h3>{tool.tool_id} · completed jobs</h3><div className="table-scroll"><table><thead><tr><th>Job</th><th>Customer</th><th>Good output</th><th>Scrap</th><th>Scrap rate</th><th>Completed</th></tr></thead><tbody>{tool.jobs.map(j => <tr key={j.job_id}><td>{j.job_id}</td><td>{j.customer_id || 'Unknown'}</td><td>{j.good_quantity.toLocaleString()}</td><td>{j.scrap_quantity.toLocaleString()}</td><td>{rate(j.scrap_rate)}</td><td>{date(j.completed_at)}</td></tr>)}</tbody></table></div></section>}
  </section>;
}
