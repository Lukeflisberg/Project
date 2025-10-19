import { useEffect, useMemo, useState } from 'react';
import { useApp } from '../context/AppContext';
import { calcDurationOf, calcMonthlyDurations, createPeriodBoundaries, getProductionByProduct, getDemandByProduct, getProductionByTeam, calcTotalCostDistribution } from '../helper/chartUtils';
import { ResponsiveContainer, ComposedChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Legend, BarChart, PieChart, Pie, Cell } from 'recharts';

// Color palette
const COLORS = {
  demand: '#6B7280', // gray-500
  production: '#10B981', // emerald-500
  surplus: '#EF4444', // red-500
  grid: '#E5E7EB', // gray-200
};

// Pie chart colors
const PIE_COLORS = ['#10B981', '#3B82F6', '#F59E0B', '#EF4444', '#8B5CF6', '#EC4899'];

function usePeriods() {
  const { state } = useApp();
  const periodIds = useMemo(() => state.periods.map(p => p.id), [state.periods]);
  return periodIds;
}

// Demand vs Production with surplus carryover to next period
function DemandProductionChart({ resource }: { resource: string | null }) {
  const { state } = useApp();
  const periodIds = usePeriods();

  const series = useMemo(() => {
    const n = periodIds.length;
    if (!n) return [] as { name: string; production: number; demand: number; productionSurplus: number; demandSurplus: number }[];

    const boundaries = createPeriodBoundaries(state.periods);
    const prodMap = getProductionByProduct(state.tasks, boundaries); 
    const demMap = getDemandByProduct(state.demand); 

    const keys = Array.from(new Set([...Object.keys(prodMap), ...Object.keys(demMap)]));
    const res = resource && keys.includes(resource) ? resource : (keys[0] ?? null);
    if (!res) return [];

    // Get arrays for the selected resource
    const prod = prodMap[res] ?? [];
    const dem = demMap[res] ?? [];

    // Calculate surpluses and build series
    const result = [];

    for (let i = 0; i < periodIds.length; i++) {
      const p = prod[i] || 0;
      const d = dem[i] || 0;
      
      // Calculate surplus from the PREVIOUS period
      let prevSurplus = 0;
      if (i > 0) {
        const prevP = prod[i - 1] || 0;
        const prevD = dem[i - 1] || 0;
        prevSurplus = prevP - prevD;
      }

      // Determine where to stack the surplus based on which was larger in the PREVIOUS period
      const prevProductionLarger = i === 0 ? true : (prod[i - 1] || 0) >= (dem[i - 1] || 0);

      result.push({
        name: periodIds[i].toUpperCase(),
        production: p,
        demand: d,
        productionSurplus: prevProductionLarger && prevSurplus > 0 ? prevSurplus : 0,
        demandSurplus: !prevProductionLarger && prevSurplus < 0 ? Math.abs(prevSurplus) : 0,
      });
    }

    return result;
  }, [periodIds, state.periods, state.tasks, state.demand, resource]);

  if (!series.length) {
    return <div className="flex items-center justify-center h-64 text-sm text-gray-500">No period/demand/production data available.</div>;
  }

  // Find max value for domain
  const maxVal = series.reduce((m, r) => Math.max(m, r.production + r.productionSurplus, r.demand + r.demandSurplus), 1);
  const paddedMax = Math.ceil(maxVal * 1.1);

  return (
    <div className="w-full h-80">
      <ResponsiveContainer width="100%" height="100%">
        <ComposedChart data={series} margin={{ top: 10, right: 20, bottom: 10, left: 0 }}>
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
          
          <Bar dataKey="production" name="Production" fill={COLORS.production} barSize={20} stackId="production" />
          <Bar dataKey="productionSurplus" name="Surplus (to Prod)" fill={COLORS.grid} barSize={20} stackId="production" />
          
          <Bar dataKey="demand" name="Demand" fill={COLORS.demand} barSize={20} stackId="demand" />
          <Bar dataKey="demandSurplus" name="Surplus (to Dem)" fill={COLORS.grid} barSize={20} stackId="demand" />
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

function TeamProductionChart({ teamId }: { teamId: string | null }) {
  const { state } = useApp();

  const data = useMemo(() => {
    const productionByTeam = getProductionByTeam(state.tasks);
    
    if (!productionByTeam || productionByTeam.length === 0) {
      return [];
    }

    // Find the selected team or use the first one
    const selectedTeam = productionByTeam.find(t => t.teamId === teamId) || productionByTeam[0];
    
    if (!selectedTeam) return [];

    // Transform the team's products into chart data with product names on x-axis
    return Object.entries(selectedTeam.products).map(([productName, quantity]) => ({
      name: productName,
      quantity: quantity
    }));
  }, [state.tasks, teamId]);

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
        <BarChart data={data} margin={{ top: 10, right: 20, bottom: 60, left: 0 }}>
          <CartesianGrid stroke={COLORS.grid} />
          <XAxis 
            dataKey="name" 
            tick={{ fontSize: 11 }}
            interval={0}
            angle={-45}
            textAnchor="end"
            height={80}
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

function CostDistributionChart() {
  const { state } = useApp();

  const data = useMemo(() => {
    // Calculate cost data from state
    const costData = calcTotalCostDistribution(state.tasks, state.teams, state.demand, state.periods, state.distances);
    
    if (!costData) {
      return [];
    }

    const { harvestCosts, wheelingCosts, trailerCosts, demandCosts, industryValue } = costData;

    // Calculate absolute values for pie chart (showing cost contributions)
    const costs = [
      { name: 'Harvest Costs', value: Math.abs(harvestCosts), displayValue: harvestCosts },
      { name: 'Wheeling Costs', value: Math.abs(wheelingCosts), displayValue: wheelingCosts },
      { name: 'Trailer Costs', value: Math.abs(trailerCosts), displayValue: trailerCosts },
      { name: 'Demand Costs', value: Math.abs(demandCosts), displayValue: demandCosts },
      { name: 'Industry Value', value: Math.abs(industryValue), displayValue: industryValue }
    ].filter(item => item.value > 0); // Only show non-zero items

    return costs;
  }, [state.tasks, state.teams, state.demand, state.periods, state.distances]);

  if (!data.length) {
    return (
      <div className="flex items-center justify-center h-64 text-sm text-gray-500">
        No cost data available.
      </div>
    );
  }

  const formatCurrency = (value: number) => {
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: 'USD',
      minimumFractionDigits: 0,
      maximumFractionDigits: 0
    }).format(value);
  };

  const CustomTooltip = ({ active, payload }: any) => {
    if (active && payload && payload.length) {
      const data = payload[0].payload;
      const total = payload[0].payload.total || data.value;
      const percentage = ((data.value / total) * 100).toFixed(1);
      return (
        <div className="bg-white p-3 border border-gray-300 rounded shadow-lg">
          <p className="font-semibold mb-1">{data.name}</p>
          <p className="text-sm">{formatCurrency(data.displayValue)}</p>
          <p className="text-sm text-gray-600">{percentage}% of total costs</p>
        </div>
      );
    }
    return null;
  };

  const renderLabel = ({ name, percent }: any) => {
    if (percent < 0.05) return ''; // Don't show label if less than 5%
    return `${name}: ${(percent * 100).toFixed(0)}%`;
  };

  // Calculate total for display
  const total = useMemo(() => {
    const costData = calcTotalCostDistribution(state.tasks, state.teams, state.demand, state.periods, state.distances);
    return costData 
      ? costData.harvestCosts + costData.wheelingCosts + costData.trailerCosts + costData.demandCosts - costData.industryValue
      : 0;
  }, [state.tasks, state.teams, state.demand, state.periods, state.distances]);

  return (
    <div className="w-full h-80">
      <div className="text-center mb-2">
        <p className="text-sm text-gray-600">Total Cost: {formatCurrency(total)}</p>
      </div>
      <ResponsiveContainer width="100%" height="100%">
        <PieChart>
          <Pie
            data={data}
            cx="50%"
            cy="50%"
            labelLine={false}
            label={renderLabel}
            outerRadius={100}
            fill="#8884d8"
            dataKey="value"
          >
            {data.map((_, index) => (
              <Cell key={`cell-${index}`} fill={PIE_COLORS[index % PIE_COLORS.length]} />
            ))}
          </Pie>
          <Tooltip content={<CustomTooltip />} />
          <Legend 
            verticalAlign="bottom" 
            height={36}
            formatter={(value, entry: any) => `${value}: ${formatCurrency(entry.payload.displayValue)}`}
          />
        </PieChart>
      </ResponsiveContainer>
    </div>
  );
}

export function ChartsPanel() {
  const { state } = useApp();
  const [tab, setTab] = useState<'DemandProductionChart' | 'WorkEfficiencyChart' | 'MonthlyEfficiencyChart' | 'TeamProductionChart' | 'CostDistributionChart'>('DemandProductionChart');

  const isEmpty = !state.periods.length && !state.tasks.length && !state.teams.length && !state.demand.length;

  // Resource dropdown options derived from cumulative maps (for DemandProductionChart)
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

  // Team dropdown options (for TeamProductionChart)
  const teams = useMemo(() => {
    const productionByTeam = getProductionByTeam(state.tasks);
    return productionByTeam.map(t => t.teamId).sort();
  }, [state.tasks]);

  const [selectedTeam, setSelectedTeam] = useState<string | null>(null);
  useEffect(() => {
    // Default to first team when options change
    if (!selectedTeam || !teams.includes(selectedTeam)) {
      setSelectedTeam(teams[0] ?? null);
    }
  }, [teams, selectedTeam]);

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
            onClick={() => setTab('MonthlyEfficiencyChart')}
            className={`px-3 py-1.5 text-sm rounded ${tab === 'MonthlyEfficiencyChart' ? 'bg-emerald-100 text-emerald-700' : 'hover:bg-gray-100 text-gray-700'}`}
          >
            Monthly Efficiency
          </button>
          <button
            onClick={() => setTab('CostDistributionChart')}
            className={`px-3 py-1.5 text-sm rounded ${tab === 'CostDistributionChart' ? 'bg-emerald-100 text-emerald-700' : 'hover:bg-gray-100 text-gray-700'}`}
          >
            Cost Distribution
          </button>
        </div>
        
        {/* Conditional dropdown based on active tab */}
        {tab === 'DemandProductionChart' && resources.length > 0 && (
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
        )}
        
        {tab === 'TeamProductionChart' && teams.length > 0 && (
          <div className="flex items-center gap-2">
            <label className="text-xs text-gray-500">Team:</label>
            <select
              value={selectedTeam ?? ''}
              onChange={e => setSelectedTeam(e.target.value || null)}
              className="px-2 py-1 text-sm border rounded"
            >
              {teams.map(t => (
                <option key={t} value={t}>{t}</option>
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
        ) : tab === 'WorkEfficiencyChart' ? (
          <WorkEfficiencyChart />
        ) : tab === 'MonthlyEfficiencyChart' ? (
          <MonthlyEfficiencyChart />
        ) : tab === 'TeamProductionChart' ? (
          <TeamProductionChart teamId={selectedTeam} />
        ) : tab === 'CostDistributionChart' ? (
          <CostDistributionChart />
        ) : null}
      </div>
    </div>
  );
}

export default ChartsPanel;