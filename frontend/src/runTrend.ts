// Descriptive OLS fit. No significance or causal claim is attached to these flags.
export function fitTrend(rows: { job_id: string; quantity: number; rate: number }[]) {
  if (rows.length < 5) return null;
  const n = rows.length;
  const x = rows.reduce((sum, p) => sum + p.quantity, 0) / n;
  const y = rows.reduce((sum, p) => sum + p.rate, 0) / n;
  const xx = rows.reduce((sum, p) => sum + (p.quantity - x) ** 2, 0);
  if (xx === 0) return null;
  const slope = rows.reduce((sum, p) => sum + (p.quantity - x) * (p.rate - y), 0) / xx;
  const predict = (quantity: number) => y + slope * (quantity - x);
  const residuals = rows.map(p => p.rate - predict(p.quantity));
  const deviation = Math.sqrt(residuals.reduce((sum, r) => sum + r * r, 0) / (n - 2));
  const x1 = Math.min(...rows.map(p => p.quantity));
  const x2 = Math.max(...rows.map(p => p.quantity));
  return { x1, x2, y1: predict(x1), y2: predict(x2), outliers: rows.filter((_, i) => deviation > 1e-10 && Math.abs(residuals[i]) > 3 * deviation).map(p => p.job_id) };
}
