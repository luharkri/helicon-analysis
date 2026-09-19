import { useEffect, useState } from 'react';
type Job = { job_id: string; customer_id: string | null; good_quantity: number; scrap_quantity: number; scrap_rate: number | null; completed_at: string };
type Material = { material: string; good_quantity: number; scrap_quantity: number; scrap_rate: number | null; jobs: Job[] };
type Data = { as_of: string; materials: Material[]; excluded_jobs: number; multiple_completions: number; quality: Record<string, number> };
const rate = (n: number | null) => n === null ? 'N/A' : `${n.toFixed(1)}%`;
const date = (s: string) => new Date(s).toLocaleString('en-GB', { timeZone: 'UTC' }) + ' UTC';
export function MaterialsDashboard({ datasetId, initialSelection }: { datasetId: string; initialSelection?: string }) {
  const [data, setData] = useState<Data | null>(null);
  const [error, setError] = useState('');
  const [measure, setMeasure] = useState('units');
  const [selected, setSelected] = useState(initialSelection || '');
  useEffect(() => {
    const controller = new AbortController();
    fetch(`/api/datasets/${datasetId}/materials`, { signal: controller.signal }).then(async response => {
      const body = await response.json();
      if (!response.ok) throw new Error(body.detail || 'Could not load material data.');
      setData(body);
    }).catch(e => { if (e.name !== 'AbortError') setError(e.message); });
    return () => controller.abort();
  }, [datasetId]);
  if (error) return <section className="dashboard"><p role="alert">{error}</p></section>;
  if (!data) return <section className="dashboard" role="status">Loading material data…</section>;
  const value = (t: Material) => measure === 'good' ? t.good_quantity : measure === 'units' ? t.scrap_quantity : t.scrap_rate ?? 0;
  const tools = [...data.materials].sort((a, b) => value(b) - value(a) || a.material.localeCompare(b.material));
  const maximum = Math.max(...tools.map(value), 1);
  const tool = tools.find(t => t.material === selected);
  return <section className="dashboard"><p className="eyebrow">MATERIAL QUALITY</p><h2>Production quality by material</h2><p className="muted">Compare recorded good output and scrap across material types. Select a material to inspect completed jobs.</p><p className="muted">As of {date(data.as_of)}</p>
    <label className="dashboard-picker">Measure <select value={measure} onChange={e => setMeasure(e.target.value)}><option value="good">Good output units</option><option value="units">Scrap units</option><option value="rate">Scrap rate (%)</option></select></label>
    {!tools.length ? <p>No completed jobs with valid good and scrap quantities.</p> : <div className="bar-chart" aria-label="Output and scrap by material">{tools.map(t => <button key={t.material} className={`bar-row ${selected === t.material ? 'selected' : ''}`} aria-pressed={selected === t.material} onClick={() => setSelected(t.material)}><span className="bar-name">{t.material}<small>{t.jobs.length} completed jobs · {(t.good_quantity + t.scrap_quantity).toLocaleString()} total units</small></span><span className="bar-track"><span className="bar-fill blocked" style={{ width: `${value(t) / maximum * 100}%`, minWidth: value(t) ? 2 : 0 }} /></span><span className="bar-value">{measure === 'rate' ? rate(t.scrap_rate) : `${value(t).toLocaleString()} units`}<small>{measure === 'units' ? rate(t.scrap_rate) : `${t.scrap_quantity.toLocaleString()} scrap units`}</small></span></button>)}<div className="chart-axis"><span>0</span><span>{measure === 'good' ? 'Good output units' : measure === 'units' ? 'Scrap units' : 'Scrap rate (%)'} →</span><span>{maximum.toFixed(1)}</span></div></div>}
    <details className="quality-note"><summary>Calculation & data quality</summary><p>Scrap rate = summed scrap / summed (good + scrap). Zero output displays N/A. Each job uses its latest completion snapshot. Jobs are grouped by the single distinct material recorded across their history. Missing or conflicting materials are grouped under Unknown / ambiguous.</p><p>{data.excluded_jobs} completed jobs excluded for invalid or missing good/scrap quantities · {data.multiple_completions} jobs with multiple completion events (latest used) · {data.quality.duplicates} identical duplicates excluded · {data.quality.conflicts} conflicting duplicates (first imported record used) · {data.quality.invalid_records} invalid events excluded.</p></details>
    {tool && <section className="job-detail"><h3>{tool.material} · completed jobs</h3><div className="table-scroll"><table><thead><tr><th>Job</th><th>Customer</th><th>Good output</th><th>Scrap</th><th>Scrap rate</th><th>Completed</th></tr></thead><tbody>{tool.jobs.map(j => <tr key={j.job_id}><td>{j.job_id}</td><td>{j.customer_id || 'Unknown'}</td><td>{j.good_quantity.toLocaleString()}</td><td>{j.scrap_quantity.toLocaleString()}</td><td>{rate(j.scrap_rate)}</td><td>{date(j.completed_at)}</td></tr>)}</tbody></table></div></section>}
  </section>;
}
