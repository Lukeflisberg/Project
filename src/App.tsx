import React from 'react';
import { AppProvider } from './context/AppContext';
import { GanttChart } from './components/GanttChart';
import { WorldMap } from './components/WorldMap';
import { UnassignedTasks } from './components/UnassignedTasks';
import { Trees, MapIcon, Calendar, Package, CpuIcon, Upload } from 'lucide-react'; // Icons
import { useApp } from './context/AppContext';

function AppContent() {
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
              <h1 className="text-2xl font-bold text-gray-800">Forest Stuff</h1>
              <p className="text-gray-600 text-sm">Description & Stuff</p>
            </div>
          </div>
        </div>
        
        {/* Reset Page */}
        {import.meta.env.DEV && (
        <button 
          onClick={() => window.location.reload()}
          className="text-blue-500"
        >
          Reset Page
        </button>
      )}
        
        {/* Quick Stats */}
        <div className="flex gap-4 mt-4">
          <div className="bg-white p-3 rounded-lg shadow-sm flex items-center gap-2">
            <CpuIcon size={16} className="text-purple-600" />
            <span className="text-sm font-medium text-gray-700">n/a Projects</span>
          </div>
          <div className="bg-white p-3 rounded-lg shadow-sm flex items-center gap-2">
            <Calendar size={16} className="text-blue-600" />
            <span className="text-sm font-medium text-gray-700">n/a Active Tasks</span>
          </div>
          <div className="bg-white p-3 rounded-lg shadow-sm flex items-center gap-2">
            <MapIcon size={16} className="text-green-600" />
            <span className="text-sm font-medium text-gray-700">n/a Locations</span>
          </div>
          <div className="bg-white p-3 rounded-lg shadow-sm flex items-center gap-2">
            <Package size={16} className="text-orange-600" />
            <span className="text-sm font-medium text-gray-700">n/a Unassigned</span>
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

          {/* World Map */}
          <div className="h-1/2 min-h-[600px]">
            <WorldMap />
          </div>

          {/* Unassigned Tasks */}
          <div className="h-auto">
            <UnassignedTasks />
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