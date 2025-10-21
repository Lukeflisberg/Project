import { useMemo } from 'react';
import { useApp } from '../context/AppContext';
import { calculateTotalCostBreakdown, createPeriodBoundaries, getMonthTimeWindow } from '../helper/chartUtils';
import { Check, X, Landmark } from 'lucide-react';
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
  const { start, end } = getMonthTimeWindow(state.months[0]?.monthID, state.months, createPeriodBoundaries(state.periods));

  const firstMonthTasks: Task[] = state.tasks.filter(t => t.duration.startHour >= start && endHour(t) <= end);
  const firstMonthTaskSnapshot: Task[] = state.taskSnapshot.filter(t => t.duration.startHour >= start && endHour(t) <= end);

  const hasSnapshot = state.taskSnapshot.length > 0;

  // Calculate transport costs
  const transportCost_m0 = useMemo(() => 
    state.transportCosts.length > 0 ? state.transportCosts[0].cost : 0,
    [state.transportCosts]
  );
  const transportCost_all = useMemo(() => 
    state.transportCosts.reduce((sum, tc) => sum + tc.cost, 0),
    [state.transportCosts]
  );

  // Calculate costs
  const newCost = useMemo(() => 
    calculateTotalCostBreakdown(state.tasks, state.teams, state.demand, state.periods, state.distances).totalCost + transportCost_all,
    [state.tasks, state.teams, state.demand, state.periods, state.distances, transportCost_all]
  );
  const newCost_m0 = useMemo(() => 
    calculateTotalCostBreakdown(firstMonthTasks, state.teams, state.demand, state.periods, state.distances).totalCost + transportCost_m0,
    [firstMonthTasks, state.teams, state.demand, state.periods, state.distances, transportCost_m0]
  );

  const baseCost = useMemo(() => 
    calculateTotalCostBreakdown(state.taskSnapshot, state.teams, state.demand, state.periods, state.distances).totalCost + transportCost_all,
    [state.taskSnapshot, state.teams, state.demand, state.periods, state.distances, transportCost_all]
  );
  const baseCost_m0 = useMemo(() => 
    calculateTotalCostBreakdown(firstMonthTaskSnapshot, state.teams, state.demand, state.periods, state.distances).totalCost + transportCost_m0,
    [firstMonthTaskSnapshot, state.teams, state.demand, state.periods, state.distances, transportCost_m0]
  );

  const costDifference = newCost - baseCost;
  const percentageChange = baseCost > 0
    ? ((costDifference / baseCost) * 100).toFixed(0)
    : 'inf';
  const isImprovement = costDifference < 0;

  const costDifference_m0 = newCost_m0 - baseCost_m0;
  const percentageChange_m0 = baseCost_m0 > 0
    ? ((costDifference_m0 / baseCost_m0) * 100).toFixed(0)
    : 'inf';
  const isImprovement_m0 = costDifference_m0 < 0;

  // Pie chart data for all views
  const getPieData = (tasks: Task[]) => {
    const costData = calculateTotalCostBreakdown(tasks, state.teams, state.demand, state.periods, state.distances);
    
    if (!costData) return [];

    const { harvesterCosts, forwarderCosts, travelingCosts, wheelingCosts, trailerCosts, demandPenaltyCosts, industryValue } = costData;

    const costs = [
      { name: 'Harvester', value: Math.abs(harvesterCosts), displayValue: harvesterCosts },
      { name: 'Forwarder', value: Math.abs(forwarderCosts), displayValue: forwarderCosts },
      { name: 'Traveling', value: Math.abs(travelingCosts), displayValue: travelingCosts },
      { name: 'Wheeling', value: Math.abs(wheelingCosts), displayValue: wheelingCosts },
      { name: 'Trailer', value: Math.abs(trailerCosts), displayValue: trailerCosts },
      { name: 'Demand', value: Math.abs(demandPenaltyCosts), displayValue: demandPenaltyCosts },
      { name: 'Ind_value', value: Math.abs(industryValue), displayValue: industryValue }
    ].filter(item => item.value > 0);

    return costs;
  };

  const pieDataNew = useMemo(() => getPieData(state.tasks), [state.tasks, state.teams, state.demand, state.periods, state.distances]);
  const pieDataNew_m0 = useMemo(() => getPieData(firstMonthTasks), [firstMonthTasks, state.teams, state.demand, state.periods, state.distances]);
  const pieDatabase = useMemo(() => getPieData(state.taskSnapshot), [state.taskSnapshot, state.teams, state.demand, state.periods, state.distances]);
  const pieDatabase_m0 = useMemo(() => getPieData(firstMonthTaskSnapshot), [firstMonthTaskSnapshot, state.teams, state.demand, state.periods, state.distances]);

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
      minimumFractionDigits: 0,
      maximumFractionDigits: 0
    }).format(value);
  };

  return (
    <div className="bg-white rounded-lg shadow-sm border border-gray-200">
      <div className="flex items-center justify-between px-4 py-2 border-b">
        <div className="flex items-center gap-2">
          <Landmark className="text-emerald-600" size={20} />
          <h2 className="font-semibold text-gray-800">Cost Analysis (kr)</h2>
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
                      <th className="border border-gray-300 px-2 py-2 text-center font-semibold text-gray-700">Base (1st)</th>
                      <th className="border border-gray-300 px-2 py-2 text-center font-semibold text-gray-700">Base (All)</th>
                      <th className="border border-gray-300 px-2 py-2 text-center font-semibold text-gray-700">New (1st)</th>
                      <th className="border border-gray-300 px-2 py-2 text-center font-semibold text-gray-700">New (All)</th>
                    </tr>
                  </thead>
                  <tbody>
                    {['Harvester', 'Forwarder', 'Traveling', 'Wheeling', 'Trailer', 'Transport', 'Demand', 'Ind_value'].map((costName, idx) => {
                      const newItem = pieDataNew.find(item => item.name === costName);
                      const newM0Item = pieDataNew_m0.find(item => item.name === costName);
                      const prevItem = pieDatabase.find(item => item.name === costName);
                      const prevM0Item = pieDatabase_m0.find(item => item.name === costName);
                      
                      // Handle Transport costs separately
                      const isTransport = costName === 'Transport';
                      
                      // When no snapshot, show current values in base columns
                      const baseM0Value = isTransport ? transportCost_m0 : (hasSnapshot ? (prevM0Item?.displayValue ?? 0) : (newM0Item?.displayValue ?? 0));
                      const baseAllValue = isTransport ? transportCost_all : (hasSnapshot ? (prevItem?.displayValue ?? 0) : (newItem?.displayValue ?? 0));
                      const newM0Value = isTransport ? transportCost_m0 : (hasSnapshot ? (newM0Item?.displayValue ?? 0) : 0);
                      const newAllValue = isTransport ? transportCost_all : (hasSnapshot ? (newItem?.displayValue ?? 0) : 0);
                      
                      const m0Diff = hasSnapshot ? newM0Value - baseM0Value : 0;
                      const allDiff = hasSnapshot ? newAllValue - baseAllValue : 0;
                      
                      // Ind_value has inverse logic: increase is good, decrease is bad
                      const isIndustryValue = costName === 'Ind_value';
                      const m0IsImprovement = isIndustryValue ? m0Diff > 0 : m0Diff < 0;
                      const allIsImprovement = isIndustryValue ? allDiff > 0 : allDiff < 0;
                      
                      // For display: costs should show - for decrease (good), + for increase (bad)
                      // Ind_value should show + for increase (good), - for decrease (bad)
                      const m0Sign = isIndustryValue ? (m0Diff >= 0 ? '+' : '-') : (m0Diff <= 0 ? '-' : '+');
                      const allSign = isIndustryValue ? (allDiff >= 0 ? '+' : '-') : (allDiff <= 0 ? '-' : '+');
                      
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
                          <td className="border border-gray-300 px-3 py-2 text-right text-gray-800">
                            {baseM0Value !== 0 ? formatCurrency(baseM0Value) : '—'}
                          </td>
                          <td className="border border-gray-300 px-3 py-2 text-right text-gray-800">
                            {baseAllValue !== 0 ? formatCurrency(baseAllValue) : '—'}
                          </td>
                          <td className={`border border-gray-300 px-3 py-2 ${hasSnapshot && newM0Value !== 0 && !isTransport ? 'text-right' : 'text-center'} font-medium ${
                            isTransport ? 'text-gray-400 bg-gray-100' : !hasSnapshot ? 'text-gray-400' : m0Diff === 0 ? 'text-gray-800 bg-gray-50' : m0IsImprovement ? 'text-green-700 bg-green-50' : 'text-red-700 bg-red-50'
                          }`}>
                            {isTransport ? '—' : hasSnapshot && newM0Value !== 0 ? (
                              <div>
                                <div className="text-xs">
                                  {m0Sign}{formatCurrency(Math.abs(m0Diff))}
                                </div>
                              </div>
                            ) : '—'}
                          </td>
                          <td className={`border border-gray-300 px-3 py-2 ${hasSnapshot && newAllValue !== 0 && !isTransport ? 'text-right' : 'text-center'} font-medium ${
                            isTransport ? 'text-gray-400 bg-gray-100' : !hasSnapshot ? 'text-gray-400' : allDiff === 0 ? 'text-gray-800 bg-gray-50' : allIsImprovement ? 'text-green-700 bg-green-50' : 'text-red-700 bg-red-50'
                          }`}>
                            {isTransport ? '—' : hasSnapshot && newAllValue !== 0 ? (
                              <div>
                                <div className="text-xs">
                                  {allSign}{formatCurrency(Math.abs(allDiff))}
                                </div>
                              </div>
                            ) : '—'}
                          </td>
                        </tr>
                      );
                    })}
                    <tr className="bg-gray-100 font-bold">
                      <td className="border border-gray-300 px-3 py-2 text-center text-gray-900">Total Cost</td>
                      <td className="border border-gray-300 px-3 py-2 text-right text-gray-900">
                        {formatCurrency(hasSnapshot ? baseCost_m0 : newCost_m0)}
                      </td>
                      <td className="border border-gray-300 px-3 py-2 text-right text-gray-900">
                        {formatCurrency(hasSnapshot ? baseCost : newCost)}
                      </td>
                      <td className={`border border-gray-300 px-3 py-2 ${hasSnapshot ? 'text-right' : 'text-center'} ${
                        !hasSnapshot ? 'text-gray-400' : isImprovement_m0 ? 'text-green-700 bg-green-100' : 'text-red-700 bg-red-100'
                      }`}>
                        {hasSnapshot ? (
                          <div>
                            <div>{formatCurrency(newCost_m0)}</div>
                            <div className="text-xs font-normal">
                              {isImprovement_m0 ? '-' : '+'}{formatCurrency(Math.abs(costDifference_m0))} ({percentageChange_m0}%)
                            </div>
                          </div>
                        ) : '—'}
                      </td>
                      <td className={`border border-gray-300 px-3 py-2 ${hasSnapshot ? 'text-right' : 'text-center'} ${
                        !hasSnapshot ? 'text-gray-400' : isImprovement ? 'text-green-700 bg-green-100' : 'text-red-700 bg-red-100'
                      }`}>
                        {hasSnapshot ? (
                          <div>
                            <div>{formatCurrency(newCost)}</div>
                            <div className="text-xs font-normal">
                              {isImprovement ? '-' : '+'}{formatCurrency(Math.abs(costDifference))} ({percentageChange}%)
                            </div>
                          </div>
                        ) : '—'}
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