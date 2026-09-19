import { useEffect, useState } from 'react';
import { fitTrend } from './runTrend';
type Point = { job_id: string; quantity: number; scrap: number; rate: number; part_id: string; material: string; facility: string };
type Data = { as_of: string; points: Point[]; excluded_jobs: number; quality: Record<string, number> };
export function RunSizeDashboard({ datasetId, initialJobId }: { datasetId: string; initialJobId?: string }) {
  const [data, setData] = useState<Data | null>(null);
  const [error, setError] = useState('');
  const [filters, setFilters] = useState({ part_id: '', material: '', facility: '' });
  const [selected, setSelected] = useState<Point | null>(null);
  useEffect(() => {
    const controller = new AbortController();
    fetch(`/api/datasets/${datasetId}/run-size`, { signal: controller.signal }).then(async r => { const body = await r.json(); if (!r.ok) throw new Error(body.detail || 'Could not load analysis.'); setData(body); }).catch(e => { if (e.name !== 'AbortError') setError(e.message); });
    return () => controller.abort();
  }, [datasetId]);
  useEffect(() => {
    if (data && initialJobId) {
      setFilters({ part_id: '', material: '', facility: '' });
      setSelected(data.points.find(p => p.job_id === initialJobId) || null);
    }
  }, [data, initialJobId]);
  if (error) return <section className="dashboard" role="alert">{error}</section>;
  if (!data) return <section className="dashboard" role="status">Loading run-size analysis…</section>;
  const rows = data.points.filter(p => (Object.keys(filters) as (keyof typeof filters)[]).every(k => !filters[k] || filters[k] === p[k]));
  const trend = fitTrend(rows);
  const outliers = new Set(trend?.outliers || []);
  const maxX = Math.max(1, ...rows.map(p => p.quantity));
  const maxY = Math.max(1, ...rows.map(p => p.rate)) * 1.1;
  const bands = [{ name: 'Small', label: '1–199 units', rows: rows.filter(p => p.quantity < 200) }, { name: 'Medium', label: '200–399 units', rows: rows.filter(p => p.quantity >= 200 && p.quantity < 400) }, { name: 'Large', label: '400+ units', rows: rows.filter(p => p.quantity >= 400) }];
  return <section className="dashboard"><p className="eyebrow">EXPLORATORY ANALYSIS</p><h2>Run Size vs Scrap</h2><p className="muted">One point per completed job. Run size = recorded good + scrap units; jobs are a proxy for runs, not elapsed production time.</p><p className="muted">As of {new Date(data.as_of).toLocaleString('en-GB', { timeZone: 'UTC' })} UTC</p>
    <div className="run-filters">{(['part_id', 'material', 'facility'] as const).map(k => <label className="dashboard-picker" key={k}>{k === 'part_id' ? 'Part' : k === 'material' ? 'Material' : 'Facility'}<select value={filters[k]} onChange={e => { setFilters({ ...filters, [k]: e.target.value }); setSelected(null); }}><option value="">All</option>{[...new Set(data.points.map(p => p[k]))].sort().map(value => <option key={value} value={value}>{value}</option>)}</select></label>)}</div>
    <p className="muted">{rows.length} completed jobs · filter to comparable parts before interpreting differences.</p>
    {!rows.length ? <p>No eligible completed jobs match these filters.</p> : <>
      <p className="muted">Green: within threshold · Orange: outlier · Dark line: fitted linear trend. {trend ? `${outliers.size} outlier(s) among ${rows.length} jobs.` : 'Trend requires at least 5 jobs with varying run quantities.'}</p>
      <svg viewBox="0 0 800 390" className="run-scatter" role="group" aria-label="Scatter plot of run quantity versus scrap percentage">
        {[0, 1, 2, 3, 4].map(i => <g key={i}><line x1="65" x2="770" y1={330 - i * 75} y2={330 - i * 75} stroke="#e0e7e1" /><text x="55" y={334 - i * 75} textAnchor="end">{(maxY * i / 4).toFixed(1)}%</text><text x={65 + i * 176.25} y="350" textAnchor="middle">{Math.round(maxX * i / 4)}</text></g>)}
        <text x="415" y="378" textAnchor="middle">Run quantity (good + scrap units)</text><text x="65" y="18">Scrap rate</text>
        {trend && <line x1={65 + trend.x1 / maxX * 705} y1={330 - Math.max(0, Math.min(maxY, trend.y1)) / maxY * 300} x2={65 + trend.x2 / maxX * 705} y2={330 - Math.max(0, Math.min(maxY, trend.y2)) / maxY * 300} stroke="#243c39" strokeWidth="2" strokeDasharray="6 4"><title>Ordinary least squares trend</title></line>}
        {rows.map(p => <circle key={p.job_id} cx={65 + p.quantity / maxX * 705} cy={330 - p.rate / maxY * 300} r={selected?.job_id === p.job_id ? 7 : 5} stroke={selected?.job_id === p.job_id ? '#111' : 'white'} strokeWidth={selected?.job_id === p.job_id ? 2 : 1} fill={outliers.has(p.job_id) ? '#d56a21' : '#397b65'} opacity="0.75" tabIndex={0} role="button" aria-label={`${p.job_id}: ${p.quantity} units, ${p.rate.toFixed(2)} percent scrap${outliers.has(p.job_id) ? ", outlier" : ""}`} onClick={() => setSelected(p)} onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setSelected(p); } }}><title>{p.job_id}: {p.quantity} units, {p.rate.toFixed(2)}% scrap</title></circle>)}
      </svg>
      {selected && <p role="status"><strong>{selected.job_id}{outliers.has(selected.job_id) ? ' · Outlier' : ''}</strong> · {selected.part_id} · {selected.material} · {selected.facility} · {selected.quantity} units · {selected.scrap} scrap · {selected.rate.toFixed(2)}%</p>}
      <h3>Run-size comparison</h3><div className="table-scroll"><table><thead><tr><th>Group</th><th>Jobs</th><th>Total output</th><th>Scrap units</th><th>Pooled scrap rate</th></tr></thead><tbody>{bands.map(b => { const quantity = b.rows.reduce((s, p) => s + p.quantity, 0); const scrap = b.rows.reduce((s, p) => s + p.scrap, 0); return <tr key={b.name}><td>{b.name} · {b.label}</td><td>{b.rows.length}</td><td>{quantity.toLocaleString()}</td><td>{scrap.toLocaleString()}</td><td>{quantity ? `${(scrap / quantity * 100).toFixed(2)}%` : 'N/A'}</td></tr>; })}</tbody></table></div>
    </>}
    <p className="muted">Group rates use total scrap ÷ total output, not an average of job percentages. Bands are fixed descriptive ranges. Differences may reflect product mix; the fitted line is descriptive and does not establish a run-size effect or estimate setup losses. Outliers have residuals greater than 3 residual standard deviations from an unweighted least-squares line fitted to the filtered jobs. This assumes roughly constant residual variation; small batches and product mix can affect flags. Zero residual variation produces no flags.</p>
    <details className="quality-note"><summary>Calculation & data quality</summary><p>Latest completion snapshot per job. Zero-output jobs and invalid/missing good or scrap quantities are excluded ({data.excluded_jobs} jobs). Missing or conflicting part/material/facility assignments appear as Unknown / ambiguous.</p><p>{data.quality.duplicates} duplicate records excluded · {data.quality.conflicts} conflicting duplicates (first imported record used) · {data.quality.invalid_records} invalid events excluded.</p></details>
  </section>;
}
