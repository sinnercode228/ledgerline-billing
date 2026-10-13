import type { Currency } from '@ledgerline/core';
import { useRef, useState } from 'react';
import { formatCompactMoney } from '../../format/money';
import { useI18n } from '../../i18n/i18n';
import { Money } from '../../ui/Money';
import { useWidth } from '../../ui/useWidth';

export interface RevenuePoint {
  day: string;
  amount: number;
}

const HEIGHT = 200;
const MARGIN = { top: 12, right: 8, bottom: 26, left: 56 };
const MAX_BAR = 24;
const GAP = 2;
const RADIUS = 4;

/** Ticks on round numbers: 1, 2 or 5 times a power of ten. */
function niceStep(span: number, count: number): number {
  const raw = span / count;
  const power = 10 ** Math.floor(Math.log10(raw));
  const factor = [1, 2, 5, 10].find((candidate) => candidate * power >= raw) ?? 10;
  return factor * power;
}

/** A bar rounded at its data end and square at the baseline. */
function barPath(x: number, width: number, baseline: number, end: number): string {
  const height = Math.abs(baseline - end);
  const r = Math.min(RADIUS, width / 2, height);
  if (end <= baseline) {
    return `M${x},${baseline}V${end + r}Q${x},${end} ${x + r},${end}H${x + width - r}Q${x + width},${end} ${x + width},${end + r}V${baseline}Z`;
  }
  return `M${x},${baseline}V${end - r}Q${x},${end} ${x + r},${end}H${x + width - r}Q${x + width},${end} ${x + width},${end - r}V${baseline}Z`;
}

/** Daily revenue for one currency: one series, so the title names it and no legend is needed. */
export function RevenueChart({ points, currency, label }: { points: readonly RevenuePoint[]; currency: Currency; label: string }) {
  const { language, date, t } = useI18n();
  const frame = useRef<HTMLDivElement>(null);
  const width = useWidth(frame, 640);
  const [hovered, setHovered] = useState<number | null>(null);
  const [showTable, setShowTable] = useState(false);

  const innerWidth = Math.max(width - MARGIN.left - MARGIN.right, 10);
  const innerHeight = HEIGHT - MARGIN.top - MARGIN.bottom;
  const amounts = points.map((point) => point.amount);
  const step = niceStep(Math.max(Math.max(...amounts, 0) - Math.min(...amounts, 0), 100), 4);
  const top = Math.max(Math.ceil(Math.max(...amounts, 0) / step), 1) * step;
  const bottom = Math.floor(Math.min(...amounts, 0) / step) * step;
  const y = (value: number) => MARGIN.top + ((top - value) / (top - bottom)) * innerHeight;
  const ticks = Array.from({ length: Math.round((top - bottom) / step) + 1 }, (_, i) => bottom + i * step);
  const band = innerWidth / Math.max(points.length, 1);
  const barWidth = Math.max(Math.min(MAX_BAR, band - GAP), 1);
  const labelEvery = Math.ceil(points.length / Math.max(Math.floor(innerWidth / 70), 1));
  const active = hovered === null ? null : points[hovered];

  return (
    <div className="chart">
      <div ref={frame} className="chart-frame">
        <svg width={width} height={HEIGHT} role="img" aria-label={label}>
          {ticks.map((tick) => (
            <g key={tick}>
              <line className="chart-grid" x1={MARGIN.left} x2={width - MARGIN.right} y1={y(tick)} y2={y(tick)} />
              <text className="chart-tick" x={MARGIN.left - 8} y={y(tick)} dy="0.32em" textAnchor="end">
                {formatCompactMoney(tick, currency, language)}
              </text>
            </g>
          ))}
          {points.map((point, i) => {
            const x = MARGIN.left + i * band;
            return (
              <g key={point.day}>
                {point.amount !== 0 && (
                  <path className={hovered === i ? 'chart-bar is-hovered' : 'chart-bar'} d={barPath(x + (band - barWidth) / 2, barWidth, y(0), y(point.amount))} />
                )}
                {i % labelEvery === (points.length - 1) % labelEvery && (
                  <text className="chart-tick" x={x + band / 2} y={HEIGHT - 8} textAnchor="middle">
                    {date(`${point.day}T00:00:00Z`, 'shortDate')}
                  </text>
                )}
                <rect
                  className="chart-hit"
                  x={x}
                  y={MARGIN.top}
                  width={band}
                  height={innerHeight}
                  onPointerEnter={() => setHovered(i)}
                  onPointerLeave={() => setHovered((current) => (current === i ? null : current))}
                />
              </g>
            );
          })}
          <line className="chart-axis" x1={MARGIN.left} x2={width - MARGIN.right} y1={y(0)} y2={y(0)} />
        </svg>
        {active && hovered !== null && (
          <div className="chart-tooltip" style={{ left: Math.min(MARGIN.left + (hovered + 0.5) * band, width - 90), top: Math.max(y(Math.max(active.amount, 0)) - 52, 0) }}>
            <strong>
              <Money amount={active.amount} currency={currency} />
            </strong>
            <span>{date(`${active.day}T00:00:00Z`)}</span>
          </div>
        )}
      </div>
      <button type="button" className="link-button chart-table-toggle" aria-expanded={showTable} onClick={() => setShowTable((shown) => !shown)}>
        {showTable ? t('common.hideTable') : t('common.showTable')}
      </button>
      {showTable && (
        <table className="table table-compact">
          <tbody>
            {points
              .filter((point) => point.amount !== 0)
              .map((point) => (
                <tr key={point.day}>
                  <td>{date(`${point.day}T00:00:00Z`)}</td>
                  <td className="cell-num">
                    <Money amount={point.amount} currency={currency} />
                  </td>
                </tr>
              ))}
          </tbody>
        </table>
      )}
    </div>
  );
}
