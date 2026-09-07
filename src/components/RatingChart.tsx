"use client";

// Rating-over-time chart for profile pages, styled after Lichess's rating
// history graph: smooth per-mode lines (one colored series per rating bucket,
// like Lichess's per-perf lines) over a soft translucent area, a muted
// horizontal grid with rating labels mirrored inside the right edge, dated
// x-axis ticks, Lichess's hallmark time-range buttons (2W / 1M / 3M / All),
// and a hover crosshair with a date + per-series rating tooltip. Pure SVG —
// no chart library — with the site's dark purple/gold plate styling; series
// colors come from the mode identity accents, not Lichess's palette.

import { useEffect, useId, useMemo, useRef, useState } from "react";

export interface RatingPoint {
  at: number;
  rating: number;
}

export interface RatingSeries {
  id: string;
  label: string;
  /** Line/area accent (hex). Distinct per mode: Nerf red, Buff blue. */
  color: string;
  points: RatingPoint[];
}

// The viewBox width follows the rendered width (measured below), so axis text
// and stroke widths stay at real pixel sizes on a phone instead of scaling
// down with a fixed 600-unit box. The height is fixed; wide screens get a
// taller plot.
const W_MIN = 320;
const H = 190;
// Left pad is tight: like Lichess, the y labels sit mirrored inside the right
// edge rather than in a left gutter, so the line gets the full width. Bottom
// pad leaves room for the dated x-axis ticks.
const PAD = { top: 14, right: 16, bottom: 26, left: 14 };

const DAY = 86_400_000;
type RangeKey = "2w" | "1m" | "3m" | "all";
const RANGES: { key: RangeKey; label: string; ms: number }[] = [
  { key: "2w", label: "2W", ms: 14 * DAY },
  { key: "1m", label: "1M", ms: 30 * DAY },
  { key: "3m", label: "3M", ms: 90 * DAY },
  { key: "all", label: "All", ms: Infinity },
];

/** Dense histories collapse to one point per calendar day per series (the
 * last rating that day), Lichess's own resolution. Under the threshold the
 * per-game points draw as-is, so a young account keeps every game visible. */
function bucketByDay(points: RatingPoint[], threshold = 240): RatingPoint[] {
  if (points.length <= threshold) return points;
  const out: RatingPoint[] = [];
  let lastDay = NaN;
  for (const p of points) {
    const day = Math.floor(p.at / DAY);
    if (day === lastDay) out[out.length - 1] = p;
    else {
      out.push(p);
      lastDay = day;
    }
  }
  return out;
}

/** Points within `ms` of the newest point across ALL series (Lichess anchors
 * ranges to the latest game, so a dormant account still shows a full window). */
function windowPoints(points: RatingPoint[], newest: number, ms: number): RatingPoint[] {
  if (!Number.isFinite(ms)) return points;
  return points.filter((p) => p.at >= newest - ms);
}

/** Date label whose precision follows the visible span: day+month for short
 * windows, month+year once the window crosses several months. */
function axisDate(t: number, spanMs: number): string {
  const d = new Date(t);
  if (spanMs > 300 * DAY) return d.toLocaleDateString(undefined, { month: "short", year: "2-digit" });
  return d.toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

/** Smooth open path through the points, as cubic beziers with Fritsch-Carlson
 * monotone tangents. Unlike the Catmull-Rom line this replaced, the control
 * points of segment i always stay inside [x(i), x(i+1)] — a burst of games
 * followed by a long quiet gap can never fling a control point backwards and
 * curl the line into a loop ("the rating graph is doing circles"), and the
 * curve never overshoots a local rating peak. Falls back to a straight
 * segment for 2 points and for zero-width (duplicate-time) gaps. */
export function smoothPath(xs: number[], ys: number[]): string {
  const n = xs.length;
  if (n === 0) return "";
  if (n === 1) return `M${xs[0].toFixed(1)},${ys[0].toFixed(1)}`;

  // Secants per gap, then Fritsch-Carlson tangents per point: endpoint slopes
  // copy their secant; an interior point between opposing or flat secants gets
  // slope 0 (a genuine local extremum stays an extremum); otherwise the
  // weighted harmonic mean keeps the segment monotone.
  const h: number[] = new Array(n - 1);
  const d: number[] = new Array(n - 1);
  for (let i = 0; i < n - 1; i++) {
    h[i] = xs[i + 1] - xs[i];
    d[i] = h[i] > 0 ? (ys[i + 1] - ys[i]) / h[i] : 0;
  }
  const m: number[] = new Array(n);
  m[0] = d[0];
  m[n - 1] = d[n - 2];
  for (let i = 1; i < n - 1; i++) {
    if (d[i - 1] === 0 || d[i] === 0 || d[i - 1] * d[i] < 0) {
      m[i] = 0;
    } else {
      const wLeft = 2 * h[i] + h[i - 1];
      const wRight = h[i] + 2 * h[i - 1];
      m[i] = (wLeft + wRight) / (wLeft / d[i - 1] + wRight / d[i]);
    }
  }

  let path = `M${xs[0].toFixed(1)},${ys[0].toFixed(1)}`;
  for (let i = 0; i < n - 1; i++) {
    if (h[i] <= 0) {
      // Same-instant points (batch imports, same-millisecond finishes): a
      // vertical step, drawn straight so the curve cannot double back.
      path += ` L${xs[i + 1].toFixed(1)},${ys[i + 1].toFixed(1)}`;
      continue;
    }
    const c1x = xs[i] + h[i] / 3;
    const c1y = ys[i] + (m[i] * h[i]) / 3;
    const c2x = xs[i + 1] - h[i] / 3;
    const c2y = ys[i + 1] - (m[i + 1] * h[i]) / 3;
    path += ` C${c1x.toFixed(1)},${c1y.toFixed(1)} ${c2x.toFixed(1)},${c2y.toFixed(1)} ${xs[i + 1].toFixed(1)},${ys[i + 1].toFixed(1)}`;
  }
  return path;
}

interface DrawnSeries {
  id: string;
  label: string;
  color: string;
  points: RatingPoint[];
  xs: number[];
  ys: number[];
  line: string;
  area: string;
}

export function RatingChart({
  series,
  rangeDays,
  hideLegend = false,
  bare = false,
}: {
  series: RatingSeries[];
  /** When set, points are pre-filtered to the trailing `rangeDays` window
   *  (now - rangeDays) before anything is drawn, and the chart's own range
   *  buttons are suppressed because the caller owns the range control
   *  (RatingHistoryPanel). `null` or omitted keeps the full history and the
   *  built-in range buttons, so existing callers are unaffected. */
  rangeDays?: number | null;
  /** Hide the built-in per-series legend/toggle chips when the caller renders
   *  its own mode chips. Defaults false (existing behavior). */
  hideLegend?: boolean;
  /** Drop the outer `.plate` wrapper and the built-in header row entirely,
   *  rendering only the graph body. Lets a parent panel own the card chrome and
   *  its own controls without nesting plates. Defaults false. */
  bare?: boolean;
}) {
  const svgRef = useRef<SVGSVGElement>(null);
  const hostRef = useRef<HTMLDivElement>(null);
  const [W, setW] = useState(600);
  useEffect(() => {
    const el = hostRef.current;
    if (!el || typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver((entries) => {
      const w = Math.round(entries[0]?.contentRect.width ?? 0);
      if (w > 0) setW(Math.max(W_MIN, w));
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  const [hoverT, setHoverT] = useState<number | null>(null);
  const [range, setRange] = useState<RangeKey>("all");
  const [hidden, setHidden] = useState<Set<string>>(new Set());
  const gid = useId();

  // The caller-driven trailing window: when `rangeDays` is a finite number we
  // drop points older than now - rangeDays up front, so the built-in ranges
  // (below) operate on an already-scoped set and the parent's chips are the
  // single source of truth for the time span.
  const controlledRange = typeof rangeDays === "number";
  const scoped = useMemo(() => {
    if (!controlledRange) return series;
    // Trailing window is anchored to the current time by design (display-only).
    // eslint-disable-next-line react-hooks/purity
    const cutoff = Date.now() - rangeDays! * DAY;
    return series.map((s) => ({ ...s, points: s.points.filter((p) => p.at >= cutoff) }));
  }, [series, controlledRange, rangeDays]);
  // Day resolution once a span is dense (see bucketByDay). Done after the
  // range filter so a short window still shows individual games.
  const bucketed = useMemo(() => scoped.map((s) => ({ ...s, points: bucketByDay(s.points) })), [scoped]);

  const withData = useMemo(() => bucketed.filter((s) => s.points.length > 0), [bucketed]);
  const visible = useMemo(
    () => withData.filter((s) => !hidden.has(s.id) || withData.every((x) => hidden.has(x.id))),
    [withData, hidden],
  );

  const newest = useMemo(
    () => Math.max(...withData.map((s) => s.points[s.points.length - 1].at)),
    [withData],
  );
  const oldest = useMemo(() => Math.min(...withData.map((s) => s.points[0].at)), [withData]);

  // Only offer range buttons whose window actually holds 2+ points on some
  // series, so a young account is not littered with dead tabs.
  const available = useMemo(() => {
    const span = newest - oldest;
    return RANGES.filter(
      (r) =>
        r.key === "all" ||
        (r.ms < span && withData.some((s) => windowPoints(s.points, newest, r.ms).length >= 2)),
    );
  }, [withData, newest, oldest]);

  const effectiveRange = available.some((r) => r.key === range) ? range : "all";
  const rangeMs = RANGES.find((r) => r.key === effectiveRange)!.ms;

  const drawn = useMemo<{
    list: DrawnSeries[];
    yTicks: { y: number; label: number }[];
    xTicks: { x: number; label: string }[];
    xOf: (t: number) => number;
    t0: number;
    t1: number;
    min: number;
    max: number;
  } | null>(() => {
    const windowed = visible
      .map((s) => ({ ...s, points: windowPoints(s.points, newest, rangeMs) }))
      .filter((s) => s.points.length >= 1);
    if (windowed.length === 0 || windowed.every((s) => s.points.length < 2)) return null;

    const all = windowed.flatMap((s) => s.points);
    let lo = Math.min(...all.map((p) => p.rating));
    let hi = Math.max(...all.map((p) => p.rating));
    if (hi - lo < 40) {
      const mid = (hi + lo) / 2;
      lo = mid - 20;
      hi = mid + 20;
    }
    const spanR = hi - lo;
    lo -= spanR * 0.08;
    hi += spanR * 0.08;

    const t0 = Math.min(...all.map((p) => p.at));
    const t1 = Math.max(...all.map((p) => p.at));
    const spanT = t1 - t0;
    const xOf = (t: number) =>
      PAD.left + (t1 === t0 ? 0.5 : (t - t0) / (t1 - t0)) * (W - PAD.left - PAD.right);
    const yOf = (r: number) => PAD.top + (1 - (r - lo) / (hi - lo)) * (H - PAD.top - PAD.bottom);
    const baseline = H - PAD.bottom;

    const list: DrawnSeries[] = windowed.map((s) => {
      const xs = s.points.map((p) => xOf(p.at));
      const ys = s.points.map((p) => yOf(p.rating));
      const line = smoothPath(xs, ys);
      const area =
        xs.length >= 2
          ? `${line} L${xs[xs.length - 1].toFixed(1)},${baseline} L${xs[0].toFixed(1)},${baseline} Z`
          : "";
      return { id: s.id, label: s.label, color: s.color, points: s.points, xs, ys, line, area };
    });

    // Round-numbered horizontal gridlines inside the range (Lichess caps ~7).
    const step = Math.max(25, Math.ceil((hi - lo) / 4 / 25) * 25);
    const yTicks: { y: number; label: number }[] = [];
    for (let v = Math.ceil(lo / step) * step; v <= hi; v += step) {
      yTicks.push({ y: yOf(v), label: v });
    }

    // Dated vertical gridlines: up to 5 evenly spaced across the time span,
    // deduped when the span is so short that ticks would share a date label.
    const xTicks: { x: number; label: string }[] = [];
    if (spanT > 0) {
      const n = W < 480 ? 3 : W < 900 ? 4 : 6;
      let last = "";
      for (let i = 0; i <= n; i++) {
        const t = t0 + (spanT * i) / n;
        const label = axisDate(t, spanT);
        if (label === last && i !== n) continue;
        last = label;
        xTicks.push({ x: xOf(t), label });
      }
    } else {
      xTicks.push({ x: xOf(t0), label: axisDate(t0, 0) });
    }

    return {
      list,
      yTicks,
      xTicks,
      xOf,
      t0,
      t1,
      min: Math.min(...all.map((p) => p.rating)),
      max: Math.max(...all.map((p) => p.rating)),
    };
  }, [visible, newest, rangeMs, W]);

  const onMove = (e: React.PointerEvent<SVGSVGElement>) => {
    const rect = svgRef.current?.getBoundingClientRect();
    if (!rect || !drawn) return;
    const x = ((e.clientX - rect.left) / rect.width) * W;
    const frac = Math.min(1, Math.max(0, (x - PAD.left) / (W - PAD.left - PAD.right)));
    setHoverT(drawn.t0 + frac * (drawn.t1 - drawn.t0));
  };

  // Per-series nearest point to the hovered time (series have independent
  // game timestamps, so the crosshair snaps per line, like Lichess).
  const hover = useMemo(() => {
    if (hoverT == null || !drawn) return null;
    const rows = drawn.list
      .map((s) => {
        let best = 0;
        for (let i = 1; i < s.points.length; i++) {
          if (Math.abs(s.points[i].at - hoverT) < Math.abs(s.points[best].at - hoverT)) best = i;
        }
        return { series: s, i: best, at: s.points[best].at };
      })
      // Keep the crosshair honest: only series with a game near the hovered
      // time (within a tenth of the window) get a dot + tooltip row.
      .filter((r) => Math.abs(r.at - hoverT) <= Math.max(DAY, (drawn.t1 - drawn.t0) / 10));
    if (rows.length === 0) return null;
    const at = rows.reduce((a, r) => (Math.abs(r.at - hoverT) < Math.abs(a - hoverT) ? r.at : a), rows[0].at);
    return { rows, x: drawn.xOf(at), at };
  }, [hoverT, drawn]);

  const toggle = (id: string) =>
    setHidden((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else if (withData.filter((s) => !next.has(s.id)).length > 1) next.add(id); // never hide the last line
      return next;
    });

  if (withData.length === 0) return null;

  return (
    <div className={bare ? "" : "plate p-4"}>
      {!bare && (
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex flex-wrap items-center gap-3">
          <h3 className="text-[12px] text-parchment-400">Rating history</h3>
          {/* Per-mode legend chips double as series toggles. Suppressed when
              the caller supplies its own mode chips (hideLegend). */}
          {!hideLegend &&
            withData.length > 1 &&
            withData.map((s) => {
              const off = hidden.has(s.id);
              return (
                <button
                  key={s.id}
                  type="button"
                  onClick={() => toggle(s.id)}
                  aria-pressed={!off}
                  className={
                    "flex items-center gap-1.5 rounded-sm px-1.5 py-0.5 text-[13px] font-medium transition " +
                    (off ? "opacity-40 hover:opacity-70" : "hover:bg-white/[0.04]")
                  }
                >
                  <span
                    className="h-2 w-2 shrink-0 rounded-full"
                    style={{ background: s.color }}
                    aria-hidden
                  />
                  <span className="text-parchment-200">{s.label}</span>
                  <span className="font-mono tabular-nums text-parchment-400">
                    {Math.round(s.points[s.points.length - 1].rating)}
                  </span>
                </button>
              );
            })}
        </div>
        <div className="flex items-center gap-3">
          {drawn && (
            <span className="text-xs text-parchment-400">
              low {Math.round(drawn.min)} · high {Math.round(drawn.max)}
            </span>
          )}
          {!controlledRange && available.length > 1 && (
            <div className="flex overflow-hidden rounded-sm border border-white/10" role="group" aria-label="Time range">
              {available.map((r) => {
                const on = r.key === effectiveRange;
                return (
                  <button
                    key={r.key}
                    type="button"
                    onClick={() => setRange(r.key)}
                    aria-pressed={on}
                    className={
                      "px-2 py-0.5 text-[13px] font-medium tabular-nums transition " +
                      (on
                        ? "bg-gold/15 text-gold-leaf"
                        : "text-parchment-400 hover:bg-white/[0.04] hover:text-parchment-200")
                    }
                  >
                    {r.label}
                  </button>
                );
              })}
            </div>
          )}
        </div>
      </div>
      )}
      <div ref={hostRef} className={bare ? "relative" : "relative mt-2"}>
        {!drawn ? (
          <div className="p-4 text-sm text-parchment-400">Not enough rated games yet</div>
        ) : (
          <svg
            ref={svgRef}
            viewBox={`0 0 ${W} ${H}`}
            className="block w-full touch-none"
            style={{ height: H }}
            preserveAspectRatio="none"
            onPointerMove={onMove}
            onPointerLeave={() => setHoverT(null)}
            role="img"
            aria-label={`Rating history: ${drawn.list.map((s) => `${s.label} ${Math.round(s.points[s.points.length - 1].rating)}`).join(", ")}`}
          >
            <defs>
              {/* Soft per-series wash that fades to nothing before the baseline. */}
              {drawn.list.map((s) => (
                <linearGradient key={s.id} id={`rc-fill-${gid}-${s.id}`} x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor={s.color} stopOpacity={0.16} />
                  <stop offset="100%" stopColor={s.color} stopOpacity={0} />
                </linearGradient>
              ))}
            </defs>

            {/* Dated vertical gridlines + bottom x labels (Lichess time axis). */}
            {drawn.xTicks.map((t, i) => (
              <g key={`x-${i}`}>
                <line
                  x1={t.x}
                  x2={t.x}
                  y1={PAD.top}
                  y2={H - PAD.bottom}
                  stroke="var(--paper-dim)"
                  strokeOpacity={0.1}
                  strokeWidth={1}
                  vectorEffect="non-scaling-stroke"
                />
                <text
                  x={t.x}
                  y={H - 8}
                  textAnchor={i === 0 ? "start" : i === drawn.xTicks.length - 1 ? "end" : "middle"}
                  fontSize={12}
                  fill="var(--paper-dim)"
                >
                  {t.label}
                </text>
              </g>
            ))}

            {/* Muted horizontal grid + mirrored y labels (Lichess right-axis). */}
            {drawn.yTicks.map((t) => (
              <g key={t.label}>
                <line
                  x1={PAD.left}
                  x2={W - PAD.right}
                  y1={t.y}
                  y2={t.y}
                  stroke="var(--paper-dim)"
                  strokeOpacity={0.16}
                  strokeWidth={1}
                  vectorEffect="non-scaling-stroke"
                />
                <text x={W - PAD.right} y={t.y - 4} textAnchor="end" fontSize={12} fill="var(--paper-dim)">
                  {t.label}
                </text>
              </g>
            ))}

            {/* Areas first, then every line above them, so overlapping washes
                never dull another mode's stroke. */}
            {drawn.list.map((s) => s.area && <path key={`a-${s.id}`} d={s.area} fill={`url(#rc-fill-${gid}-${s.id})`} />)}
            {drawn.list.map((s) => (
              <path
                key={`l-${s.id}`}
                d={s.line}
                fill="none"
                stroke={s.color}
                strokeWidth={2}
                strokeLinejoin="round"
                strokeLinecap="round"
                vectorEffect="non-scaling-stroke"
              />
            ))}

            {hover && (
              <g>
                <line
                  x1={hover.x}
                  x2={hover.x}
                  y1={PAD.top}
                  y2={H - PAD.bottom}
                  stroke="var(--paper-dim)"
                  strokeOpacity={0.45}
                  strokeWidth={1}
                  vectorEffect="non-scaling-stroke"
                />
                {/* One accent node per series with a soft halo + surface-toned
                    ring, echoing Lichess's pale hover dot. */}
                {hover.rows.map(({ series: s, i }) => (
                  <g key={`h-${s.id}`}>
                    <circle cx={s.xs[i]} cy={s.ys[i]} r={7} fill={s.color} fillOpacity={0.18} />
                    <circle
                      cx={s.xs[i]}
                      cy={s.ys[i]}
                      r={4}
                      fill={s.color}
                      stroke="var(--paper)"
                      strokeOpacity={0.85}
                      strokeWidth={1.5}
                    />
                  </g>
                ))}
              </g>
            )}
          </svg>
        )}
        {/* not .plate: it forces position:relative, which would knock out `absolute` */}
        {hover && drawn && (
          <div
            className="pointer-events-none absolute -top-1 flex -translate-x-1/2 items-center gap-2 border border-ink-500 bg-ink-900 px-2 py-1 text-xs whitespace-nowrap shadow-plate motion-safe:transition-opacity"
            style={{ left: `${(hover.x / W) * 100}%` }}
          >
            {hover.rows.map(({ series: s, i }) => (
              <span key={s.id} className="flex items-center gap-1.5">
                <span className="h-2 w-2 shrink-0 rounded-full" style={{ background: s.color }} aria-hidden />
                <span className="font-semibold text-parchment-100">{Math.round(s.points[i].rating)}</span>
              </span>
            ))}
            <span className="text-parchment-400">{new Date(hover.at).toLocaleDateString()}</span>
          </div>
        )}
      </div>
    </div>
  );
}
