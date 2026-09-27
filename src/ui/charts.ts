/**
 * Tiny canvas charts: sparkline + multi-series line chart. DPR-aware.
 *
 *   panel.body.append(sparkline(company.finances.valuationHistory, { color: 'var(--accent)' }))
 *   const c = h('canvas'); lineChart(c, [{ name: 'Gotówka', values, color: '#e8b04a' }], { height: 160 });
 */

/** Resolve CSS variables like 'var(--accent)' to a color string. */
export function cssColor(c: string, el: Element = document.documentElement): string {
  const m = /^var\((--[^)]+)\)$/.exec(c.trim());
  return m ? getComputedStyle(el).getPropertyValue(m[1]!).trim() || '#888' : c;
}

function prep(canvas: HTMLCanvasElement, w: number, hgt: number): CanvasRenderingContext2D {
  const dpr = Math.min(2, window.devicePixelRatio || 1);
  canvas.width = Math.round(w * dpr);
  canvas.height = Math.round(hgt * dpr);
  canvas.style.width = `${w}px`;
  canvas.style.height = `${hgt}px`;
  const g = canvas.getContext('2d')!;
  g.setTransform(dpr, 0, 0, dpr, 0, 0);
  g.clearRect(0, 0, w, hgt);
  return g;
}

export interface SparkOptions {
  width?: number;
  height?: number;
  color?: string;
  fill?: boolean;
  /** Draw zero baseline if values cross zero. */
  zeroLine?: boolean;
}

export function drawSparkline(canvas: HTMLCanvasElement, values: readonly number[], o: SparkOptions = {}): void {
  const w = o.width ?? 120;
  const hgt = o.height ?? 28;
  const g = prep(canvas, w, hgt);
  if (values.length < 2) return;
  let min = Math.min(...values);
  let max = Math.max(...values);
  if (min === max) (min -= 1), (max += 1);
  const x = (i: number): number => (i / (values.length - 1)) * (w - 2) + 1;
  const y = (v: number): number => hgt - 2 - ((v - min) / (max - min)) * (hgt - 4);
  const color = cssColor(o.color ?? 'var(--accent)');
  if (o.zeroLine !== false && min < 0 && max > 0) {
    g.strokeStyle = 'rgba(255,255,255,0.2)';
    g.beginPath();
    g.moveTo(0, y(0));
    g.lineTo(w, y(0));
    g.stroke();
  }
  g.beginPath();
  values.forEach((v, i) => (i ? g.lineTo(x(i), y(v)) : g.moveTo(x(i), y(v))));
  g.strokeStyle = color;
  g.lineWidth = 1.5;
  g.stroke();
  if (o.fill !== false) {
    g.lineTo(x(values.length - 1), hgt);
    g.lineTo(x(0), hgt);
    g.closePath();
    g.globalAlpha = 0.18;
    g.fillStyle = color;
    g.fill();
    g.globalAlpha = 1;
  }
}

/** Create a sparkline canvas. */
export function sparkline(values: readonly number[], o: SparkOptions = {}): HTMLCanvasElement {
  const c = document.createElement('canvas');
  c.className = 'ig-sparkline';
  drawSparkline(c, values, o);
  return c;
}

export interface Series {
  name: string;
  values: readonly number[];
  color: string;
}

export interface LineChartOptions {
  width?: number;
  height?: number;
  /** X labels (same length as values), drawn sparsely. */
  labels?: readonly string[];
  yFormat?(v: number): string;
  legend?: boolean;
}

export function lineChart(canvas: HTMLCanvasElement, series: Series[], o: LineChartOptions = {}): void {
  const w = o.width ?? (canvas.parentElement?.clientWidth || 320);
  const hgt = o.height ?? 160;
  const g = prep(canvas, w, hgt);
  const padL = 52;
  const padR = 8;
  const padT = o.legend === false ? 8 : 22;
  const padB = o.labels ? 20 : 8;
  const n = Math.max(0, ...series.map((s) => s.values.length));
  const all = series.flatMap((s) => [...s.values]);
  let min = all.length ? Math.min(...all, 0) : 0;
  let max = all.length ? Math.max(...all) : 1;
  if (min === max) max = min + 1;
  const fmt = o.yFormat ?? ((v: number) => (Math.abs(v) >= 1000 ? `${(v / 1000).toFixed(0)}k` : v.toFixed(0)));
  const X = (i: number): number => padL + (n > 1 ? (i / (n - 1)) * (w - padL - padR) : 0);
  const Y = (v: number): number => padT + (1 - (v - min) / (max - min)) * (hgt - padT - padB);
  g.font = '10px system-ui, sans-serif';
  g.fillStyle = cssColor('var(--text-dim)');
  g.strokeStyle = 'rgba(255,255,255,0.08)';
  g.textAlign = 'right';
  g.textBaseline = 'middle';
  for (let k = 0; k <= 4; k++) {
    const v = min + ((max - min) * k) / 4;
    g.beginPath();
    g.moveTo(padL, Y(v));
    g.lineTo(w - padR, Y(v));
    g.stroke();
    g.fillText(fmt(v), padL - 4, Y(v));
  }
  if (o.labels && n > 1) {
    g.textAlign = 'center';
    g.textBaseline = 'top';
    const step = Math.ceil(n / 6);
    for (let i = 0; i < n; i += step) g.fillText(o.labels[i] ?? '', X(i), hgt - padB + 4);
  }
  for (const s of series) {
    if (s.values.length < 2) continue;
    g.beginPath();
    s.values.forEach((v, i) => (i ? g.lineTo(X(i), Y(v)) : g.moveTo(X(i), Y(v))));
    g.strokeStyle = cssColor(s.color);
    g.lineWidth = 1.75;
    g.stroke();
  }
  if (o.legend !== false) {
    let lx = padL;
    g.textAlign = 'left';
    g.textBaseline = 'middle';
    for (const s of series) {
      g.fillStyle = cssColor(s.color);
      g.fillRect(lx, 7, 10, 3);
      g.fillStyle = cssColor('var(--text)');
      g.fillText(s.name, lx + 14, 9);
      lx += 22 + g.measureText(s.name).width;
    }
  }
}
