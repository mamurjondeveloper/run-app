'use client';

interface ChartPoint {
  x: number;
  y: number;
}

interface RunChartProps {
  points: ChartPoint[];
  height?: number;
  color?: string;
  yFormatter?: (v: number) => string;
  xFormatter?: (v: number) => string;
}

const VIEW_WIDTH = 600;
const PADDING = { top: 10, right: 10, bottom: 20, left: 32 };

export default function RunChart({ points, height = 160, color = '#22c55e', yFormatter, xFormatter }: RunChartProps) {
  if (points.length < 2) return null;

  const xs = points.map((p) => p.x);
  const ys = points.map((p) => p.y);
  const minX = Math.min(...xs);
  const maxX = Math.max(...xs);
  const minY = 0;
  const maxY = Math.max(...ys) * 1.15 || 1;

  const plotWidth = VIEW_WIDTH - PADDING.left - PADDING.right;
  const plotHeight = height - PADDING.top - PADDING.bottom;

  const scaleX = (x: number) => PADDING.left + ((x - minX) / (maxX - minX || 1)) * plotWidth;
  const scaleY = (y: number) => height - PADDING.bottom - ((y - minY) / (maxY - minY || 1)) * plotHeight;

  const linePath = points.map((p, i) => `${i === 0 ? 'M' : 'L'} ${scaleX(p.x).toFixed(1)} ${scaleY(p.y).toFixed(1)}`).join(' ');
  const areaPath = `${linePath} L ${scaleX(maxX).toFixed(1)} ${(height - PADDING.bottom).toFixed(1)} L ${scaleX(minX).toFixed(1)} ${(height - PADDING.bottom).toFixed(1)} Z`;

  const yTicks = [0, 0.5, 1].map((f) => minY + f * (maxY - minY));

  return (
    <svg viewBox={`0 0 ${VIEW_WIDTH} ${height}`} className="w-full" style={{ height }} preserveAspectRatio="none">
      {yTicks.map((t, i) => (
        <g key={i}>
          <line x1={PADDING.left} x2={VIEW_WIDTH - PADDING.right} y1={scaleY(t)} y2={scaleY(t)} stroke="#27272a" strokeWidth={1} />
          <text x={PADDING.left - 6} y={scaleY(t) + 3} fontSize={9} fill="#71717a" textAnchor="end">
            {yFormatter ? yFormatter(t) : Math.round(t)}
          </text>
        </g>
      ))}
      <path d={areaPath} fill={color} fillOpacity={0.12} stroke="none" />
      <path d={linePath} fill="none" stroke={color} strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" />
      <text x={PADDING.left} y={height - 4} fontSize={9} fill="#71717a">
        {xFormatter ? xFormatter(minX) : minX.toFixed(1)}
      </text>
      <text x={VIEW_WIDTH - PADDING.right} y={height - 4} fontSize={9} fill="#71717a" textAnchor="end">
        {xFormatter ? xFormatter(maxX) : maxX.toFixed(1)}
      </text>
    </svg>
  );
}
