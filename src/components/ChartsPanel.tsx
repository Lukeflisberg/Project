import React, { useEffect, useMemo, useState } from 'react';
import { useApp } from '../context/AppContext';
import { calcDurationOf, calcMonthlyDurations, createPeriodBoundaries, getProductionByProduct, getDemandByProduct } from '../helper/chartUtils';
import { ResponsiveContainer, ComposedChart, Bar, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend } from 'recharts';

// Color palette
const COLORS = {
  demand: '#6B7280', // gray-500
  production: '#10B981', // emerald-500
  total: '#EF4444', // red-500
  grid: '#E5E7EB', // gray-200
};

function usePeriods() {
  const { state } = useApp();
  const periodIds = useMemo(() => state.periods.map(p => p.id), [state.periods]);
  return periodIds;
}

// Demand vs Production with Total line for a selected resource
function DemandProductionChart({ resource }: { resource: string | null }) {
  const { state } = useApp();
  const periodIds = usePeriods();

  const series = useMemo(() => {
    const n = periodIds.length;
    if (!n) return [] as { name: string; production: number; demand: number; total: number }[];

    const boundaries = createPeriodBoundaries(state.periods);
    const prodMap = getProductionByProduct(state.tasks, boundaries); 
    const demMap = getDemandByProduct(state.demand); 

    const keys = Array.from(new Set([...Object.keys(prodMap), ...Object.keys(demMap)]));
    const res = resource && keys.includes(resource) ? resource : (keys[0] ?? null);
    if (!res) return [];

    // Get arrays for the selected resource
    const prod = prodMap[res] ?? [];
    const dem = demMap[res] ?? [];

    // Map periods to their data
    // Skip P0 (the initial boundary) and map actual periods
    return periodIds.map((pid, i) => {
      const p = prod[i] || 0;
      const d = dem[i] || 0;

      return {
        name: pid.toUpperCase(),
        production: p,           // positive
        demandOffset: -p,        // negative offset to bring us back to 0
        demand: -d,              // negative for demand below axis
        total: p - d,
      };
    });
  }, [periodIds, state.periods, state.tasks, state.demand, resource]);

  if (!series.length) {
    return <div className="flex items-center justify-center h-64 text-sm text-gray-500">No period/demand/production data available.</div>;
  }

  // Symmetric domain across all values with padding
  const maxAbs = series.reduce((m, r) => Math.max(m, Math.abs(r.production), Math.abs(r.demand), Math.abs(r.total)), 1);
  const paddedMax = Math.ceil(maxAbs); // Add 10% padding and round up
  const domain: [number, number] = [-paddedMax, paddedMax];

  return (
    <div className="w-full h-80">
      <ResponsiveContainer width="100%" height="100%">
        <ComposedChart data={series} margin={{ top: 10, right: 20, bottom: 10, left: 0 }} barCategoryGap="10%">
          <CartesianGrid stroke={COLORS.grid} />
          <XAxis dataKey="name" tick={{ fontSize: 11 }} />
          <YAxis 
            domain={domain} 
            allowDataOverflow={false} 
            tick={{ fontSize: 11 }}
            ticks={[-paddedMax, -paddedMax/2, 0, paddedMax/2, paddedMax]} 
          />
          <Tooltip
            formatter={(value: any, name: any) => {
              const v = Number(value);
              if (name === 'Demand') return [Math.abs(v).toFixed(2), name];
              return [v.toFixed(2), name];
            }}
          />
          <Legend />

          <Bar dataKey="production" name="Production" fill={COLORS.production} barSize={25} stackId="stack" />
          <Bar dataKey="demandOffset" fill="transparent" barSize={25} stackId="stack" />
          <Bar dataKey="demand" name="Demand" fill={COLORS.demand} barSize={25} stackId="stack" />
          <Line type="monotone" dataKey="total" name="Total (Prod - Dem)" stroke={COLORS.total} strokeWidth={2} dot={{ r: 4 }} />
        </ComposedChart>
      </ResponsiveContainer>
    </div>
  );
}

function WorkEfficiencyChart() {
  const { state } = useApp();

  const data = useMemo(() => {
    const totalAvailable = state.totalHours > 0
      ? state.totalHours
      : state.periods.reduce((s, p) => s + p.length_h, 0);

    const items = state.teams.map(team => {
      const teamTasks = state.tasks.filter(t => t.duration.teamId === team.id);
      const used = calcDurationOf(teamTasks);
      const percent = totalAvailable > 0 ? (used / totalAvailable) * 100 : 0;
      return { 
        name: team.id, 
        value: Number(Math.min(100, Math.max(0, percent)).toFixed(2)),
        used: Number(used.toFixed(2)),
        total: Number(totalAvailable.toFixed(2))
      };
    });

    return items;
  }, [state.tasks, state.teams, state.totalHours, state.periods]);

  if (!data.length) {
    return <div className="flex items-center justify-center h-64 text-sm text-gray-500">No teams/tasks to compute efficiency.</div>;
  }

  const CustomTooltip = ({ active, payload }: any) => {
    if (active && payload && payload.length) {
      const data = payload[0].payload;
      return (
        <div className="bg-white p-3 border border-gray-300 rounded shadow-lg">
          <p className="font-semibold mb-1">{data.name}</p>
          <p className="text-sm">Efficiency: {data.value.toFixed(2)}%</p>
          <p className="text-sm">Used: {Math.floor(data.used)}h {Math.round((data.used % 1) * 60)}m</p>
          <p className="text-sm">Total: {Math.floor(data.total)}h {Math.round((data.total % 1) * 60)}m</p>
        </div>
      );
    }
    return null;
  };

  return (
    <div className="w-full h-80">
      <ResponsiveContainer width="100%" height="100%">
        <ComposedChart data={data} margin={{ top: 10, right: 20, bottom: 10, left: 0 }}>
          <CartesianGrid stroke={COLORS.grid} />
          <XAxis 
            dataKey="name" 
            tick={{ fontSize: 11 }}
            interval={0}
            angle={-45}
            textAnchor="end"
            height={60}  // Give more space for angled labels
          />
          <YAxis domain={[0, 100]} tick={{ fontSize: 11 }} unit="%" />
          <Tooltip content={<CustomTooltip />} />
          <Legend />
          <Bar dataKey="value" name="Efficiency" fill="#3B82F6" />
        </ComposedChart>
      </ResponsiveContainer>
    </div>
  );
}

function MonthlyEfficiencyChart() {
  const { state } = useApp();
  const boundaries = createPeriodBoundaries(state.periods);

  const data = useMemo(() => {
    if (!state.months || state.months.length === 0 || state.teams.length === 0) {
      return [];
    }

    return state.months.map(month => {
      // Calculate total available hours for this month
      const monthPeriods = state.periods.filter(p => month.periods.includes(p.id));
      const totalAvailable = monthPeriods.reduce((sum, p) => sum + p.length_h, 0);

      if (totalAvailable === 0) {
        return {
          name: month.monthID,
          value: 0,
          used: 0,
          total: totalAvailable,
          teamCount: state.teams.length
        };
      }

      // Calculate average efficiency across all teams
      let totalEfficiency = 0;
      let totalUsed = 0;

      state.teams.forEach(team => {
        const teamTasks = state.tasks.filter(t => t.duration.teamId === team.id);
        const used = calcMonthlyDurations(month, teamTasks, boundaries);
        const efficiency = (used / totalAvailable) * 100;
        
        totalEfficiency += efficiency;
        totalUsed += used;
      });

      const avgEfficiency = state.teams.length > 0 ? totalEfficiency / state.teams.length : 0;
      const avgUsed = state.teams.length > 0 ? totalUsed / state.teams.length : 0;
      
      return {
        name: month.monthID,
        value: Number(Math.min(100, Math.max(0, avgEfficiency)).toFixed(2)),
        used: Number(avgUsed.toFixed(2)),
        total: Number(totalAvailable.toFixed(2)),
        teamCount: state.teams.length
      };
    });
  }, [state.months, state.teams, state.tasks, state.periods, boundaries]);

  if (!data.length) {
    return (
      <div className="flex items-center justify-center h-64 text-sm text-gray-500">
        No monthly data to display.
      </div>
    );
  }

  const CustomTooltip = ({ active, payload }: any) => {
    if (active && payload && payload.length) {
      const data = payload[0].payload;
      return (
        <div className="bg-white p-3 border border-gray-300 rounded shadow-lg">
          <p className="font-semibold mb-1">{data.name}</p>
          <p className="text-sm">Avg Efficiency: {data.value.toFixed(1)}%</p>
          <p className="text-sm">
            Avg Used: {Math.floor(data.used)}h {Math.round((data.used % 1) * 60)}m
          </p>
          <p className="text-sm">
            Total Available: {Math.floor(data.total)}h {Math.round((data.total % 1) * 60)}m
          </p>
          <p className="text-sm text-gray-600">Teams: {data.teamCount}</p>
        </div>
      );
    }
    return null;
  };

  return (
    <div className="w-full h-80">
      <ResponsiveContainer width="100%" height="100%">
        <ComposedChart data={data} margin={{ top: 10, right: 20, bottom: 60, left: 0 }}>
          <CartesianGrid stroke={COLORS.grid} />
          <XAxis 
            dataKey="name" 
            tick={{ fontSize: 11 }}
            interval={0}
          />
          <YAxis domain={[0, 100]} tick={{ fontSize: 11 }} unit="%" />
          <Tooltip content={<CustomTooltip />} />
          <Legend />
          <Bar dataKey="value" name="Avg Efficiency" fill="#10B981" />
        </ComposedChart>
      </ResponsiveContainer>
    </div>
  );
}

export function ChartsPanel() {
  const { state } = useApp();
  const [tab, setTab] = useState<'DemandProductionChart' | 'WorkEfficiencyChart' | 'MonthlyEfficiencyChart'>('DemandProductionChart');

  const isEmpty = !state.periods.length && !state.tasks.length && !state.teams.length && !state.demand.length;

  // Resource dropdown options derived from cumulative maps
  const boundaries = useMemo(() => createPeriodBoundaries(state.periods), [state.periods]);
  const prodMap = useMemo(() => getProductionByProduct(state.tasks, boundaries), [state.tasks, boundaries]);
  const demMap = useMemo(() => getDemandByProduct(state.demand), [state.demand]);
  const resources = useMemo(() => Array.from(new Set([...Object.keys(prodMap), ...Object.keys(demMap)])).sort(), [prodMap, demMap]);

  const [selectedResource, setSelectedResource] = useState<string | null>(null);
  useEffect(() => {
    // Default to first resource when options change
    if (!selectedResource || !resources.includes(selectedResource)) {
      setSelectedResource(resources[0] ?? null);
    }
  }, [resources, selectedResource]);

  return (
    <div className="bg-white rounded-lg shadow-sm border border-gray-200">
      <div className="flex items-center justify-between px-4 py-2 border-b">
        <div className="flex gap-2">
          <button
            onClick={() => setTab('DemandProductionChart')}
            className={`px-3 py-1.5 text-sm rounded ${tab === 'DemandProductionChart' ? 'bg-emerald-100 text-emerald-700' : 'hover:bg-gray-100 text-gray-700'}`}
          >
            Demand vs Production
          </button>
          <button
            onClick={() => setTab('WorkEfficiencyChart')}
            className={`px-3 py-1.5 text-sm rounded ${tab === 'WorkEfficiencyChart' ? 'bg-emerald-100 text-emerald-700' : 'hover:bg-gray-100 text-gray-700'}`}
          >
            Work Efficiency
          </button>
          <button
            onClick={() => setTab('MonthlyEfficiencyChart')}
            className={`px-3 py-1.5 text-sm rounded ${tab === 'MonthlyEfficiencyChart' ? 'bg-emerald-100 text-emerald-700' : 'hover:bg-gray-100 text-gray-700'}`}
          >
            Monthly Efficiency
          </button>
        </div>
        <div className="flex items-center gap-2">
          <label className="text-xs text-gray-500">Resource:</label>
          <select
            value={selectedResource ?? ''}
            onChange={e => setSelectedResource(e.target.value || null)}
            className="px-2 py-1 text-sm border rounded"
          >
            {resources.map(r => (
              <option key={r} value={r}>{r}</option>
            ))}
          </select>
        </div>
      </div>

      <div className="p-2">
        {isEmpty ? (
          <div className="h-64 flex items-center justify-center text-gray-500 text-sm">Load data to view charts.</div>
        ) : tab === 'DemandProductionChart' ? (
          <DemandProductionChart resource={selectedResource} />
        ) : tab === 'WorkEfficiencyChart' ? (
          <WorkEfficiencyChart />
        ) : tab === 'MonthlyEfficiencyChart' ? (
          <MonthlyEfficiencyChart />
        ) : null}
      </div>
    </div>
  );
}

export default ChartsPanel;