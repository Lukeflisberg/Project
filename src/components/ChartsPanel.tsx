import { useEffect, useMemo, useState } from 'react';
import { useApp } from '../context/AppContext';
import { calculateTotalTaskDuration, calculateMonthlyTaskDuration, createPeriodBoundaries, calculateProductionPerPeriod, calculateDemandPerPeriod, getMonthTimeWindow, calculateProductionForMonth, calculateProductionPerTeam } from '../helper/chartUtils';
import { ResponsiveContainer, ComposedChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Legend, BarChart } from 'recharts';

// Color palette
const COLORS = {
  demand: '#6B7280', // gray-500
  production: '#10B981', // emerald-500
  shortage: '#ff8d8dff', // red-500
  surplus: '#E5E7EB',
  grid: '#E5E7EB', // gray-200
};

function usePeriods() {
  const { state } = useApp();
  const periodNames = useMemo(() => state.periods.map(p => p.name), [state.periods]);
  return periodNames;
}

function DemandProductionChart({ resource }: { resource: string | null }) {
  const { state } = useApp();
  const periodNames = usePeriods();

  const series = useMemo(() => {
    const n = periodNames.length;
    if (!n) return [] as { name: string; production: number; demand: number; productionSurplus: number; demandSurplus: number }[];

    const boundaries = createPeriodBoundaries(state.periods);
    const prodMap = calculateProductionPerPeriod(state.tasks, boundaries); 
    const demMap = calculateDemandPerPeriod(state.demand); 

    const keys = Array.from(new Set([...Object.keys(prodMap), ...Object.keys(demMap)]));
    const res = resource && keys.includes(resource) ? resource : (keys[0] ?? null);
    if (!res) return [];

    // Get arrays for the selected resource
    const prod = prodMap[res] ?? [];
    const dem = demMap[res] ?? [];

    // Calculate surpluses and build series with accumulation
    const result = [];
    let cumulativeSurplus = 0;

    for (let i = 0; i < periodNames.length; i++) {
      const p = prod[i] || 0;
      const d = dem[i] || 0;
      
      // Calculate new surplus for this period
      const currentSurplus = p - d;
      const newCumulativeSurplus = cumulativeSurplus + currentSurplus;
      
      // Determine how to display surplus in stacked chart
      const productionSurplus = Math.max(0, cumulativeSurplus);
      const demandSurplus = Math.max(0, -cumulativeSurplus);

      result.push({
        name: periodNames[i],
        production: p,
        demand: d,
        productionSurplus: productionSurplus,
        demandSurplus: demandSurplus,
      });

      // Update cumulative surplus for next iteration
      cumulativeSurplus = newCumulativeSurplus;
    }

    return result;
  }, [periodNames, state.periods, state.tasks, state.demand, resource]);

  if (!series.length) {
    return <div className="flex items-center justify-center h-64 text-sm text-gray-500">No period/demand/production data available.</div>;
  }

  // Find max value for domain
  const maxVal = series.reduce((m, r) => Math.max(m, r.production + r.productionSurplus, r.demand + r.demandSurplus), 1);
  const paddedMax = Math.ceil(maxVal * 1.1);

  return (
    <div className="w-full h-80">
      <ResponsiveContainer width="100%" height="100%">
        <ComposedChart 
          data={series} 
          margin={{ top: 10, right: 20, bottom: 10, left: 0 }}
          barCategoryGap="40%"
          barGap={2} 
        >
          <CartesianGrid stroke={COLORS.grid} />
          <XAxis dataKey="name" tick={{ fontSize: 11 }} />
          <YAxis 
            domain={[0, paddedMax]} 
            allowDataOverflow={false} 
            tick={{ fontSize: 11 }}
          />
          <Tooltip
            formatter={(value: any) => Number(value).toFixed(2)}
          />
          <Legend />
          
          <Bar dataKey="productionSurplus" name="Surplus" fill={COLORS.surplus} barSize={20} stackId="production" />
          <Bar dataKey="production" name="Production" fill={COLORS.production} barSize={20} stackId="production" />
          
          <Bar dataKey="demandSurplus" name="Shortage" fill={COLORS.shortage} barSize={20} stackId="demand" />
          <Bar dataKey="demand" name="Demand" fill={COLORS.demand} barSize={20} stackId="demand" />
        </ComposedChart>
      </ResponsiveContainer>
    </div>
  );
}

function TeamProductionChart({ monthId }: { monthId: string | null }) {
  const { state } = useApp();

  const data = useMemo(() => {
    if (!monthId) {
      return [];
    }

    const monthlyProductionData = calculateProductionPerTeam(
      state.tasks,
       monthId,
        state.months, 
        createPeriodBoundaries(state.periods)
    );

    // Transform the team's products into chart data with product names on x-axis
    return monthlyProductionData.map(({ teamId, volume }) => ({
      name: teamId,
      quantity: volume
    }));
  }, [state.tasks, state.months, state.periods, monthId]);

  if (!data.length) {
    return (
      <div className="flex items-center justify-center h-64 text-sm text-gray-500">
        No production data available for this team.
      </div>
    );
  }

  return (
    <div className="w-full h-80">
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={data} margin={{ top: 10, right: 20, bottom: 10, left: 0 }}>
          <CartesianGrid stroke={COLORS.grid} />
          <XAxis 
            dataKey="name" 
            tick={{ fontSize: 11 }}
            interval={0}
            angle={-45}
            textAnchor="end"
          />
          <YAxis tick={{ fontSize: 11 }} />
          <Tooltip 
            formatter={(value: any) => Number(value).toFixed(2)}
          />
          <Legend />
          <Bar 
            dataKey="quantity" 
            name="Production Quantity"
            fill="#10B981"
          />
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}

function MonthlyProductionChart({ monthId }: { monthId: string | null }) {
  const { state } = useApp();

  const data = useMemo(() => {
    if (!monthId) {
      return [];
    }

    const monthlyProductionData = calculateProductionForMonth(
      state.tasks, 
      monthId, 
      state.months, 
      createPeriodBoundaries(state.periods)
    );
    console.log("data: ", monthlyProductionData);

    // Transform the products object into chart data with product names on x-axis
    return Object.entries(monthlyProductionData.products).map(([productName, quantity]) => ({
      name: productName,
      quantity: quantity
    }));
  }, [state.tasks, state.months, state.periods, monthId]);

  if (!data.length) {
    return (
      <div className="flex items-center justify-center h-64 text-sm text-gray-500">
        No production data available for this month.
      </div>
    );
  }

  return (
    <div className="w-full h-80">
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={data} margin={{ top: 10, right: 20, bottom: 10, left: 0 }}>
          <CartesianGrid stroke={COLORS.grid} />
          <XAxis 
            dataKey="name" 
            tick={{ fontSize: 11 }}
            interval={0}
            angle={-45}
            textAnchor="end"
          />
          <YAxis tick={{ fontSize: 11 }} />
          <Tooltip 
            formatter={(value: any) => Number(value).toFixed(2)}
          />
          <Legend />
          <Bar 
            dataKey="quantity" 
            name="Production Quantity"
            fill="#EC4899"
          />
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}

function WorkEfficiencyChart({ monthId }: { monthId: string | null }) {
  const { state } = useApp();

  const data = useMemo(() => {
    // Determine total available hours based on selected month
    let totalAvailable = 0;
    let relevantTasks = state.tasks;

    if (monthId === 'all') {
      totalAvailable = state.totalHours > 0
        ? state.totalHours 
        : state.periods.reduce((s, p) => s + p.length_h, 0);
    } else {
      // Find the selected month
      const month = state.months?.find(m => m.monthID === monthId);
      if (month) {
        // Get periods for this month
        const monthPeriods = state.periods.filter(p => month.periods.includes(p.id));
        totalAvailable = monthPeriods.reduce((sum, p) => sum + p.length_h, 0);
      }
    }

    const items = state.teams.map(team => {
      const teamTasks = relevantTasks.filter(t => t.duration.teamId === team.id);

      let used = 0;
      if (monthId === 'all') {
        used = calculateTotalTaskDuration(teamTasks);
      } else {
        const month = state.months?.find(m => m.monthID === monthId);
        if (month) {
          const monthStartEnd = getMonthTimeWindow(month.monthID, state.months, createPeriodBoundaries(state.periods));
          used = calculateMonthlyTaskDuration(monthStartEnd, teamTasks);
        }
      }

      const percent = totalAvailable > 0 ? (used / totalAvailable) * 100 : 0;
      return { 
        name: team.id, 
        value: Number(Math.min(100, Math.max(0, percent)).toFixed(2)),
        used: Number(used.toFixed(2)),
        total: Number(totalAvailable.toFixed(2))
      };
    });

    return items;
  }, [state.tasks, state.teams, state.totalHours, state.periods, state.months, monthId]);

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

export function ChartsPanel() {
  const { state } = useApp();
  const [tab, setTab] = useState<'DemandProductionChart' | 'TeamProductionChart' | 'WorkEfficiencyChart' | 'MonthlyProductionChart'>('DemandProductionChart');

  const isEmpty = !state.periods.length && !state.tasks.length && !state.teams.length && !state.demand.length;

  // Resource dropdown options derived from state.assortments_graph
  const resources = useMemo(() => {
    return (state.assortments_graph || [])
      .filter(a => a.include === 1)
      .map(a => a.assortment)
      .sort();
  }, [state.assortments_graph]);

  // Dropdown options for DemandProductionChart
  const [selectedResource, setSelectedResource] = useState<string | null>(null);
  useEffect(() => {
    // Default to first resource when options change
    if (!selectedResource || !resources.includes(selectedResource)) {
      setSelectedResource(resources[0] ?? null);
    }
  }, [resources, selectedResource]);

  // Dropdown options for TeamProductionChart
  const [selectedTeamProdMonth, setSelectedTeamProdMonth] = useState<string>('all');
  useEffect(() => {
    // Default to 'all' if selected month not in list
    const availableMonths = state.months?.map(m => m.monthID) ?? [];
    if (selectedTeamProdMonth !== 'all' && !availableMonths.includes(selectedTeamProdMonth!)) {
      setSelectedTeamProdMonth('all');
    }
  }, [state.months, selectedTeamProdMonth]);

  // Dropdown options for WorkEfficiencyChart
  const [selectedWorkEffMonth, setSelectedWorkEffMonth] = useState<string>('all');
  useEffect(() => {
    // Default to 'all' if selected month not in list
    const availableMonths = state.months?.map(m => m.monthID) ?? [];
    if (selectedWorkEffMonth !== 'all' && !availableMonths.includes(selectedWorkEffMonth!)) {
      setSelectedWorkEffMonth('all');
    }
  }, [state.months, selectedWorkEffMonth]);

  // Dropdown options for MonthlyProductionChart
  const [selectedMonthlyProdMonth, setSelectedMonthlyProdMonth] = useState<string>('all');
  useEffect(() => {
    // Default to 'all' if selected month not in list
    const availableMonths = state.months?.map(m => m.monthID) ?? [];
    if (selectedMonthlyProdMonth !== 'all' && !availableMonths.includes(selectedMonthlyProdMonth!)) {
      setSelectedMonthlyProdMonth('all');
    }
  }, [state.months, selectedMonthlyProdMonth]);

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
            onClick={() => setTab('TeamProductionChart')}
            className={`px-3 py-1.5 text-sm rounded ${tab === 'TeamProductionChart' ? 'bg-emerald-100 text-emerald-700' : 'hover:bg-gray-100 text-gray-700'}`}
          >
            Team Production
          </button>
          <button
            onClick={() => setTab('WorkEfficiencyChart')}
            className={`px-3 py-1.5 text-sm rounded ${tab === 'WorkEfficiencyChart' ? 'bg-emerald-100 text-emerald-700' : 'hover:bg-gray-100 text-gray-700'}`}
          >
            Work Efficiency
          </button>
          <button
            onClick={() => setTab('MonthlyProductionChart')}
            className={`px-3 py-1.5 text-sm rounded ${tab === 'MonthlyProductionChart' ? 'bg-emerald-100 text-emerald-700' : 'hover:bg-gray-100 text-gray-700'}`}
          >
            Monthly Production
          </button>
        </div>
        
        {/* Conditional dropdown based on active tab */}
        {tab === 'DemandProductionChart' && resources.length > 0 && (
          <div className="flex items-center gap-2">
            <label className="text-xs text-gray-500">Assortment:</label>
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
        )}
        
        {tab === 'TeamProductionChart' && (
          <div className="flex items-center gap-2">
            <label className="text-xs text-gray-500">Month:</label>
            <select
              value={selectedTeamProdMonth ?? ''}
              onChange={e => setSelectedTeamProdMonth(e.target.value)}
              className="px-2 py-1 text-sm border rounded"
            >
              <option value="all">All Months</option>
              {state.months?.map(month => (
                <option key={month.monthID} value={month.monthID}>
                  {month.monthID}
                </option>
              ))}
            </select>
          </div>
        )}

        {tab === 'WorkEfficiencyChart' && (
          <div className="flex items-center gap-2">
            <label className="text-xs text-gray-500">Month:</label>
            <select
              value={selectedWorkEffMonth ?? 'all'}
              onChange={e => setSelectedWorkEffMonth(e.target.value)}
              className="px-2 py-1 text-sm border rounded"
            >
              <option value="all">All Months</option>
              {state.months?.map(month => (
                <option key={month.monthID} value={month.monthID}>
                  {month.monthID}
                </option>
              ))}
            </select>
          </div>
        )}

        {tab === 'MonthlyProductionChart' && (
          <div className="flex items-center gap-2">
            <label className="text-xs text-gray-500">Month:</label>
            <select
              value={selectedMonthlyProdMonth ?? 'all'}
              onChange={e => setSelectedMonthlyProdMonth(e.target.value)}
              className="px-2 py-1 text-sm border rounded"
            >
              <option value="all">All Months</option>
              {state.months?.map(month => (
                <option key={month.monthID} value={month.monthID}>
                  {month.monthID}
                </option>
              ))}
            </select>
          </div>
        )}
      </div>

      <div className="p-2">
        {isEmpty ? (
          <div className="h-64 flex items-center justify-center text-gray-500 text-sm">Load data to view charts.</div>
        ) : tab === 'DemandProductionChart' ? (
          <DemandProductionChart resource={selectedResource} />
        ) : tab === 'TeamProductionChart' ? (
          <TeamProductionChart monthId={selectedTeamProdMonth} />
        ) : tab === 'WorkEfficiencyChart' ? (
          <WorkEfficiencyChart monthId={selectedWorkEffMonth} />
        ) : tab === 'MonthlyProductionChart' ? (
          <MonthlyProductionChart monthId={selectedMonthlyProdMonth} />
        ) : null}
      </div>
    </div>
  );
}

export default ChartsPanel;