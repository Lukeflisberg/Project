import { useMemo, useState } from 'react';
import { useApp } from '../context/AppContext';
import { calculateTotalCostBreakdown } from '../helper/costUtils';
import { Check, X, Landmark, Undo2, Redo2 } from 'lucide-react';
import { Task, Month } from '../types';
import { historyManager } from '../context/HistoryManager';
import { tasksEqual } from '../helper/historyUtils';
import { earliestMonth } from '../helper/monthUtils';

const PIE_COLORS = ['#10B981', '#3B82F6', '#F59E0B', '#EF4444', '#8B5CF6', '#EC4899', '#adadadff'];

export function CostsPanel() {
  const { state, dispatch } = useApp();
  const [selectedTeam, setSelectedTeam] = useState<string>('all');
  const isEmpty = !state.periods.length && !state.tasks.length && !state.teams.length && !state.demand.length;
  const hasSnapshot = state.taskSnapshot.length > 0;

  const firstMonth = earliestMonth(state.months);

  const transportEntry = state.transportCosts.find(t => t.monthID === firstMonth);
  const transportCost_m0 = transportEntry?.cost ?? 0;
  const transportCost_all = useMemo(() => 
    state.transportCosts.reduce((sum, tc) => sum + tc.cost, 0),
    [state.transportCosts]
  );

  // console.log(
  //   "Transport costs: ", state.transportCosts, 
  //   "\nFirst month: ", firstMonth,
  //   "\nTransport Entry: ", transportEntry, 
  //   "\nTransportCost_m0: ", transportCost_m0, 
  //   "\nTransportCost_all: ", transportCost_all
  // );

  const getPieData = (tasks: Task[], month?: Month) => {
    const costData = calculateTotalCostBreakdown(
      tasks, selectedTeam, state.teams, state.demand, 
      state.periods, state.distances, state.totalHours, month
    );
    if (!costData) return [];

    const { harvesterCosts, forwarderCosts, travelingCosts, wheelingCosts, trailerCosts, demandCost, industryValue } = costData;

    return [
      { name: 'Harvester', value: Math.abs(harvesterCosts), displayValue: harvesterCosts },
      { name: 'Forwarder', value: Math.abs(forwarderCosts), displayValue: forwarderCosts },
      { name: 'Traveling', value: Math.abs(travelingCosts), displayValue: travelingCosts },
      { name: 'Wheeling', value: Math.abs(wheelingCosts), displayValue: wheelingCosts },
      { name: 'Trailer', value: Math.abs(trailerCosts), displayValue: trailerCosts },
      { name: 'Demand', value: Math.abs(demandCost), displayValue: demandCost },
      { name: 'Ind_value', value: Math.abs(industryValue), displayValue: industryValue }
    ].filter(item => item.value > 0);
  };

  const pieDataNew = useMemo(() => getPieData(state.tasks), 
    [state.tasks, state.teams, state.demand, state.periods, state.distances, selectedTeam]);
  const pieDataNew_m0 = useMemo(() => getPieData(state.tasks, state.months[0]), 
    [state.tasks, state.teams, state.demand, state.periods, state.distances, state.months, selectedTeam]);
  const pieDatabase = useMemo(() => getPieData(state.taskSnapshot), 
    [state.taskSnapshot, state.teams, state.demand, state.periods, state.distances, selectedTeam]);
  const pieDatabase_m0 = useMemo(() => getPieData(state.taskSnapshot, state.months[0]), 
    [state.taskSnapshot, state.teams, state.demand, state.periods, state.distances, state.months, selectedTeam]);

  const newCost = useMemo(() => 
    calculateTotalCostBreakdown(state.tasks, selectedTeam, state.teams, state.demand, state.periods, state.distances, state.totalHours, undefined).totalCost + transportCost_all,
    [state.tasks, state.teams, state.demand, state.periods, state.distances, state.totalHours, transportCost_all, selectedTeam]
  );

  const baseCost = useMemo(() => 
    calculateTotalCostBreakdown(state.taskSnapshot, selectedTeam, state.teams, state.demand, state.periods, state.distances, state.totalHours, undefined).totalCost + transportCost_all,
    [state.taskSnapshot, state.teams, state.demand, state.periods, state.distances, state.totalHours, transportCost_all, selectedTeam]
  );

  const costDiff = newCost - baseCost;
  const isImprovement = costDiff < 0;

  const handleHistoryAction = (action: 'undo' | 'redo') => {
    const newState = action === 'undo' ? historyManager.undo() : historyManager.redo();
    if (newState) {
      dispatch({ type: 'UPDATE_TASKS', tasks: newState });
    }

    const isEqual = hasSnapshot && tasksEqual(historyManager.present(), state.taskSnapshot);
    dispatch({ type: 'TOGGLE_COMPARISON_MODAL', toggledModal: !isEqual });
  };

  const onAccept = () => {
    dispatch({ type: 'SET_TASKSNAPSHOT', taskSnapshot: [] });
    dispatch({ type: 'TOGGLE_COMPARISON_MODAL', toggledModal: false });
    historyManager.clear();
    historyManager.init(state.tasks);
  };

  const onDecline = () => {
    const restoredTasks = state.taskSnapshot.map(task => ({
      ...task, 
      duration: {...task.duration}, 
      task: {...task.task}
    }));
    dispatch({ type: 'UPDATE_TASKS', tasks: restoredTasks });
    dispatch({ type: 'SET_TASKSNAPSHOT', taskSnapshot: [] });
    dispatch({ type: 'TOGGLE_COMPARISON_MODAL', toggledModal: false });
    historyManager.clear();
    historyManager.init(restoredTasks);
  };

  const getValue = (dataSet: any[], name: string) => 
    dataSet.find(it => it.name === name)?.displayValue ?? 0;

  const getRowData = (name: string) => {
    if (name === 'Harvesting') {
      const types = ['Harvester', 'Forwarder', 'Traveling', 'Wheeling'];
      const sumValues = (dataSet: any[]) => 
        types.reduce((sum, type) => sum + getValue(dataSet, type), 0);

      return {
        baseM0: sumValues(hasSnapshot ? pieDatabase_m0 : pieDataNew_m0),
        baseAll: sumValues(hasSnapshot ? pieDatabase : pieDataNew),
        newM0: hasSnapshot ? sumValues(pieDataNew_m0) : 0,
        newAll: hasSnapshot ? sumValues(pieDataNew) : 0
      };
    }
    
    if (name === 'Transport') {
      return {
        baseM0: transportCost_m0,
        baseAll: transportCost_all,
        newM0: transportCost_m0,
        newAll: transportCost_all
      };
    }

    return {
      baseM0: hasSnapshot ? getValue(pieDatabase_m0, name) : getValue(pieDataNew_m0, name),
      baseAll: hasSnapshot ? getValue(pieDatabase, name) : getValue(pieDataNew, name),
      newM0: hasSnapshot ? getValue(pieDataNew_m0, name) : 0,
      newAll: hasSnapshot ? getValue(pieDataNew, name) : 0
    };
  };

  const fmt = (v: number) => new Intl.NumberFormat('sv-SE', {
    minimumFractionDigits: 0, 
    maximumFractionDigits: 0
  }).format(v);

  const renderRow = (name: string, index: number) => {
    const isTransport = name === 'Transport';
    const isHarvesting = name === 'Harvesting';
    const isIndVal = name === 'Ind_value';
    
    const { baseM0, baseAll, newM0, newAll } = getRowData(name);
    const m0Diff = hasSnapshot ? newM0 - baseM0 : 0;
    const allDiff = hasSnapshot ? newAll - baseAll : 0;
    const m0Improve = isIndVal ? m0Diff > 0 : m0Diff < 0;
    const allImprove = isIndVal ? allDiff > 0 : allDiff < 0;

    const getCellClass = (diff: number, improve: boolean, hasValue: boolean) => {
      if (isTransport) return 'text-gray-400 bg-gray-100';
      if (!hasSnapshot) return 'text-gray-400';
      if (!hasValue) return 'text-center';
      if (diff === 0) return 'bg-gray-50 text-right';
      return `${improve ? 'text-green-700 bg-green-50' : 'text-red-700 bg-red-50'} text-right`;
    };

    const formatDiff = (diff: number, isIndValue: boolean) => {
      if (diff === 0) return '—';
      const sign = isIndValue ? (diff >= 0 ? '+' : '-') : (diff <= 0 ? '-' : '+');
      return `${sign}${fmt(Math.abs(diff))}`;
    };

    return (
      <tr key={name} className={`hover:bg-gray-50 ${isHarvesting ? 'border-t-2 border-gray-900' : ''}`}>
        <td className="border border-gray-300 px-2 py-1">
          <div className="flex items-center gap-1.5">
            {!isHarvesting && (
              <div className="w-2.5 h-2.5 rounded" style={{backgroundColor: PIE_COLORS[index % PIE_COLORS.length]}} />
            )}
            <span className={isHarvesting ? 'font-bold' : 'font-medium'}>{name}</span>
          </div>
        </td>
        <td className={`border border-gray-300 px-2 py-1 text-right ${(isTransport || isHarvesting) ? 'italic font-bold' : ''}`}>
          {baseM0 !== 0 ? fmt(baseM0) : '—'}
        </td>
        <td className={`border border-gray-300 px-2 py-1 text-right ${(isTransport || isHarvesting) ? 'italic font-bold' : ''}`}>
          {baseAll !== 0 ? fmt(baseAll) : '—'}
        </td>
        <td className={`border border-gray-300 px-2 py-1 font-medium ${(isTransport || isHarvesting) ? 'italic font-bold' : ''} ${getCellClass(m0Diff, m0Improve, newM0 !== 0)}`}>
          {isTransport ? '—' : hasSnapshot && newM0 !== 0 ? formatDiff(m0Diff, isIndVal) : '—'}
        </td>
        <td className={`border border-gray-300 px-2 py-1 font-medium ${(isTransport || isHarvesting) ? 'italic font-bold' : ''} ${getCellClass(allDiff, allImprove, newAll !== 0)}`}>
          {isTransport ? '—' : hasSnapshot && newAll !== 0 ? formatDiff(allDiff, isIndVal) : '—'}
        </td>
      </tr>
    );
  };

  return (
    <div className="bg-white rounded-lg shadow-sm border border-gray-200">
      <div className="flex items-center justify-between px-3 py-1 border-b">
        <div className="flex items-center gap-2">
          <Landmark className="text-emerald-600" size={18} />
          <h2 className="font-semibold text-gray-800 text-sm">Cost Analysis (SEK)</h2>
        </div>
        <div className="flex items-center gap-2">
          <div className="flex items-center gap-1 border-r border-gray-300 pr-2">
            {[
              { action: 'undo' as const, icon: Undo2, canDo: historyManager.canUndo, label: 'Undo (Ctrl+Z)' },
              { action: 'redo' as const, icon: Redo2, canDo: historyManager.canRedo, label: 'Redo (Ctrl+Shift+Z)' }
            ].map(({ action, icon: Icon, canDo, label }) => (
              <button
                key={action}
                onClick={() => handleHistoryAction(action)}
                disabled={!canDo}
                className={`p-1 rounded transition-colors ${
                  canDo ? 'hover:bg-gray-100 text-gray-700 cursor-pointer' : 'text-gray-300 cursor-not-allowed'
                }`}
                title={label}
              >
                <Icon size={16} />
              </button>
            ))}
          </div>
          
          <label className="text-xs text-gray-600">Team:</label>
          <select 
            value={selectedTeam} 
            onChange={(e) => setSelectedTeam(e.target.value)}
            className="text-xs border border-gray-300 rounded px-2 py-1 bg-white focus:outline-none focus:ring-2 focus:ring-emerald-500"
          >
            <option value="all">All Teams</option>
            {state.teams.map(team => (
              <option key={team.id} value={team.id}>{team.id}</option>
            ))}
          </select>
        </div>
      </div>

      <div className="p-2">
        {isEmpty ? (
          <div className="h-32 flex items-center justify-center text-gray-500 text-xs">
            Load data to view cost analysis.
          </div>
        ) : (
          <div className="flex gap-2">
            <div style={{width: 'calc(100% - 200px)'}} className="overflow-hidden">
              <div className="overflow-x-auto">
                <table className="w-full text-xs border-collapse" style={{tableLayout: 'fixed'}}>
                  <thead>
                    <tr className="bg-gray-100">
                      {['Type', 'Base (1st)', 'Base (All)', 'New (1st)', 'New (All)'].map(header => (
                        <th key={header} className="border border-gray-300 px-2 py-1 text-center font-semibold">
                          {header}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {['Harvester', 'Forwarder', 'Traveling', 'Wheeling', 'Harvesting', 'Trailer', 'Transport', 'Demand', 'Ind_value'].map((name, i) => 
                      renderRow(name, i)
                    )}
                  </tbody>
                </table>
              </div>
            </div>
            
            {state.toggledModal && (
              <div className="flex-shrink-0 w-48">
                <div className="flex gap-2">
                  <button onClick={onDecline} className="flex-1 flex items-center justify-center gap-1.5 px-3 py-2 bg-red-200 hover:bg-red-300 font-semibold rounded-lg text-sm">
                    <X size={16} />
                    Decline
                  </button>
                  <button onClick={onAccept} className={`flex-1 flex items-center justify-center gap-1.5 px-3 py-2 font-semibold rounded-lg text-sm ${
                    isImprovement ? 'bg-green-600 hover:bg-green-700 text-white' : 'bg-blue-600 hover:bg-blue-700 text-white'
                  }`}>
                    <Check size={16} />
                    Accept
                  </button>
                </div>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

export default CostsPanel;