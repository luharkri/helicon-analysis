import { useEffect, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import './style.css';
import { GoodOutputDashboard } from './GoodOutputDashboard';
import { SummaryDashboard } from './SummaryDashboard';
import { RunSizeDashboard } from './RunSizeDashboard';
import { PartsDashboard } from './PartsDashboard';
import { MaterialsDashboard } from './MaterialsDashboard';
import { ToolingDashboard } from './ToolingDashboard';
import { BlockedDashboard } from './BlockedDashboard';

type Dataset = { id: string; name: string; columns: string[]; row_count: number; created_at: string };
type Page = { dataset: Dataset; rows: { row_number: number; data: Record<string, unknown> }[] };
function renderValue(value: unknown) {
  if (value === undefined) return <span className="muted">—</span>;
  if (value === null) return <span className="muted">null</span>;
  if (typeof value === 'object') return <details className="json-value"><summary>View JSON</summary><pre>{JSON.stringify(value, null, 2)}</pre></details>;
  return String(value);
}
async function api<T>(url: string, options?: RequestInit): Promise<T> {
  const response = await fetch(url, options);
  if (!response.ok) {
    const body = await response.json().catch(() => ({}));
    throw new Error(typeof body.detail === 'string' ? body.detail : `Request failed (${response.status}).`);
  }
  return response.json();
}

function App() {
  const [tab, setTab] = useState<'Jobs' | 'Tooling' | 'Customer Shortfalls' | 'Materials' | 'Parts' | 'Run Size vs Scrap' | 'Summary' | 'Data'>('Data');
  const [outlierLink, setOutlierLink] = useState<{ datasetId: string; jobId: string } | null>(null);
  const [finding, setFinding] = useState<{ datasetId: string; entity: string; metric?: string } | null>(null);
  const [datasets, setDatasets] = useState<Dataset[]>([]);
  const [selected, setSelected] = useState('');
  const [page, setPage] = useState<Page | null>(null);
  const [offset, setOffset] = useState(0);
  const [error, setError] = useState('');
  const [deleting, setDeleting] = useState(false);
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(true);
  const [message, setMessage] = useState('');
  const input = useRef<HTMLInputElement>(null);
  async function refresh() {
    const items = await api<Dataset[]>('/api/datasets');
    setDatasets(items);
    setSelected(current => current || items[0]?.id || '');
    if (!items.length) setTab('Data');
  }
  useEffect(() => { refresh().catch(e => setError(e.message)).finally(() => setLoading(false)); }, []);
  useEffect(() => {
    if (!selected || tab !== 'Data') return;
    const controller = new AbortController();
    setPage(null);
    api<Page>(`/api/datasets/${selected}/rows?offset=${offset}`, { signal: controller.signal })
      .then(setPage).catch(e => { if (e.name !== 'AbortError') setError(e.message); });
    return () => controller.abort();
  }, [selected, offset, tab]);
  async function upload(file?: File) {
    if (!file) return;
    setError(''); setMessage('');
    if (file.size > 10 * 1024 * 1024) { setError('Choose a file no larger than 10 MB.'); return; }
    setBusy(true);
    try {
      const dataset = await api<Dataset>('/api/datasets', {
        method: 'POST', headers: { 'Content-Type': /\.csv$/i.test(file.name) ? 'text/csv' : 'application/x-ndjson', 'X-File-Name': encodeURIComponent(file.name), 'X-Helicon-Request': '1' }, body: file,
      });
      setDatasets(current => [dataset, ...current]); setSelected(dataset.id); setOffset(0); setTab('Jobs');
      setMessage(`Imported ${dataset.row_count.toLocaleString()} rows. Your dataset is saved.`);
    } catch (e) { setError(e instanceof Error ? e.message : 'Upload failed. Try again.'); }
    finally { setBusy(false); if (input.current) input.current.value = ''; }
  }
  async function deleteDataset(dataset: Dataset) {
    if (!window.confirm(`Delete "${dataset.name}" and its ${dataset.row_count.toLocaleString()} records? This removes its dashboard data and cannot be undone. Your original file is not deleted.`)) return;
    setDeleting(true); setError(''); setMessage('');
    try {
      await api(`/api/datasets/${dataset.id}`, { method: 'DELETE', headers: { 'X-Helicon-Request': '1' } });
      setDatasets(current => current.filter(d => d.id !== dataset.id));
      setSelected(current => current === dataset.id ? '' : current);
      setPage(current => current?.dataset.id === dataset.id ? null : current);
      setOffset(0);
      setMessage(`Deleted ${dataset.name} and its records.`);
    } catch (e) { setError(e instanceof Error ? e.message : 'Delete failed. Try again.'); }
    finally { setDeleting(false); }
  }
  const total = datasets.reduce((sum, d) => sum + d.row_count, 0);
  return <div className="shell">
    <header><a className="brand" href="/"><span className="mark">H</span> helicon<span className="brand-divider">/</span><span className="subbrand">event explorer</span></a><span className="badge">Connected preview · v0.3</span></header>
    <main>
      <div className="intro"><div><h1>Production Log Analysis</h1><p className="lede">Import a log, explore its records, and build from what the data tells you.</p></div><span className="private">● Password protected</span></div>
      {error && <div className="notice error" role="alert">{error} <button onClick={() => window.location.reload()}>Reload</button></div>}
      {message && <div className="notice success" role="status">{message}</div>}
      <label className="dashboard-picker">Dashboard dataset <select disabled={deleting} value={selected} onChange={e => { setSelected(e.target.value); setOffset(0); }}>{!selected && <option value="">Select a dataset</option>}{datasets.map(d => <option key={d.id} value={d.id}>{d.name}</option>)}</select></label>
      <nav className="workspace-tabs" aria-label="Workspace views">{(['Data', 'Summary', 'Jobs', 'Tooling', 'Materials', 'Parts', 'Customer Shortfalls', 'Run Size vs Scrap'] as const).map(name => <button key={name} className={name === 'Data' ? 'data-tab' : undefined} aria-current={tab === name ? 'page' : undefined} onClick={() => setTab(name)}>{name}</button>)}</nav>
      {tab === 'Jobs' && selected && <BlockedDashboard key={selected} initialSelection={finding?.datasetId === selected ? finding.entity : undefined} datasetId={selected} />}
      {tab === 'Customer Shortfalls' && selected && <GoodOutputDashboard key={selected} initialSelection={finding?.datasetId === selected ? finding.entity : undefined} datasetId={selected} />}
      {tab === 'Summary' && selected && <SummaryDashboard key={selected} datasetId={selected} onOpen={item => { setFinding({ datasetId: selected, entity: item.entity, metric: item.metric }); setOutlierLink({ datasetId: selected, jobId: item.entity }); setTab(item.tab); }} />}
      {tab === 'Run Size vs Scrap' && selected && <RunSizeDashboard key={selected} datasetId={selected} initialJobId={outlierLink?.datasetId === selected ? outlierLink.jobId : undefined} />}
      {tab === 'Parts' && selected && <PartsDashboard key={selected} initialSelection={finding?.datasetId === selected ? finding.entity : undefined} datasetId={selected} />}
      {tab === 'Materials' && selected && <MaterialsDashboard key={selected} initialSelection={finding?.datasetId === selected ? finding.entity : undefined} datasetId={selected} />}
      {tab === 'Tooling' && selected && <ToolingDashboard key={selected} initialSelection={finding?.datasetId === selected ? finding.entity : undefined} initialMetric={finding?.metric} datasetId={selected} />}
      {tab !== 'Data' && !selected && <p role="status">{loading ? 'Loading datasets…' : 'Upload a dataset in the Data tab to get started.'}</p>}
      {tab === 'Data' && <>
      <section className="stats" aria-label="Dataset summary"><div><span>Datasets</span><strong>{datasets.length}</strong></div><div><span>Stored records</span><strong>{total.toLocaleString()}</strong></div><div><span>Workspace</span><strong className="small">Production follow-up</strong><span>Blocked jobs and their event histories</span></div></section>
      <section className="upload"><div className="upload-symbol" aria-hidden="true">↑</div><div className="upload-copy"><h2>Bring in a dataset</h2><p>UTF-8 JSONL (one object per line) or CSV with headers · up to 10 MB / 100,000 records</p><a href="/api/sample" download>Download a synthetic sample ↗</a></div><input ref={input} id="dataset-file" type="file" accept=".csv,.jsonl,.ndjson,text/csv,application/x-ndjson" disabled={busy || deleting} onChange={e => upload(e.target.files?.[0])} hidden /><button className="primary" disabled={busy || deleting} onClick={() => input.current?.click()}>{busy ? 'Importing…' : 'Upload dataset'}<span aria-hidden="true"> +</span></button></section>
      <section className="explorer"><aside><div className="section-label">YOUR DATASETS <span>{datasets.length}</span></div>{loading ? <p className="muted">Loading datasets…</p> : datasets.length ? datasets.map(d => <button className={`dataset ${selected === d.id ? 'active' : ''}`} key={d.id} disabled={deleting} onClick={() => { setSelected(d.id); setOffset(0); setError(''); }}><span className="filename">{d.name}</span><span>{d.row_count.toLocaleString()} records · {d.columns.length} columns</span><span>{new Date(d.created_at).toLocaleString()}</span></button>) : <p className="muted">Your uploaded files will appear here.</p>}</aside><div className="records">{page ? <><div className="table-heading"><div><h2>{page.dataset.name}</h2><p>Records kept in order, including duplicates · expand nested JSON to inspect</p></div><button className="delete-dataset" disabled={deleting || busy} onClick={() => deleteDataset(page.dataset)}>{deleting ? 'Deleting…' : 'Delete dataset'}</button><span className="pill">{/\.csv$/i.test(page.dataset.name) ? 'CSV' : 'JSONL'}</span></div><div className="table-scroll"><table><thead><tr><th>#</th>{page.dataset.columns.map(c => <th key={c}>{c}</th>)}</tr></thead><tbody>{page.rows.map(row => <tr key={row.row_number}><td className="row-number">{row.row_number}</td>{page.dataset.columns.map(c => <td key={c}>{renderValue(row.data[c])}</td>)}</tr>)}</tbody></table></div><div className="pagination"><span>{offset + 1}–{Math.min(offset + 50, page.dataset.row_count)} of {page.dataset.row_count.toLocaleString()} records</span><div><button disabled={offset === 0} onClick={() => setOffset(o => Math.max(0, o - 50))}>← Previous</button><button disabled={offset + 50 >= page.dataset.row_count} onClick={() => setOffset(o => o + 50)}>Next →</button></div></div></> : <div className="empty"><div className="empty-icon">▤</div><h2>{selected ? 'Loading records…' : 'Your first dataset starts here'}</h2><p>{selected ? 'Reading the saved rows from your database.' : 'Upload JSONL or CSV to preview its fields and records. No manufacturing schema is assumed yet.'}</p></div>}</div></section>
      </>}
      <footer><span>HELICON / FOUNDATION</span><span>Upload → Store → Explore</span></footer>
    </main>
  </div>;
}
createRoot(document.getElementById('root')!).render(<App />);
