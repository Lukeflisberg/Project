import { useMemo, useState } from 'react';
import { useApp } from '../context/AppContext';
import { calculateTotalCostBreakdown } from '../helper/costUtils';
import { Check, X, Landmark, Undo2, Redo2 } from 'lucide-react';
import { Task, Month, TransportCosts } from '../types';
import { historyManager } from '../context/HistoryManager';
import { tasksEqual } from '../helper/historyUtils';
import { firstMonth } from '../helper/monthUtils';

const PIE_COLORS = ['#10B981', '#3B82F6', '#F59E0B', '#EF4444', '#8B5CF6', '#EC4899', '#adadadff'];

export function CostsPanel() {
  const { state, dispatch } = useApp();
  const [selectedTeam, setSelectedTeam] = useState<string>('all');
  const isEmpty = !state.periods.length && !state.tasks.length && !state.teams.length && !state.demand.length;
  const hasSnapshot = state.taskSnapshot.length > 0;

  // Get undo/redo state
  const canUndo = state.historyIndex > 0;
  const canRedo = state.historyIndex < state.historyLength - 1;

  const transportEntry: TransportCosts | undefined = state.transportCosts.find(t => t.monthID === firstMonth(state.months));

  const transportCost_m0 = useMemo(() => 
    (state.transportCosts.length > 0 && transportEntry) ? transportEntry.cost : 0,
    [state.transportCosts, transportEntry]
  );
  const transportCost_all = useMemo(() => 
    state.transportCosts.reduce((sum, tc) => sum + tc.cost, 0),
    [state.transportCosts]
  );

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

  const getPieData = (tasks: Task[], month?: Month) => {
    const costData = calculateTotalCostBreakdown(tasks, selectedTeam, state.teams, state.demand, state.periods, state.distances, state.totalHours, month);
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

  const pieDataNew = useMemo(() => getPieData(state.tasks), [state.tasks, state.teams, state.demand, state.periods, state.distances, selectedTeam]);
  const pieDataNew_m0 = useMemo(() => getPieData(state.tasks, state.months[0]), [state.tasks, state.teams, state.demand, state.periods, state.distances, state.months, selectedTeam]);
  const pieDatabase = useMemo(() => getPieData(state.taskSnapshot), [state.taskSnapshot, state.teams, state.demand, state.periods, state.distances, selectedTeam]);
  const pieDatabase_m0 = useMemo(() => getPieData(state.taskSnapshot, state.months[0]), [state.taskSnapshot, state.teams, state.demand, state.periods, state.distances, state.months, selectedTeam]);

  const handleUndo = () => {
    const previousState = historyManager.undo();
    if (previousState) {
      dispatch({ type: 'UPDATE_TASKS', tasks: previousState });

      // Update history state
      dispatch({
        type: 'UPDATE_HISTORY_STATE',
        historyIndex: historyManager.currentIndex,
        historyLength: historyManager.length
      });
    }

    const hasSnapshot = state.taskSnapshot.length > 0;
    const isEqual = tasksEqual(historyManager.present(), state.taskSnapshot);

    if (hasSnapshot && isEqual) {
      dispatch({ type: 'TOGGLE_COMPARISON_MODAL', toggledModal: false });
    } else {
      dispatch({ type: 'TOGGLE_COMPARISON_MODAL', toggledModal: true });
    }
  };

  const handleRedo = () => {
    const nextState = historyManager.redo();
    if (nextState) {
      dispatch({ type: 'UPDATE_TASKS', tasks: nextState });

      // Update history state
      dispatch({
        type: 'UPDATE_HISTORY_STATE',
        historyIndex: historyManager.currentIndex,
        historyLength: historyManager.length
      });
    }

    const hasSnapshot = state.taskSnapshot.length > 0;
    const isEqual = tasksEqual(historyManager.present(), state.taskSnapshot);

    if (hasSnapshot && isEqual) {
      dispatch({ type: 'TOGGLE_COMPARISON_MODAL', toggledModal: false });
    } else {
      dispatch({ type: 'TOGGLE_COMPARISON_MODAL', toggledModal: true });
    }
  };

  const onAccept = () => {
    dispatch({ type: 'SET_TASKSNAPSHOT', taskSnapshot: [] });
    dispatch({ type: 'TOGGLE_COMPARISON_MODAL', toggledModal: false });
    historyManager.clear();

    // Re-initialize with current state
    historyManager.init(state.tasks);

    // Update history state
    dispatch({
      type: 'UPDATE_HISTORY_STATE',
      historyIndex: historyManager.currentIndex,
      historyLength: historyManager.length
    });
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

    // Re-initialize with restored state
    historyManager.init(restoredTasks);

    // Update history state
    dispatch({
      type: 'UPDATE_HISTORY_STATE',
      historyIndex: historyManager.currentIndex,
      historyLength: historyManager.length
    });
  };

  const fmt = (v: number) => new Intl.NumberFormat('sv-SE', {minimumFractionDigits: 0, maximumFractionDigits: 0}).format(v);

  return (
    <div className="bg-white rounded-lg shadow-sm border border-gray-200">
      <div className="flex items-center justify-between px-3 py-1 border-b">
        <div className="flex items-center gap-2">
          <Landmark className="text-emerald-600" size={18} />
          <h2 className="font-semibold text-gray-800 text-sm">Cost Analysis (SEK)</h2>
        </div>
        <div className="flex items-center gap-2">
          {/* Undo/Redo buttons */}
          <div className="flex items-center gap-1 border-r border-gray-300 pr-2">
            <button
              onClick={handleUndo}
              disabled={!canUndo}
              className={`p-1 rounded transition-colors ${
                canUndo 
                  ? 'hover:bg-gray-100 text-gray-700 cursor-pointer' 
                  : 'text-gray-300 cursor-not-allowed'
              }`}
              title="Undo (Ctrl+Z)"
            >
              <Undo2 size={16} />
            </button>
            <button
              onClick={handleRedo}
              disabled={!canRedo}
              className={`p-1 rounded transition-colors ${
                canRedo 
                  ? 'hover:bg-gray-100 text-gray-700 cursor-pointer' 
                  : 'text-gray-300 cursor-not-allowed'
              }`}
              title="Redo (Ctrl+Shift+Z)"
            >
              <Redo2 size={16} />
            </button>
          </div>
          
          <label className="text-xs text-gray-600">Team:</label>
          <select 
            value={selectedTeam} 
            onChange={(e) => setSelectedTeam(e.target.value)}
            className="text-xs border border-gray-300 rounded px-2 py-1 bg-white focus:outline-none focus:ring-2 focus:ring-emerald-500"
          >
            <option value="all">All Teams</option>
            {state.teams.map(team => (
              <option key={team.id} value={team.id}>
                {team.id}
              </option>
            ))}
          </select>
        </div>
      </div>

      {/* Rest of your component remains the same */}
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
                {/* Table code */}
                <thead>
                  <tr className="bg-gray-100">
                    <th className="border border-gray-300 px-2 py-1 text-center font-semibold">Type</th>
                    <th className="border border-gray-300 px-2 py-1 text-center font-semibold">Base (1st)</th>
                    <th className="border border-gray-300 px-2 py-1 text-center font-semibold">Base (All)</th>
                    <th className="border border-gray-300 px-2 py-1 text-center font-semibold">New (1st)</th>
                    <th className="border border-gray-300 px-2 py-1 text-center font-semibold">New (All)</th>
                  </tr>
                </thead>
                <tbody>
                  {/* Table rows */}
                  {['Harvester', 'Forwarder', 'Traveling', 'Wheeling', 'Harvesting', 'Trailer', 'Transport'].map((name, i) => {
                    const isTransport = name === 'Transport';
                    const isHarvesting = name === 'Harvesting';
                    
                    let baseM0, baseAll, newM0Val, newAll;
                    
                    if (isHarvesting) {
                      const harvBase_m0 = hasSnapshot ? (pieDatabase_m0.find(it => it.name === 'Harvester')?.displayValue ?? 0) : (pieDataNew_m0.find(it => it.name === 'Harvester')?.displayValue ?? 0);
                      const forwBase_m0 = hasSnapshot ? (pieDatabase_m0.find(it => it.name === 'Forwarder')?.displayValue ?? 0) : (pieDataNew_m0.find(it => it.name === 'Forwarder')?.displayValue ?? 0);
                      const travBase_m0 = hasSnapshot ? (pieDatabase_m0.find(it => it.name === 'Traveling')?.displayValue ?? 0) : (pieDataNew_m0.find(it => it.name === 'Traveling')?.displayValue ?? 0);
                      const wheelBase_m0 = hasSnapshot ? (pieDatabase_m0.find(it => it.name === 'Wheeling')?.displayValue ?? 0) : (pieDataNew_m0.find(it => it.name === 'Wheeling')?.displayValue ?? 0);

                      const harvBase_all = hasSnapshot ? (pieDatabase.find(it => it.name === 'Harvester')?.displayValue ?? 0) : (pieDataNew.find(it => it.name === 'Harvester')?.displayValue ?? 0);
                      const forwBase_all = hasSnapshot ? (pieDatabase.find(it => it.name === 'Forwarder')?.displayValue ?? 0) : (pieDataNew.find(it => it.name === 'Forwarder')?.displayValue ?? 0);
                      const travBase_all = hasSnapshot ? (pieDatabase.find(it => it.name === 'Traveling')?.displayValue ?? 0) : (pieDataNew.find(it => it.name === 'Traveling')?.displayValue ?? 0);
                      const wheelBase_all = hasSnapshot ? (pieDatabase.find(it => it.name === 'Wheeling')?.displayValue ?? 0) : (pieDataNew.find(it => it.name === 'Wheeling')?.displayValue ?? 0);

                      const harvNew_m0 = hasSnapshot ? (pieDataNew_m0.find(it => it.name === 'Harvester')?.displayValue ?? 0) : 0;
                      const forwNew_m0 = hasSnapshot ? (pieDataNew_m0.find(it => it.name === 'Forwarder')?.displayValue ?? 0) : 0;
                      const travNew_m0 = hasSnapshot ? (pieDataNew_m0.find(it => it.name === 'Traveling')?.displayValue ?? 0) : 0;
                      const wheelNew_m0 = hasSnapshot ? (pieDataNew_m0.find(it => it.name === 'Wheeling')?.displayValue ?? 0) : 0;
                      
                      const harvNew_all = hasSnapshot ? (pieDataNew.find(it => it.name === 'Harvester')?.displayValue ?? 0) : 0;
                      const forwNew_all = hasSnapshot ? (pieDataNew.find(it => it.name === 'Forwarder')?.displayValue ?? 0) : 0;
                      const travNew_all = hasSnapshot ? (pieDataNew.find(it => it.name === 'Traveling')?.displayValue ?? 0) : 0;
                      const wheelNew_all = hasSnapshot ? (pieDataNew.find(it => it.name === 'Wheeling')?.displayValue ?? 0) : 0;
                      
                      baseM0 = harvBase_m0 + forwBase_m0 + travBase_m0 + wheelBase_m0;
                      baseAll = harvBase_all + forwBase_all + travBase_all + wheelBase_all;
                      newM0Val = harvNew_m0 + forwNew_m0 + travNew_m0 + wheelNew_m0;
                      newAll = harvNew_all + forwNew_all + travNew_all + wheelNew_all;
                    } else if (isTransport) {
                      baseM0 = transportCost_m0;
                      baseAll = transportCost_all;
                      newM0Val = transportCost_m0;
                      newAll = transportCost_all;
                    } else {
                      const newItem = pieDataNew.find(it => it.name === name);
                      const newM0 = pieDataNew_m0.find(it => it.name === name);
                      const prevItem = pieDatabase.find(it => it.name === name);
                      const prevM0 = pieDatabase_m0.find(it => it.name === name);
                      
                      baseM0 = hasSnapshot ? (prevM0?.displayValue ?? 0) : (newM0?.displayValue ?? 0);
                      baseAll = hasSnapshot ? (prevItem?.displayValue ?? 0) : (newItem?.displayValue ?? 0);
                      newM0Val = hasSnapshot ? (newM0?.displayValue ?? 0) : 0;
                      newAll = hasSnapshot ? (newItem?.displayValue ?? 0) : 0;
                    }
                    
                    const m0Diff = hasSnapshot ? newM0Val - baseM0 : 0;
                    const allDiff = hasSnapshot ? newAll - baseAll : 0;
                    const m0Improve = m0Diff < 0;
                    const allImprove = allDiff < 0;

                    console.log(pieDataNew_m0.find(it => it.name === 'Trailer')?.displayValue ?? 0);
                    
                    return (
                      <tr key={name} className={`hover:bg-gray-50 ${name === 'Harvesting' ? 'border-t-2 border-gray-900' : ''}`}>
                        <td className="border border-gray-300 px-2 py-1">
                          <div className="flex items-center gap-1.5">
                            {!isHarvesting && <div className="w-2.5 h-2.5 rounded" style={{backgroundColor: PIE_COLORS[i % PIE_COLORS.length]}} />}
                            <span className={`${isHarvesting ? 'font-bold' : 'font-medium'}`}>{name}</span>
                          </div>
                        </td>
                        <td className={`border border-gray-300 px-2 py-1 text-right ${isTransport || isHarvesting ? 'italic' : ''} ${isHarvesting ? 'font-bold' : ''}`}>{baseM0 !== 0 ? fmt(baseM0) : '—'}</td>
                        <td className={`border border-gray-300 px-2 py-1 text-right ${isTransport || isHarvesting ? 'italic' : ''} ${isHarvesting ? 'font-bold' : ''}`}>{baseAll !== 0 ? fmt(baseAll) : '—'}</td>
                        <td className={`border border-gray-300 px-2 py-1 ${hasSnapshot && newM0Val !== 0 && !isTransport ? 'text-right' : 'text-center'} font-medium ${isTransport || isHarvesting ? 'italic' : ''} ${isHarvesting ? 'font-bold' : ''} ${
                          isTransport ? 'text-gray-400 bg-gray-100' : !hasSnapshot ? 'text-gray-400' : m0Diff === 0 ? 'bg-gray-50' : m0Improve ? 'text-green-700 bg-green-50' : 'text-red-700 bg-red-50'
                        }`}>
                          {isTransport ? '—' : hasSnapshot && newM0Val !== 0 ? `${m0Diff <= 0 ? '-' : '+'}${fmt(Math.abs(m0Diff))}` : '—'}
                        </td>
                        <td className={`border border-gray-300 px-2 py-1 ${hasSnapshot && newAll !== 0 && !isTransport ? 'text-right' : 'text-center'} font-medium ${isTransport || isHarvesting ? 'italic' : ''} ${isHarvesting ? 'font-bold' : ''} ${
                          isTransport ? 'text-gray-400 bg-gray-100' : !hasSnapshot ? 'text-gray-400' : allDiff === 0 ? 'bg-gray-50' : allImprove ? 'text-green-700 bg-green-50' : 'text-red-700 bg-red-50'
                        }`}>
                          {isTransport ? '—' : hasSnapshot && newAll !== 0 ? `${allDiff <= 0 ? '-' : '+'}${fmt(Math.abs(allDiff))}` : '—'}
                        </td>
                      </tr>
                    );
                  })}
                  
                  {['Demand', 'Ind_value'].map((name, idx) => {
                    const i = 6 + idx;
                    const newItem = pieDataNew.find(it => it.name === name);
                    const newM0 = pieDataNew_m0.find(it => it.name === name);
                    const prevItem = pieDatabase.find(it => it.name === name);
                    const prevM0 = pieDatabase_m0.find(it => it.name === name);
                    
                    const baseM0 = hasSnapshot ? (prevM0?.displayValue ?? 0) : (newM0?.displayValue ?? 0);
                    const baseAll = hasSnapshot ? (prevItem?.displayValue ?? 0) : (newItem?.displayValue ?? 0);
                    const newM0Val = hasSnapshot ? (newM0?.displayValue ?? 0) : 0;
                    const newAll = hasSnapshot ? (newItem?.displayValue ?? 0) : 0;
                    
                    const m0Diff = hasSnapshot ? newM0Val - baseM0 : 0;
                    const allDiff = hasSnapshot ? newAll - baseAll : 0;
                    const isIndVal = name === 'Ind_value';
                    const m0Improve = isIndVal ? m0Diff > 0 : m0Diff < 0;
                    const allImprove = isIndVal ? allDiff > 0 : allDiff < 0;
                    
                    return (
                      <tr key={name} className={`hover:bg-gray-50`}>
                        <td className="border border-gray-300 px-2 py-1">
                          <div className="flex items-center gap-1.5">
                            <div className="w-2.5 h-2.5 rounded" style={{backgroundColor: PIE_COLORS[i % PIE_COLORS.length]}} />
                            <span className="font-medium">{name}</span>
                          </div>
                        </td>
                        <td className="border border-gray-300 px-2 py-1 text-right">{baseM0 !== 0 ? fmt(baseM0) : '—'}</td>
                        <td className="border border-gray-300 px-2 py-1 text-right">{baseAll !== 0 ? fmt(baseAll) : '—'}</td>
                        <td className={`border border-gray-300 px-2 py-1 ${hasSnapshot && newM0Val !== 0 ? 'text-right' : 'text-center'} font-medium ${
                          !hasSnapshot ? 'text-gray-400' : m0Diff === 0 ? 'bg-gray-50' : m0Improve ? 'text-green-700 bg-green-50' : 'text-red-700 bg-red-50'
                        }`}>
                          {hasSnapshot && newM0Val !== 0 ? `${isIndVal ? (m0Diff >= 0 ? '+' : '-') : (m0Diff <= 0 ? '-' : '+')}${fmt(Math.abs(m0Diff))}` : '—'}
                        </td>
                        <td className={`border border-gray-300 px-2 py-1 ${hasSnapshot && newAll !== 0 ? 'text-right' : 'text-center'} font-medium ${
                          !hasSnapshot ? 'text-gray-400' : allDiff === 0 ? 'bg-gray-50' : allImprove ? 'text-green-700 bg-green-50' : 'text-red-700 bg-red-50'
                        }`}>
                          {hasSnapshot && newAll !== 0 ? `${isIndVal ? (allDiff >= 0 ? '+' : '-') : (allDiff <= 0 ? '-' : '+')}${fmt(Math.abs(allDiff))}` : '—'}
                        </td>
                      </tr>
                    );
                  })}
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