import React from 'react';
import { AppProvider, useApp } from './context/AppContext';
import { GanttChart } from './components/GanttChart';
import { WorldMap } from './components/WorldMap';
import { UnassignedTasks } from './components/UnassignedTasks';
import { ChartsPanel } from './components/ChartsPanel';
import { Trees, Users, CheckCircle2, AlertCircle } from 'lucide-react'; 
import { calcDurationOf, calcMonthlyDurations, calcTotalCostDistribution, createPeriodBoundaries, getDemandByProduct, getProductionByProduct, getProductionByTeam } from './helper/chartUtils';

function AppContent() {
  const { state, dispatch} = useApp();
  return (
    <div className="min-h-screen bg-gradient-to-br from-green-50 to-blue-50 p-4">
      {/* Header */}
      <header className="mb-6">
        <div className="flex items-center justify-between mb-2">
          <div className="flex items-center gap-3">
            <div className="bg-green-600 p-2 rounded-lg">
              <Trees className="text-white" size={24} />
            </div>
            <div>
              <h1 className="text-2xl font-bold text-gray-800">Forest Operations Manager</h1>
              <p className="text-gray-600 text-sm">Plan, schedule & optimize forestry tasks</p>
            </div>
          </div>
        </div>
        
        <div className="mt-3 flex flex-wrap gap-2">
          {import.meta.env.DEV && (
          <button 
            onClick={() => window.location.reload()}
            className="px-3 py-1 text-sm bg-blue-500 text-white rounded hover:bg-blue-600"
          >
            Reset Page
          </button>
          )}

          <button 
            onClick={() => console.log(getDemandByProduct(state.demand))}
            className="px-3 py-1 text-sm bg-green-500 text-white rounded hover:bg-green-600"
          >
            Demand Calc
          </button>
          
          <button 
            onClick={() => console.log(getProductionByProduct(state.tasks, createPeriodBoundaries(state.periods)))}
            className="px-3 py-1 text-sm bg-green-500 text-white rounded hover:bg-green-600"
          >
            Production Calc
          </button>

          <button 
            onClick={() => console.log(getProductionByTeam(state.tasks))}
            className="px-3 py-1 text-sm bg-green-500 text-white rounded hover:bg-green-600"
          >
            Production By Team Calc
          </button>

          <button 
            onClick={() => console.log(calcTotalCostDistribution(state.tasks, state.teams, state.demand, state.periods, state.distances))}
            className="px-3 py-1 text-sm bg-green-500 text-white rounded hover:bg-green-600"
          >
            Calc Total Costs
          </button>
          
          <button 
            onClick={() => {
              state.teams.forEach(team => {
                const teamTasks = state.tasks.filter(t => t.duration.teamId === team.id);
                const duration = calcDurationOf(teamTasks);
                const total = state.totalHours;
                const efficiency = (duration / total * 100);

                console.log(`
                  Team: ${team.id}
                  Duration used: ${duration.toFixed(2)}
                  Total available: ${total}
                  % Efficiency: ${efficiency.toFixed(2)}%\n
                `);
              
                state.months.forEach(month => {
                  const monthlyDuration = calcMonthlyDurations(month, teamTasks, createPeriodBoundaries(state.periods))
                  const monthlyTotal = state.periods.reduce(
                    (sum, period) => sum + (month.periods.includes(period.id) ? period.length_h : 0), 
                    0
                  );
                  const monthlyEfficiency = (monthlyDuration / monthlyTotal * 100);

                  console.log(`
                    Month: ${month.monthID}
                    Duration used: ${monthlyDuration.toFixed(2)}
                    Total available: ${monthlyTotal}
                    % Efficiency ${monthlyEfficiency.toFixed(2)}%
                  `);
                });
              });
            }}
            className="px-3 py-1 text-sm bg-green-500 text-white rounded hover:bg-green-600"
          >
            Team Utilisation Calc
          </button>
        </div>

        {/* Quick Stats */}
        <div className="flex flex-wrap gap-4 mt-4">
          <div className="bg-white p-3 rounded-lg shadow-sm flex items-center gap-2 hover:shadow-md transition-shadow">
            <Users size={16} className="text-blue-600" />
            <div className="flex flex-col">
              <span className="text-xs text-gray-500">Teams</span>
              <span className="text-lg font-bold text-gray-800">{state.teams.length || 0}</span>
            </div>
          </div>
          <div className="bg-white p-3 rounded-lg shadow-sm flex items-center gap-2 hover:shadow-md transition-shadow">
            <CheckCircle2 size={16} className="text-green-600" />
            <div className="flex flex-col">
              <span className="text-xs text-gray-500">Active Tasks</span>
              <span className="text-lg font-bold text-gray-800">{state.tasks.filter(t => t.duration.teamId !== null).length || 0}</span>
            </div>
          </div>
          <div className="bg-white p-3 rounded-lg shadow-sm flex items-center gap-2 hover:shadow-md transition-shadow">
            <AlertCircle size={16} className="text-slate-600" />
            <div className="flex flex-col">
              <span className="text-xs text-gray-500">Unassigned</span>
              <span className="text-lg font-bold text-gray-800">{state.tasks.filter(t => t.duration.teamId === null).length || 0}</span>
            </div>
          </div>
          <div className="bg-white p-3 rounded-lg shadow-sm flex items-center gap-2 hover:shadow-md transition-shadow">
            <Trees size={16} className="text-green-600" />
            <div className="flex flex-col">
              <span className="text-xs text-gray-500">Total Tasks</span>
              <span className="text-lg font-bold text-gray-800">{state.tasks.length || 0}</span>
            </div>
          </div>
        </div>
      </header>

      {/* Main Layout */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 h-[calc(100vh-200px)]">

        {/* Gantt Chart */}
        <div className="lg:col-span-2 h-full">
          <GanttChart />
        </div>

        {/* Right Sidebar */}
        <div className="space-y-6 h-full overflow-y-auto">

          {/* Charts Panel */}
          <div className="h-auto">
            <ChartsPanel />
          </div>

          {/* Unassigned Tasks */}
          <div className="h-auto">
            <UnassignedTasks />
          </div>

          {/* World Map */}
          <div className="h-1/2 min-h-[600px]">
            <WorldMap />
          </div>
        </div>
      </div>

      {/* Global Styles for Map Animation */}
      <style jsx global>{`
        @keyframes pulse {
          0%, 100% {
            transform: scale(1);
            opacity: 1;
          }
          50% {
            transform: scale(1.1);
            opacity: 0.7;
          }
        }
        
        .custom-marker {
          background: transparent !important;
          border: none !important;
        }
        
        .leaflet-popup-content-wrapper {
          border-radius: 8px;
        }
        
        .leaflet-popup-tip {
          background: white;
        }
      `}</style>
    </div>
  );
}

function App() {
  return (
    <AppProvider>
      <AppContent />
    </AppProvider>
  );
}

export default App;