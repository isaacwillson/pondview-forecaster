import type { HourPrediction } from "@/lib/types";
import { hourLabel } from "@/lib/format";

interface Props {
  predictions: HourPrediction[];
  /** Fix the y-scale across renders (e.g. while dragging what-if controls). */
  yMaxHint?: number;
  ariaLabel: string;
}

const W = 760;
const H = 300;
const M = { top: 18, right: 14, bottom: 28, left: 30 };

function niceTicks(max: number): number[] {
  const steps = [1, 2, 5, 10, 20, 50, 100];
  let step = steps[steps.length - 1] ?? 1;
  for (const s of steps) {
    if (max / s <= 5) {
      step = s;
      break;
    }
  }
  const top = Math.max(step, Math.ceil(max / step) * step);
  const ticks: number[] = [];
  for (let v = 0; v <= top; v += step) ticks.push(v);
  return ticks;
}

/** Predicted arrivals per hour: a slim accent bar for the estimate inside a soft band
 *  spanning its low–high uncertainty. Colours come from CSS variables, so it is
 *  theme-aware for free. */
export function ArrivalsChart({ predictions, yMaxHint, ariaLabel }: Props) {
  const rawMax = Math.max(yMaxHint ?? 0, ...predictions.map((p) => p.high), 1);
  const ticks = niceTicks(rawMax);
  const yMax = ticks[ticks.length - 1] ?? 1;

  const plotW = W - M.left - M.right;
  const plotH = H - M.top - M.bottom;
  const baseY = M.top + plotH;
  const slot = plotW / predictions.length;
  const bandW = Math.min(slot * 0.62, 46);
  const barW = Math.min(slot * 0.2, 14);

  const x = (i: number) => M.left + slot * (i + 0.5);
  const y = (v: number) => M.top + plotH * (1 - v / yMax);

  return (
    <figure className="m-0">
      <svg
        viewBox={`0 0 ${W} ${H}`}
        width="100%"
        role="img"
        aria-label={ariaLabel}
        style={{ height: "auto", display: "block" }}
      >
        {/* horizontal grid + y labels */}
        {ticks.map((t) => (
          <g key={t}>
            <line
              x1={M.left}
              x2={W - M.right}
              y1={y(t)}
              y2={y(t)}
              stroke="var(--line)"
              strokeWidth={1}
            />
            <text
              x={M.left - 6}
              y={y(t)}
              textAnchor="end"
              dominantBaseline="middle"
              fontSize={11}
              fill="var(--muted)"
              className="tnum"
            >
              {t}
            </text>
          </g>
        ))}

        {predictions.map((p, i) => {
          const cx = x(i);
          const bandTop = y(p.high);
          const bandBottom = y(p.low);
          return (
            <g key={p.hour}>
              {/* soft uncertainty band (low..high) */}
              <rect
                x={cx - bandW / 2}
                y={bandTop}
                width={bandW}
                height={Math.max(bandBottom - bandTop, 1)}
                rx={2}
                fill="var(--accent-soft)"
              />
              {/* point estimate bar (0..predicted) */}
              <rect
                x={cx - barW / 2}
                y={y(p.predicted)}
                width={barW}
                height={Math.max(baseY - y(p.predicted), 0)}
                rx={1.5}
                fill="var(--accent)"
              />
              {/* predicted value */}
              <text
                x={cx}
                y={y(p.high) - 5}
                textAnchor="middle"
                fontSize={10.5}
                fill="var(--ink)"
                className="tnum"
              >
                {p.predicted.toFixed(1)}
              </text>
              {/* hour label */}
              <text
                x={cx}
                y={baseY + 16}
                textAnchor="middle"
                fontSize={11}
                fill="var(--muted)"
                className="tnum"
              >
                {hourLabel(p.hour)}
              </text>
            </g>
          );
        })}

        {/* baseline */}
        <line
          x1={M.left}
          x2={W - M.right}
          y1={baseY}
          y2={baseY}
          stroke="var(--muted)"
          strokeWidth={1}
        />
      </svg>

      {/* accessible fallback for screen readers */}
      <figcaption className="sr-only">
        <table>
          <thead>
            <tr>
              <th>Hour</th>
              <th>Predicted</th>
              <th>Low</th>
              <th>High</th>
            </tr>
          </thead>
          <tbody>
            {predictions.map((p) => (
              <tr key={p.hour}>
                <td>{hourLabel(p.hour)}</td>
                <td>{p.predicted}</td>
                <td>{p.low}</td>
                <td>{p.high}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </figcaption>
    </figure>
  );
}
