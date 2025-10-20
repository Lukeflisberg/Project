import { useMemo } from 'react';
import { useApp } from '../context/AppContext';
import { calcTotalCostDistribution, createPeriodBoundaries, getMonthStartEnd } from '../helper/chartUtils';
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
            <div className="flex-[2]">
              {/* Cost Comparison Table */}
              <div className="mb-4 overflow-x-auto">
                <table className="w-full text-sm border-collapse">
                  <thead>
                    <tr className="bg-gray-100">
                      <th className="border border-gray-300 px-2 py-2 text-center font-semibold text-gray-700">Cost Type</th>
                      <th className="border border-gray-300 px-2 py-2 text-center font-semibold text-gray-700">Previous (M0)</th>
                      <th className="border border-gray-300 px-2 py-2 text-center font-semibold text-gray-700">New (M0)</th>
                      <th className="border border-gray-300 px-2 py-2 text-center font-semibold text-gray-700">Previous (All)</th>
                      <th className="border border-gray-300 px-2 py-2 text-center font-semibold text-gray-700">New (All)</th>
                    </tr>
                  </thead>
                  <tbody>
                    {['Harvester Costs', 'Forwarder Costs', 'Traveling Costs', 'Wheeling Costs', 'Trailer Costs', 'Demand Costs', 'Industry Value'].map((costName, idx) => {
                      const newItem = pieDataNew.find(item => item.name === costName);
                      const newM0Item = pieDataNew_m0.find(item => item.name === costName);
                      const prevItem = pieDataPrevious.find(item => item.name === costName);
                      const prevM0Item = pieDataPrevious_m0.find(item => item.name === costName);
                      
                      const prevM0Value = prevM0Item?.displayValue ?? 0;
                      const newM0Value = newM0Item?.displayValue ?? 0;
                      const prevAllValue = prevItem?.displayValue ?? 0;
                      const newAllValue = newItem?.displayValue ?? 0;
                      
                      const hasSnapshot = state.taskSnapshot.length > 0;
                      const m0Diff = hasSnapshot ? newM0Value - prevM0Value : 0;
                      const allDiff = hasSnapshot ? newAllValue - prevAllValue : 0;
                      
                      const m0IsImprovement = m0Diff < 0;
                      const allIsImprovement = allDiff < 0;
                      
                      return (
                        <tr key={costName} className="hover:bg-gray-50">
                          <td className="border border-gray-300 px-3 py-2">
                            <div className="flex items-center gap-2">
                              <div 
                                className="w-3 h-3 rounded flex-shrink-0" 
                                style={{ backgroundColor: PIE_COLORS[idx % PIE_COLORS.length] }}
                              />
                              <span className="font-medium text-gray-700">{costName}</span>
                            </div>
                          </td>
                          <td className="border border-gray-300 px-3 py-2 text-center text-gray-800">
                            {prevM0Item ? formatCurrency(prevM0Item.displayValue) : '—'}
                          </td>
                          <td className={`border border-gray-300 px-3 py-2 text-center font-medium ${
                            m0Diff === 0 ? 'text-gray-800 bg-gray-50' : m0IsImprovement ? 'text-green-700 bg-green-50' : 'text-red-700 bg-red-50'
                          }`}>
                            {newM0Item ? (
                              <div>
                                <div>{formatCurrency(newM0Item.displayValue)}</div>
                                {hasSnapshot && m0Diff !== 0 && (
                                  <div className="text-xs">
                                    {m0IsImprovement ? '-' : '+'}{formatCurrency(Math.abs(m0Diff))}
                                  </div>
                                )}
                              </div>
                            ) : '—'}
                          </td>
                          <td className="border border-gray-300 px-3 py-2 text-center text-gray-800">
                            {prevItem ? formatCurrency(prevItem.displayValue) : '—'}
                          </td>
                          <td className={`border border-gray-300 px-3 py-2 text-center font-medium ${
                            allDiff === 0 ? 'text-gray-800 bg-gray-50' : allIsImprovement ? 'text-green-700 bg-green-50' : 'text-red-700 bg-red-50'
                          }`}>
                            {newItem ? (
                              <div>
                                <div>{formatCurrency(newItem.displayValue)}</div>
                                {hasSnapshot && allDiff !== 0 && (
                                  <div className="text-xs">
                                    {allIsImprovement ? '-' : '+'}{formatCurrency(Math.abs(allDiff))}
                                  </div>
                                )}
                              </div>
                            ) : '—'}
                          </td>
                        </tr>
                      );
                    })}
                    <tr className="bg-gray-100 font-bold">
                      <td className="border border-gray-300 px-3 py-2 text-gray-900">Total Cost</td>
                      <td className="border border-gray-300 px-3 py-2 text-center text-gray-900">
                        {formatCurrency(previousCost_m0)}
                      </td>
                      <td className={`border border-gray-300 px-3 py-2 text-center ${
                        state.taskSnapshot.length > 0 && isImprovement_m0 ? 'text-green-700 bg-green-100' : state.taskSnapshot.length > 0 && !isImprovement_m0 ? 'text-red-700 bg-red-100' : 'text-gray-900 bg-gray-50'
                      }`}>
                        <div>{formatCurrency(newCost_m0)}</div>
                        {state.taskSnapshot.length > 0 && (
                          <div className="text-xs font-normal">
                            {isImprovement_m0 ? '-' : '+'}{formatCurrency(Math.abs(costDifference_m0))} ({percentageChange_m0}%)
                          </div>
                        )}
                      </td>
                      <td className="border border-gray-300 px-3 py-2 text-center text-gray-900">
                        {formatCurrency(previousCost)}
                      </td>
                      <td className={`border border-gray-300 px-3 py-2 text-center ${
                        state.taskSnapshot.length > 0 && isImprovement ? 'text-green-700 bg-green-100' : state.taskSnapshot.length > 0 && !isImprovement ? 'text-red-700 bg-red-100' : 'text-gray-900 bg-gray-50'
                      }`}>
                        <div>{formatCurrency(newCost)}</div>
                        {state.taskSnapshot.length > 0 && (
                          <div className="text-xs font-normal">
                            {isImprovement ? '-' : '+'}{formatCurrency(Math.abs(costDifference))} ({percentageChange}%)
                          </div>
                        )}
                      </td>
                    </tr>
                  </tbody>
                </table>
              </div>
            </div>
            
            {/* Right: Action Buttons */}
            <div className="flex-shrink-0 w-72">
              <div className="space-y-3">
                
                {/* Action Buttons */}
                {state.toggledModal && (
                  <div className="flex gap-3">
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