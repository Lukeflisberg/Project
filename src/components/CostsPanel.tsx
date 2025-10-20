import { useMemo, useState } from 'react';
import { useApp } from '../context/AppContext';
import { calcTotalCostDistribution, createPeriodBoundaries, getMonthStartEnd } from '../helper/chartUtils';
import { ResponsiveContainer, Tooltip, PieChart, Pie, Cell } from 'recharts';
import { DollarSign, Check, X } from 'lucide-react';
import { endHour } from '../helper/taskUtils';
import { Task } from '../types';

// Pie chart colors
const PIE_COLORS = [
  '#10B981', 
  '#3B82F6', 
  '#F59E0B', 
  '#EF4444', 
  '#8B5CF6', 
  '#EC4899', 
  '#adadadff'
];

export function CostsPanel() {
  const { state, dispatch } = useApp();
  const [selectedView, setSelectedView] = useState<'new' | 'new_m0' | 'previous' | 'previous_m0'>('new');

  const isEmpty: boolean = !state.periods.length && !state.tasks.length && !state.teams.length && !state.demand.length;
  const { start, end } = getMonthStartEnd(state.months[0], createPeriodBoundaries(state.periods));

  const firstMonthTasks: Task[] = state.tasks.filter(t => t.duration.startHour >= start && endHour(t) <= end);
  const firstMonthTaskSnapshot: Task[] = state.taskSnapshot.filter(t => t.duration.startHour >= start && endHour(t) <= end);

  // Calculate costs
  const newCost = useMemo(() => 
    calcTotalCostDistribution(state.tasks, state.teams, state.demand, state.periods, state.distances).total,
    [state.tasks, state.teams, state.demand, state.periods, state.distances]
  );
  const newCost_m0 = useMemo(() => 
    calcTotalCostDistribution(firstMonthTasks, state.teams, state.demand, state.periods, state.distances).total,
    [firstMonthTasks, state.teams, state.demand, state.periods, state.distances]
  );

  const previousCost = useMemo(() => 
    calcTotalCostDistribution(state.taskSnapshot, state.teams, state.demand, state.periods, state.distances).total,
    [state.taskSnapshot, state.teams, state.demand, state.periods, state.distances]
  );
  const previousCost_m0 = useMemo(() => 
    calcTotalCostDistribution(firstMonthTaskSnapshot, state.teams, state.demand, state.periods, state.distances).total,
    [firstMonthTaskSnapshot, state.teams, state.demand, state.periods, state.distances]
  );

  const costDifference = newCost - previousCost;
  const percentageChange = previousCost > 0
    ? ((costDifference / previousCost) * 100).toFixed(0)
    : 'inf';
  const isImprovement = costDifference < 0;

  const costDifference_m0 = newCost_m0 - previousCost_m0;
  const percentageChange_m0 = previousCost_m0 > 0
    ? ((costDifference_m0 / previousCost_m0) * 100).toFixed(0)
    : 'inf';
  const isImprovement_m0 = costDifference_m0 < 0;

  // Pie chart data for all views
  const getPieData = (tasks: Task[]) => {
    const costData = calcTotalCostDistribution(tasks, state.teams, state.demand, state.periods, state.distances);
    
    if (!costData) return [];

    const { harvesterCosts, forwarderCosts, travelingCosts, wheelingCosts, trailerCosts, demandCosts, industryValue } = costData;

    const costs = [
      { name: 'Harvester Costs', value: Math.abs(harvesterCosts), displayValue: harvesterCosts },
      { name: 'Forwarder Costs', value: Math.abs(forwarderCosts), displayValue: forwarderCosts },
      { name: 'Traveling Costs', value: Math.abs(travelingCosts), displayValue: travelingCosts },
      { name: 'Wheeling Costs', value: Math.abs(wheelingCosts), displayValue: wheelingCosts },
      { name: 'Trailer Costs', value: Math.abs(trailerCosts), displayValue: trailerCosts },
      { name: 'Demand Costs', value: Math.abs(demandCosts), displayValue: demandCosts },
      { name: 'Industry Value', value: Math.abs(industryValue), displayValue: industryValue }
    ].filter(item => item.value > 0);

    return costs;
  };

  const pieDataNew = useMemo(() => getPieData(state.tasks), [state.tasks, state.teams, state.demand, state.periods, state.distances]);
  const pieDataNew_m0 = useMemo(() => getPieData(firstMonthTasks), [firstMonthTasks, state.teams, state.demand, state.periods, state.distances]);
  const pieDataPrevious = useMemo(() => getPieData(state.taskSnapshot), [state.taskSnapshot, state.teams, state.demand, state.periods, state.distances]);
  const pieDataPrevious_m0 = useMemo(() => getPieData(firstMonthTaskSnapshot), [firstMonthTaskSnapshot, state.teams, state.demand, state.periods, state.distances]);

  // Get current view data
  const getCurrentViewData = () => {
    switch (selectedView) {
      case 'new':
        return { pieData: pieDataNew, total: newCost, label: 'New Configuration (All Periods)' };
      case 'new_m0':
        return { pieData: pieDataNew_m0, total: newCost_m0, label: 'New Configuration (First Month)' };
      case 'previous':
        return { pieData: pieDataPrevious, total: previousCost, label: 'Previous Configuration (All Periods)' };
      case 'previous_m0':
        return { pieData: pieDataPrevious_m0, total: previousCost_m0, label: 'Previous Configuration (First Month)' };
    }
  };

  const { pieData, total, label } = getCurrentViewData();

  // Handlers
  function onAccept() {
    dispatch({ type: 'SET_TASKSNAPSHOT', taskSnapshot: [] });
    dispatch({ type: 'TOGGLE_COMPARISON_MODAL', toggledModal: false });
  }

  function onDecline() {
    dispatch({ type: 'UPDATE_TASKS', tasks: state.taskSnapshot });
    dispatch({ type: 'SET_TASKSNAPSHOT', taskSnapshot: [] });
    dispatch({ type: 'TOGGLE_COMPARISON_MODAL', toggledModal: false });
  }

  const formatCurrency = (value: number) => {
    return new Intl.NumberFormat('sv-SE', {
      style: 'currency',
      currency: 'SEK',
      minimumFractionDigits: 0,
      maximumFractionDigits: 0
    }).format(value);
  };

  interface TooltipProps {
    active?: boolean;
    payload?: Array<{
      payload: {
        name: string;
        value: number;
        displayValue: number;
      };
    }>;
  }

  const CustomTooltip = ({ active, payload }: TooltipProps) => {
    if (active && payload && payload.length) {
      const data = payload[0].payload;
      const percentage = ((data.value / total) * 100).toFixed(2);
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

  return (
    <div className="bg-white rounded-lg shadow-sm border border-gray-200">
      <div className="flex items-center justify-between px-4 py-2 border-b">
        <div className="flex items-center gap-2">
          <DollarSign className="text-emerald-600" size={20} />
          <h2 className="font-semibold text-gray-800">Cost Analysis</h2>
        </div>
      </div>

      <div className="p-2">
        {isEmpty ? (
          <div className="h-64 flex items-center justify-center text-gray-500 text-sm">
            Load data to view cost analysis.
          </div>
        ) : (
          <div className="flex gap-2">

            {/* Left: Cost Distribution Chart with View Selector */}
            <div className="flex-1">
              {/* View Selector Tabs */}
              <div className="flex gap-1 mb-3 bg-gray-100 p-1 rounded-lg">
                <button
                  onClick={() => setSelectedView('new')}
                  className={`flex-1 px-3 py-2 text-xs font-medium rounded transition-colors ${
                    selectedView === 'new'
                      ? 'bg-white text-gray-900 shadow-sm'
                      : 'text-gray-600 hover:text-gray-900'
                  }`}
                >
                  New (All)
                </button>
                <button
                  onClick={() => setSelectedView('new_m0')}
                  className={`flex-1 px-3 py-2 text-xs font-medium rounded transition-colors ${
                    selectedView === 'new_m0'
                      ? 'bg-white text-gray-900 shadow-sm'
                      : 'text-gray-600 hover:text-gray-900'
                  }`}
                >
                  New (M0)
                </button>
                <button
                  onClick={() => setSelectedView('previous')}
                  className={`flex-1 px-3 py-2 text-xs font-medium rounded transition-colors ${
                    selectedView === 'previous'
                      ? 'bg-white text-gray-900 shadow-sm'
                      : 'text-gray-600 hover:text-gray-900'
                  }`}
                >
                  Previous (All)
                </button>
                <button
                  onClick={() => setSelectedView('previous_m0')}
                  className={`flex-1 px-3 py-2 text-xs font-medium rounded transition-colors ${
                    selectedView === 'previous_m0'
                      ? 'bg-white text-gray-900 shadow-sm'
                      : 'text-gray-600 hover:text-gray-900'
                  }`}
                >
                  Previous (M0)
                </button>
              </div>

              {/* Current View Label */}
              <div className="text-sm font-medium text-gray-700 mb-2 px-1">
                {label}
              </div>

              {pieData.length === 0 ? (
                <div className="flex items-center justify-center h-64 text-sm text-gray-500">
                  No cost data available.
                </div>
              ) : (
                <div className="flex items-center gap-2">
                  
                  {/* Legend */}
                  <div className="flex-shrink-0 w-42">
                    {pieData.map((item, index) => (
                      <div key={item.name} className="flex items-center gap-2 text-sm mb-1">
                        <div 
                          className="w-4 h-4 rounded flex-shrink-0" 
                          style={{ backgroundColor: PIE_COLORS[index % PIE_COLORS.length] }}
                        />
                        <div className="flex-1 min-w-0">
                          <div className="font-medium text-gray-700 truncate">{item.name}</div>
                          <div className="text-sm text-gray-600">{formatCurrency(item.displayValue)}</div>
                        </div>
                      </div>
                    ))}
                    <div className="mt-2 pt-2 border-t border-gray-300">
                      <div className="flex items-center gap-2 text-sm">
                        <div className="w-4 h-4 flex-shrink-0" />
                        <div className="flex-1 min-w-0">
                          <div className="font-bold text-gray-900">Total Cost</div>
                          <div className="font-bold text-gray-900">{formatCurrency(total)}</div>
                        </div>
                      </div>
                    </div>
                  </div>
                </div>
              )}
            </div>
            
            {/* Right: Cost Comparison */}
            <div className="flex-shrink-0 w-72">
              <div className="space-y-3">
                {/* Summary Cards */}
                <div className="grid grid-cols-2 gap-2">
                  <div className="bg-gray-50 rounded-lg p-2">
                    <div className="text-xs text-gray-600">Previous (All)</div>
                    <div className="text-lg font-bold text-gray-800">
                      {formatCurrency(previousCost)}
                    </div>
                  </div>
                  <div className="bg-gray-50 rounded-lg p-2">
                    <div className="text-xs text-gray-600">Previous (M0)</div>
                    <div className="text-lg font-bold text-gray-800">
                      {formatCurrency(previousCost_m0)}
                    </div>
                  </div>
                  <div className={`rounded-lg p-2 ${isImprovement ? 'bg-green-50' : 'bg-red-50'}`}>
                    <div className="text-xs text-gray-600">New (All)</div>
                    <div className={`text-lg font-bold ${isImprovement ? 'text-green-700' : 'text-red-700'}`}>
                      {formatCurrency(newCost)}
                    </div>
                  </div>
                  <div className={`rounded-lg p-2 ${isImprovement_m0 ? 'bg-green-50' : 'bg-red-50'}`}>
                    <div className="text-xs text-gray-600">New (M0)</div>
                    <div className={`text-lg font-bold ${isImprovement_m0 ? 'text-green-700' : 'text-red-700'}`}>
                      {formatCurrency(newCost_m0)}
                    </div>
                  </div>
                </div>

                {/* Cost Difference - All Periods */}
                <div className={`rounded-lg p-3 border-2 ${
                  isImprovement 
                    ? 'border-green-500 bg-green-50' 
                    : 'border-red-500 bg-red-50'
                }`}>
                  <div className="text-sm font-medium text-gray-700">Cost Change (All Periods)</div>
                  <div className="flex items-baseline gap-2">
                    <span className={`text-2xl font-bold ${
                      isImprovement ? 'text-green-700' : 'text-red-700'
                    }`}>
                      {isImprovement ? '-' : '+'}{formatCurrency(Math.abs(costDifference)).replace('−', '')}
                    </span>
                    <span className={`text-lg font-semibold ${
                      isImprovement ? 'text-green-600' : 'text-red-600'
                    }`}>
                      ({isImprovement ? '' : '+'}{percentageChange}%)
                    </span>
                  </div>
                </div>

                {/* Cost Difference - First Month */}
                <div className={`rounded-lg p-3 border-2 ${
                  isImprovement_m0 
                    ? 'border-green-500 bg-green-50' 
                    : 'border-red-500 bg-red-50'
                }`}>
                  <div className="text-sm font-medium text-gray-700">Cost Change (First Month)</div>
                  <div className="flex items-baseline gap-2">
                    <span className={`text-2xl font-bold ${
                      isImprovement_m0 ? 'text-green-700' : 'text-red-700'
                    }`}>
                      {isImprovement_m0 ? '-' : '+'}{formatCurrency(Math.abs(costDifference_m0)).replace('−', '')}
                    </span>
                    <span className={`text-lg font-semibold ${
                      isImprovement_m0 ? 'text-green-600' : 'text-red-600'
                    }`}>
                      ({isImprovement_m0 ? '' : '+'}{percentageChange_m0}%)
                    </span>
                  </div>
                </div>

                {/* Action Buttons */}
                {state.toggledModal && (
                  <div className="flex gap-3 mt-6">
                    <button
                      onClick={onDecline}
                      className="flex-1 flex items-center justify-center gap-2 px-4 py-3 bg-red-200 hover:bg-red-300 text-gray-800 font-semibold rounded-lg transition-colors"
                    >
                      <X size={20} />
                      Decline
                    </button>
                    <button
                      onClick={onAccept}
                      className={`flex-1 flex items-center justify-center gap-2 px-4 py-3 font-semibold rounded-lg transition-colors ${
                        isImprovement
                          ? 'bg-green-600 hover:bg-green-700 text-white'
                          : 'bg-blue-600 hover:bg-blue-700 text-white'
                      }`}
                    >
                      <Check size={20} />
                      Accept
                    </button>
                  </div>
                )}
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

export default CostsPanel;