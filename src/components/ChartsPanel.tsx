import { useEffect, useMemo, useState } from 'react';
import { useApp } from '../context/AppContext';
import { calculateTotalTaskDuration, calculateMonthlyTaskDuration, createPeriodBoundaries, calculateProductionPerPeriod, calculateDemandPerPeriod, getMonthTimeWindow, calculateProductionForMonth, calculateProductionPerTeam } from '../helper/chartUtils';
import { ResponsiveContainer, ComposedChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Legend, BarChart } from 'recharts';

// Color palette
const COLORS = {
  demand: '#6B7280',
  production: '#10B981',
  shortage: '#ff8d8dff',
  surplus: '#E5E7EB',
  grid: '#E5E7EB',
};

// Common chart wrapper with consistent styling
function ChartContainer({ children, isEmpty }: { children: React.ReactElement; isEmpty?: boolean }) {
  if (isEmpty) {
    return <div className="flex items-center justify-center h-40 text-xs text-gray-500">No data available.</div>;
  }
  
  return (
    <div className="w-full h-56">
      <ResponsiveContainer width="100%" height="100%">
        {children}
      </ResponsiveContainer>
    </div>
  );
}

// Common chart props
const commonChartProps = {
  margin: { top: 5, right: 10, bottom: 5, left: 0 },
};

const commonXAxisProps = {
  tick: { fontSize: 10 },
  interval: 0 as const,
  angle: -45,
  textAnchor: 'end' as const,
};

const commonYAxisProps = {
  tick: { fontSize: 10 },
};

const commonLegendProps = {
  wrapperStyle: { fontSize: '11px' },
};

function DemandProductionChart({ resource, demandType }: { resource: string | null; demandType: 'min' | 'goal' }) {
  const { state } = useApp();
  const periodNames = useMemo(() => state.periods.map(p => p.name), [state.periods]);

  const series = useMemo(() => {
    if (!periodNames.length) return [];

    const boundaries = createPeriodBoundaries(state.periods);
    const prodMap = calculateProductionPerPeriod(state.tasks, boundaries, state.assortments_graph);
    const demMap = calculateDemandPerPeriod(state.demand, demandType, state.assortments_graph);

    const keys = Array.from(new Set([...Object.keys(prodMap), ...Object.keys(demMap)]));
    const res = resource && keys.includes(resource) ? resource : (keys[0] ?? null);
    if (!res) return [];

    const prod = prodMap[res] ?? [];
    const dem = demMap[res] ?? [];

    const result = [];
    let cumulativeSurplus = 0;

    for (let i = 0; i < periodNames.length; i++) {
      const p = prod[i] || 0;
      const d = dem[i] || 0;
      
      const currentSurplus = p - d;
      const newCumulativeSurplus = cumulativeSurplus + currentSurplus;
      
      result.push({
        name: periodNames[i],
        production: p,
        demand: d,
        productionSurplus: Math.max(0, cumulativeSurplus),
        demandSurplus: Math.max(0, -cumulativeSurplus),
      });

      cumulativeSurplus = newCumulativeSurplus;
    }

    return result;
  }, [periodNames, state.periods, state.tasks, state.demand, state.assortments_graph, resource, demandType]);

  const maxVal = series.reduce((m, r) => Math.max(m, r.production + r.productionSurplus, r.demand + r.demandSurplus), 1);
  const paddedMax = Math.ceil(maxVal * 1.1);

  return (
    <ChartContainer isEmpty={!series.length}>
      <ComposedChart data={series} {...commonChartProps} barCategoryGap="40%" barGap={2}>
        <CartesianGrid stroke={COLORS.grid} />
        <XAxis dataKey="name" tick={{ fontSize: 10 }} />
        <YAxis domain={[0, paddedMax]} allowDataOverflow={false} {...commonYAxisProps} />
        <Tooltip formatter={(value: any) => Number(value).toFixed(2)} />
        <Legend {...commonLegendProps} />
        
        <Bar dataKey="productionSurplus" name="Surplus" fill={COLORS.surplus} barSize={16} stackId="production" />
        <Bar dataKey="production" name="Production" fill={COLORS.production} barSize={16} stackId="production" />
        <Bar dataKey="demandSurplus" name="Shortage" fill={COLORS.shortage} barSize={16} stackId="demand" />
        <Bar dataKey="demand" name="Demand" fill={COLORS.demand} barSize={16} stackId="demand" />
      </ComposedChart>
    </ChartContainer>
  );
}

function TeamProductionChart({ monthId }: { monthId: string | null }) {
  const { state } = useApp();

  const allAvvForms = useMemo(() => {
    if (!monthId) return [];
    
    const monthlyProductionData = calculateProductionPerTeam(
      state.tasks, monthId, state.months, 
      createPeriodBoundaries(state.periods), state.totalHours
    );

    const avvFormsSet = new Set<string>();
    monthlyProductionData.forEach(({ avvForms }) => {
      Object.keys(avvForms).forEach(avvForm => avvFormsSet.add(avvForm));
    });
    
    return Array.from(avvFormsSet).sort();
  }, [state.tasks, state.months, state.periods, monthId, state.totalHours]);

  const avvFormColors = useMemo(() => {
    const colors = ['#10B981', '#3B82F6', '#EC4899', '#F59E0B', '#8B5CF6', '#06B6D4', '#EF4444', '#14B8A6', '#F97316', '#6366F1', '#0a5800ff'];
    return Object.fromEntries(allAvvForms.map((form, idx) => [form, colors[idx % colors.length]]));
  }, [allAvvForms]);

  const data = useMemo(() => {
    if (!monthId) return [];

    const monthlyProductionData = calculateProductionPerTeam(
      state.tasks, monthId, state.months, 
      createPeriodBoundaries(state.periods), state.totalHours
    );

    return monthlyProductionData.map(({ teamId, volume, avvForms }) => {
      let minGoal: number | null = null;
      let maxGoal: number | null = null;

      if (monthId === 'all') {
        const teamGoals = state.productionGoals.filter(g => g.team === teamId);
        if (teamGoals.length > 0) {
          minGoal = teamGoals.reduce((sum, g) => sum + (g.minGoal ?? 0), 0);
          maxGoal = teamGoals.reduce((sum, g) => sum + (g.maxGoal ?? 0), 0);
        }
      } else {
        const goal = state.productionGoals.find(g => g.monthID === monthId && g.team === teamId);
        minGoal = goal?.minGoal ?? null;
        maxGoal = goal?.maxGoal ?? null;
      }

      const avvFormData = Object.fromEntries(allAvvForms.map(form => [form, avvForms[form] || 0]));

      return { name: teamId, totalQuantity: volume, minGoal, maxGoal, ...avvFormData };
    });
  }, [state.tasks, state.months, state.periods, state.productionGoals, monthId, allAvvForms, state.totalHours]);

  const BarWithGoals = (props: any) => {
    const { x, y, width, height, index, fill, dataKey } = props;
    const dataPoint = data[index];
    if (!dataPoint) return null;

    const currentAvvFormIndex = allAvvForms.indexOf(dataKey);
    const isTopSegment = !allAvvForms.slice(currentAvvFormIndex + 1).some(form => (dataPoint as any)[form] > 0);

    return (
      <g>
        <rect x={x} y={y} width={width} height={height} fill={fill} />
        
        {isTopSegment && dataPoint.minGoal !== null && dataPoint.maxGoal !== null && dataPoint.totalQuantity > 0 && (
          (() => {
            let thisSegmentValue = 0;
            let segmentValueBelow = 0;
            
            for (let i = allAvvForms.length - 1; i >= 0; i--) {
              const value = (dataPoint as any)[allAvvForms[i]] || 0;
              if (value > 0) {
                thisSegmentValue = value;
                segmentValueBelow = allAvvForms.slice(0, i).reduce((sum, form) => sum + ((dataPoint as any)[form] || 0), 0);
                break;
              }
            }
            
            if (thisSegmentValue <= 0 || height <= 0) return null;
            
            const pixelsPerUnit = height / thisSegmentValue;
            const stackBottom = y + height + (segmentValueBelow * pixelsPerUnit);
            const minY = stackBottom - (dataPoint.minGoal * pixelsPerUnit);
            const maxY = stackBottom - (dataPoint.maxGoal * pixelsPerUnit);
            const centerX = x + width / 2;
            const lineWidth = width * 0.8;
            const lineStart = centerX - lineWidth / 2;
            const lineEnd = centerX + lineWidth / 2;

            return (
              <g>
                <line x1={lineStart} y1={minY} x2={lineEnd} y2={minY} stroke="#000" strokeWidth={2} />
                <line x1={lineStart} y1={maxY} x2={lineEnd} y2={maxY} stroke="#000" strokeWidth={2} />
                <line x1={centerX} y1={minY} x2={centerX} y2={maxY} stroke="#000" strokeWidth={1.5} />
              </g>
            );
          })()
        )}
      </g>
    );
  };

  return (
    <ChartContainer isEmpty={!data.length}>
      <BarChart data={data} {...commonChartProps}>
        <CartesianGrid stroke={COLORS.grid} />
        <XAxis dataKey="name" {...commonXAxisProps} />
        <YAxis {...commonYAxisProps} />
        <Tooltip content={({ active, payload }) => {
          if (active && payload?.length) {
            const d = payload[0].payload;
            return (
              <div className="bg-white p-2 border border-gray-300 rounded shadow-sm text-xs">
                <p className="font-semibold">{d.name}</p>
                <p className="font-medium mt-1">Total Production: {Number(d.totalQuantity).toFixed(2)}</p>
                <div className="mt-1 space-y-0.5">
                  {allAvvForms.map(form => d[form] > 0 && (
                    <p key={form} style={{ color: avvFormColors[form] }}>
                      {form}: {Number(d[form]).toFixed(2)}
                    </p>
                  ))}
                </div>
                {d.minGoal !== null && <p className="mt-1">Min Goal: {Number(d.minGoal).toFixed(2)}</p>}
                {d.maxGoal !== null && <p>Max Goal: {Number(d.maxGoal).toFixed(2)}</p>}
              </div>
            );
          }
          return null;
        }} />
        <Legend {...commonLegendProps} />
        {allAvvForms.map(form => (
          <Bar key={form} dataKey={form} stackId="avvForms" fill={avvFormColors[form]} name={form} shape={<BarWithGoals />} />
        ))}
      </BarChart>
    </ChartContainer>
  );
}

function MonthlyProductionChart({ monthId }: { monthId: string | null }) {
  const { state } = useApp();

  const data = useMemo(() => {
    if (!monthId) return [];

    const monthlyProductionData = calculateProductionForMonth(
      state.tasks, monthId, state.months, 
      createPeriodBoundaries(state.periods), state.assortments_graph, state.totalHours
    );

    return Object.entries(monthlyProductionData.products).map(([productName, quantity]) => ({
      name: productName,
      quantity: quantity
    }));
  }, [state.tasks, state.months, state.periods, monthId, state.assortments_graph, state.totalHours]);

  return (
    <ChartContainer isEmpty={!data.length}>
      <BarChart data={data} {...commonChartProps}>
        <CartesianGrid stroke={COLORS.grid} />
        <XAxis dataKey="name" {...commonXAxisProps} />
        <YAxis {...commonYAxisProps} />
        <Tooltip formatter={(value: any) => Number(value).toFixed(2)} />
        <Legend {...commonLegendProps} />
        <Bar dataKey="quantity" name="Production Quantity" fill="#EC4899" />
      </BarChart>
    </ChartContainer>
  );
}

function WorkEfficiencyChart({ monthId }: { monthId: string | null }) {
  const { state } = useApp();

  const data = useMemo(() => {
    let totalAvailable = 0;

    if (monthId === 'all') {
      totalAvailable = state.totalHours > 0 ? state.totalHours : state.periods.reduce((s, p) => s + p.length_h, 0);
    } else {
      const month = state.months?.find(m => m.monthID === monthId);
      if (month) {
        const monthPeriods = state.periods.filter(p => month.periods.includes(p.id));
        totalAvailable = monthPeriods.reduce((sum, p) => sum + p.length_h, 0);
      }
    }

    return state.teams.map(team => {
      const teamTasks = state.tasks.filter(t => t.duration.teamId === team.id);

      let used = 0;
      if (monthId === 'all') {
        used = calculateTotalTaskDuration(teamTasks, state.totalHours);
      } else {
        const month = state.months?.find(m => m.monthID === monthId);
        if (month) {
          const monthStartEnd = getMonthTimeWindow(month, createPeriodBoundaries(state.periods));
          used = calculateMonthlyTaskDuration(monthStartEnd, teamTasks, state.totalHours);
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
  }, [state.tasks, state.teams, state.totalHours, state.periods, state.months, monthId]);

  return (
    <ChartContainer isEmpty={!data.length}>
      <ComposedChart data={data} {...commonChartProps}>
        <CartesianGrid stroke={COLORS.grid} />
        <XAxis dataKey="name" {...commonXAxisProps} />
        <YAxis domain={[0, 100]} {...commonYAxisProps} unit="%" />
        <Tooltip content={({ active, payload }) => {
          if (active && payload?.length) {
            const d = payload[0].payload;
            return (
              <div className="bg-white p-3 border border-gray-300 rounded shadow-lg">
                <p className="font-semibold mb-1">{d.name}</p>
                <p className="text-sm">Efficiency: {d.value.toFixed(2)}%</p>
                <p className="text-sm">Used: {Math.floor(d.used)}h {Math.round((d.used % 1) * 60)}m</p>
                <p className="text-sm">Total: {Math.floor(d.total)}h {Math.round((d.total % 1) * 60)}m</p>
              </div>
            );
          }
          return null;
        }} />
        <Legend {...commonLegendProps} />
        <Bar dataKey="value" name="Efficiency" fill="#3B82F6" />
      </ComposedChart>
    </ChartContainer>
  );
}

// Custom hook for month dropdown management
function useMonthDropdown(initialValue: string = 'all') {
  const { state } = useApp();
  const [selectedMonth, setSelectedMonth] = useState(initialValue);

  useEffect(() => {
    const availableMonths = state.months?.map(m => m.monthID) ?? [];
    if (selectedMonth !== 'all' && !availableMonths.includes(selectedMonth)) {
      setSelectedMonth('all');
    }
  }, [state.months, selectedMonth]);

  return [selectedMonth, setSelectedMonth] as const;
}

// Reusable dropdown component
function MonthDropdown({ value, onChange }: { value: string; onChange: (value: string) => void }) {
  const { state } = useApp();
  
  return (
    <div className="flex items-center gap-1.5">
      <label className="text-xs text-gray-500">Month:</label>
      <select value={value} onChange={e => onChange(e.target.value)} className="px-1.5 py-0.5 text-xs border rounded">
        <option value="all">All Months</option>
        {state.months?.map(month => (
          <option key={month.monthID} value={month.monthID}>{month.monthID}</option>
        ))}
      </select>
    </div>
  );
}

export function ChartsPanel() {
  const { state } = useApp();
  const [tab, setTab] = useState<'DemandProductionChart' | 'TeamProductionChart' | 'WorkEfficiencyChart' | 'MonthlyProductionChart'>('DemandProductionChart');

  const isEmpty = !state.periods.length && !state.tasks.length && !state.teams.length && !state.demand.length;

  const resources = useMemo(() => {
    const groups = new Set(
      (state.assortments_graph || []).filter(a => a.include === 1).map(a => a.assortment_group)
    );
    return Array.from(groups).sort();
  }, [state.assortments_graph]);

  const [selectedResource, setSelectedResource] = useState<string | null>(null);
  const [selectedDemand, setSelectedDemand] = useState<'min' | 'goal'>('min');
  const [teamProdMonth, setTeamProdMonth] = useMonthDropdown();
  const [workEffMonth, setWorkEffMonth] = useMonthDropdown();
  const [monthlyProdMonth, setMonthlyProdMonth] = useMonthDropdown();

  useEffect(() => {
    if (!selectedResource || !resources.includes(selectedResource)) {
      setSelectedResource(resources[0] ?? null);
    }
  }, [resources, selectedResource]);

  const tabs = [
    { id: 'DemandProductionChart', label: 'Demand vs Production' },
    { id: 'TeamProductionChart', label: 'Team Production' },
    { id: 'WorkEfficiencyChart', label: 'Work Efficiency' },
    { id: 'MonthlyProductionChart', label: 'Monthly Production' },
  ] as const;

  return (
    <div className="bg-white rounded-lg shadow-sm border border-gray-200">
      <div className="flex items-center justify-between px-3 py-1 border-b">
        <div className="flex gap-1.5">
          {tabs.map(({ id, label }) => (
            <button
              key={id}
              onClick={() => setTab(id)}
              className={`px-2 py-0.5 text-xs rounded ${tab === id ? 'bg-emerald-100 text-emerald-700' : 'hover:bg-gray-100 text-gray-700'}`}
            >
              {label}
            </button>
          ))}
        </div>
        
        {tab === 'DemandProductionChart' && resources.length > 0 && (
          <>
            <div className="flex items-center gap-1.5">
              <label className="text-xs text-gray-500">Assortment:</label>
              <select value={selectedResource ?? ''} onChange={e => setSelectedResource(e.target.value || null)} className="px-1.5 py-0.5 text-xs border rounded">
                {resources.map(r => <option key={r} value={r}>{r}</option>)}
              </select>
            </div>
            <div className="flex items-center gap-1.5">
              <label className="text-xs text-gray-500">Demand:</label>
              <select value={selectedDemand} onChange={e => setSelectedDemand(e.target.value as 'min' | 'goal')} className="px-1.5 py-0.5 text-xs border rounded">
                <option value='min'>Min</option>
                <option value='goal'>Goal</option>
              </select>
            </div>
          </>
        )}
        
        {tab === 'TeamProductionChart' && <MonthDropdown value={teamProdMonth} onChange={setTeamProdMonth} />}
        {tab === 'WorkEfficiencyChart' && <MonthDropdown value={workEffMonth} onChange={setWorkEffMonth} />}
        {tab === 'MonthlyProductionChart' && <MonthDropdown value={monthlyProdMonth} onChange={setMonthlyProdMonth} />}
      </div>

      <div className='p-0.5'>
        {isEmpty ? (
          <div className="h-40 flex items-center justify-center text-gray-500 text-xs">Load data to view charts.</div>
        ) : tab === 'DemandProductionChart' ? (
          <DemandProductionChart resource={selectedResource} demandType={selectedDemand} />
        ) : tab === 'TeamProductionChart' ? (
          <TeamProductionChart monthId={teamProdMonth} />
        ) : tab === 'WorkEfficiencyChart' ? (
          <WorkEfficiencyChart monthId={workEffMonth} />
        ) : (
          <MonthlyProductionChart monthId={monthlyProdMonth} />
        )}
      </div>
    </div>
  );
}

export default ChartsPanel;