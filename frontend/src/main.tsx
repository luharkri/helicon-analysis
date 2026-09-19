import { useEffect, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import './style.css';

type Dataset = { id: string; name: string; columns: string[]; row_count: number; created_at: string };
type Page = { dataset: Dataset; rows: { row_number: number; data: Record<string, string> }[] };
async function api<T>(url: string, options?: RequestInit): Promise<T> {
  const response = await fetch(url, options);
  if (!response.ok) {
    const body = await response.json().catch(() => ({}));
    throw new Error(typeof body.detail === 'string' ? body.detail : `Request failed (${response.status}).`);
  }
  return response.json();
}

function App() {
  const [datasets, setDatasets] = useState<Dataset[]>([]);
  const [selected, setSelected] = useState('');
  const [page, setPage] = useState<Page | null>(null);
  const [offset, setOffset] = useState(0);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(true);
  const [message, setMessage] = useState('');
  const input = useRef<HTMLInputElement>(null);
  async function refresh() {
    const items = await api<Dataset[]>('/api/datasets');
    setDatasets(items);
    setSelected(current => current || items[0]?.id || '');
  }
  useEffect(() => { refresh().catch(e => setError(e.message)).finally(() => setLoading(false)); }, []);
  useEffect(() => {
    if (!selected) return;
    const controller = new AbortController();
    setPage(null);
    api<Page>(`/api/datasets/${selected}/rows?offset=${offset}`, { signal: controller.signal })
      .then(setPage).catch(e => { if (e.name !== 'AbortError') setError(e.message); });
    return () => controller.abort();
  }, [selected, offset]);
  async function upload(file?: File) {
    if (!file) return;
    setError(''); setMessage('');
    if (file.size > 10 * 1024 * 1024) { setError('Choose a CSV smaller than 10 MB.'); return; }
    setBusy(true);
    try {
      const dataset = await api<Dataset>('/api/datasets', {
        method: 'POST', headers: { 'Content-Type': 'text/csv', 'X-File-Name': encodeURIComponent(file.name), 'X-Helicon-Request': '1' }, body: file,
      });
      setDatasets(current => [dataset, ...current]); setSelected(dataset.id); setOffset(0);
      setMessage(`Imported ${dataset.row_count.toLocaleString()} rows. Your dataset is saved.`);
    } catch (e) { setError(e instanceof Error ? e.message : 'Upload failed. Try again.'); }
    finally { setBusy(false); if (input.current) input.current.value = ''; }
  }
  const total = datasets.reduce((sum, d) => sum + d.row_count, 0);
  return <div className="shell">
    <header><a className="brand" href="/"><span className="mark">H</span> helicon<span className="brand-divider">/</span><span className="subbrand">event explorer</span></a><span className="badge">Connected preview · v0.2</span></header>
    <main>
      <div className="intro"><div><p className="eyebrow">MANUFACTURING INTELLIGENCE</p><h1>Start with the events.</h1><p className="lede">Import a log, explore its records, and build from what the data tells you.</p></div><span className="private">● Password protected</span></div>
      <section className="stats" aria-label="Dataset summary"><div><span>Datasets</span><strong>{datasets.length}</strong></div><div><span>Stored records</span><strong>{total.toLocaleString()}</strong></div><div><span>Workspace</span><strong className="small">Infrastructure preview</strong><span>Real log analysis comes next</span></div></section>
      {error && <div className="notice error" role="alert">{error} <button onClick={() => window.location.reload()}>Reload</button></div>}
      {message && <div className="notice success" role="status">{message}</div>}
      <section className="upload"><div className="upload-symbol" aria-hidden="true">↑</div><div className="upload-copy"><h2>Bring in a dataset</h2><p>UTF-8 CSV with a header row · up to 10 MB / 100,000 records</p><a href="/api/sample" download>Download a synthetic sample ↗</a></div><input ref={input} id="csv" type="file" accept=".csv,text/csv" disabled={busy} onChange={e => upload(e.target.files?.[0])} hidden /><button className="primary" disabled={busy} onClick={() => input.current?.click()}>{busy ? 'Importing…' : 'Upload CSV'}<span aria-hidden="true"> +</span></button></section>
      <section className="explorer"><aside><div className="section-label">YOUR DATASETS <span>{datasets.length}</span></div>{loading ? <p className="muted">Loading datasets…</p> : datasets.length ? datasets.map(d => <button className={`dataset ${selected === d.id ? 'active' : ''}`} key={d.id} onClick={() => { setSelected(d.id); setOffset(0); setError(''); }}><span className="filename">{d.name}</span><span>{d.row_count.toLocaleString()} records · {d.columns.length} columns</span><span>{new Date(d.created_at).toLocaleString()}</span></button>) : <p className="muted">Your uploaded files will appear here.</p>}</aside><div className="records">{page ? <><div className="table-heading"><div><h2>{page.dataset.name}</h2><p>Original values preserved · each upload is a separate dataset</p></div><span className="pill">CSV</span></div><div className="table-scroll"><table><thead><tr><th>#</th>{page.dataset.columns.map(c => <th key={c}>{c}</th>)}</tr></thead><tbody>{page.rows.map(row => <tr key={row.row_number}><td className="row-number">{row.row_number}</td>{page.dataset.columns.map(c => <td key={c}>{row.data[c] || <span className="muted">—</span>}</td>)}</tr>)}</tbody></table></div><div className="pagination"><span>{offset + 1}–{Math.min(offset + 50, page.dataset.row_count)} of {page.dataset.row_count.toLocaleString()} records</span><div><button disabled={offset === 0} onClick={() => setOffset(o => Math.max(0, o - 50))}>← Previous</button><button disabled={offset + 50 >= page.dataset.row_count} onClick={() => setOffset(o => o + 50)}>Next →</button></div></div></> : <div className="empty"><div className="empty-icon">▤</div><h2>{selected ? 'Loading records…' : 'Your first dataset starts here'}</h2><p>{selected ? 'Reading the saved rows from your database.' : 'Upload a CSV to preview its columns and records. No manufacturing schema is assumed yet.'}</p></div>}</div></section>
      <footer><span>HELICON / FOUNDATION</span><span>Upload → Store → Explore</span></footer>
    </main>
  </div>;
}
createRoot(document.getElementById('root')!).render(<App />);
