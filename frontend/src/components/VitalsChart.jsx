import React from 'react';
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend } from 'recharts';
import { chartPoints } from '../utils/vitals';

// Wide enough for "100.5" or "1000" without the numbers being cut at the left edge
const AXIS_WIDTH = 56;
// The ticks of an automatic axis can come out as 82.60000000000001
const formatTick = (value) => Math.round(value * 100) / 100;

// The y axis: a little room above and below the data, on round numbers so the ticks are round too (the
// automatic axis gives ticks such as 102.05 for three weights). About five intervals, each a step of 1,
// 2 or 5 times a power of ten.
const STEPS = [0.1, 0.2, 0.5, 1, 2, 5, 10, 20, 50, 100, 200, 500];
const round = (n) => Math.round(n * 100) / 100;
function axisFor(values) {
  const min = Math.min(...values);
  const max = Math.max(...values);
  const span = max - min || Math.abs(max) * 0.1 || 1;
  const step = STEPS.find((s) => s >= (span * 1.5) / 5) || STEPS[STEPS.length - 1];
  const lo = round(Math.floor((min - span * 0.2) / step) * step);
  const hi = round(Math.ceil((max + span * 0.2) / step) * step);
  const ticks = [];
  for (let t = lo; t <= hi + step / 2; t += step) ticks.push(round(t));
  return { domain: [lo, hi], ticks };
}

const formatDay = (ms) => new Date(ms).toLocaleDateString([], { month: 'short', day: 'numeric', year: '2-digit' });

// One metric of the patient over time: a line per value (two for the blood pressure).
const VitalsChart = ({ readings, metric }) => {
  const points = chartPoints(readings, metric);
  const axis = points.length ? axisFor(metric.lines.flatMap((line) => points.map((p) => p[line.key]).filter((v) => v !== null))) : null;
  if (points.length === 0) return <p className="py-10 text-center text-sm font-medium text-slate-300">No {metric.label.toLowerCase()} recorded yet</p>;

  return (
    <div role="img" aria-label={`${metric.label} over time`}>
      <p className="text-[10px] font-black uppercase tracking-widest text-slate-400 mb-1">{metric.label} ({metric.unit})</p>
      <div className="h-64">
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={points} margin={{ top: 8, right: 24, bottom: 0, left: 4 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
            <XAxis dataKey="at" type="number" scale="time" domain={['dataMin', 'dataMax']} tickFormatter={formatDay} tick={{ fontSize: 11, fill: '#94a3b8' }} padding={{ left: 12, right: 12 }} />
            <YAxis domain={axis.domain} ticks={axis.ticks} tick={{ fontSize: 11, fill: '#94a3b8' }} tickFormatter={formatTick} width={AXIS_WIDTH} />
            <Tooltip labelFormatter={formatDay} formatter={(value, name) => [`${value} ${metric.unit}`, name]} />
            {metric.lines.length > 1 && <Legend />}
            {metric.lines.map((line) => (
              <Line key={line.key} type="linear" dataKey={line.key} name={line.label} stroke={line.color} strokeWidth={2.5} dot={{ r: 4 }} connectNulls isAnimationActive={false} />
            ))}
          </LineChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
};

export default VitalsChart;
