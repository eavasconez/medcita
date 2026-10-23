import React from 'react';
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend } from 'recharts';
import { chartPoints } from '../utils/vitals';

const formatDay = (ms) => new Date(ms).toLocaleDateString([], { month: 'short', day: 'numeric', year: '2-digit' });

// One metric of the patient over time: a line per value (two for the blood pressure).
const VitalsChart = ({ readings, metric }) => {
  const points = chartPoints(readings, metric);
  if (points.length === 0) return <p className="py-10 text-center text-sm font-medium text-slate-300">No {metric.label.toLowerCase()} recorded yet</p>;

  return (
    <div role="img" aria-label={`${metric.label} over time`}>
      <p className="text-[10px] font-black uppercase tracking-widest text-slate-400 mb-1">{metric.label} ({metric.unit})</p>
      <div className="h-64">
      <ResponsiveContainer width="100%" height="100%">
        <LineChart data={points} margin={{ top: 8, right: 16, bottom: 0, left: 0 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
          <XAxis dataKey="at" type="number" scale="time" domain={['dataMin', 'dataMax']} tickFormatter={formatDay} tick={{ fontSize: 11, fill: '#94a3b8' }} />
          <YAxis domain={['auto', 'auto']} tick={{ fontSize: 11, fill: '#94a3b8' }} width={44} />
          <Tooltip labelFormatter={formatDay} formatter={(value, name) => [`${value} ${metric.unit}`, name]} />
          {metric.lines.length > 1 && <Legend />}
          {metric.lines.map((line) => (
            <Line key={line.key} type="monotone" dataKey={line.key} name={line.label} stroke={line.color} strokeWidth={2.5} dot={{ r: 4 }} connectNulls isAnimationActive={false} />
          ))}
        </LineChart>
      </ResponsiveContainer>
      </div>
    </div>
  );
};

export default VitalsChart;
