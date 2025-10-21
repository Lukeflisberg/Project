import { AppProvider } from './context/AppContext';
import { GanttChart } from './components/GanttChart';
import { WorldMap } from './components/WorldMap';
import { ChartsPanel } from './components/ChartsPanel';
import { Trees } from 'lucide-react'; 
import { CostsPanel } from './components/CostAnalysis';

function AppContent() {
  return (
    <div className="min-h-screen bg-gradient-to-br from-green-50 to-blue-50 p-4">

      {/* Header */}
      <header className="mb-2">
        <div className="flex items-center justify-between mb-2">
          <div className="flex items-center gap-3">
            <div className="bg-green-600 p-2 rounded-lg">
              <Trees className="text-white" size={24} />
            </div>
            <div>
              <h1 className="text-2xl font-bold text-gray-800">Creative Optimization</h1>
            </div>
          </div>

          {import.meta.env.DEV && (
          <button 
            onClick={() => window.location.reload()}
            className="px-3 py-1 text-sm bg-blue-500 text-white rounded hover:bg-blue-600"
          >
            Reset Page
          </button>
          )}
        </div>
      </header>

      {/* Main Layout */}
      <div className="h-[calc(100vh-100px)] flex flex-col gap-4">
        
        {/* Top Row - Gantt (3/5w) and Map (2/5w) */}
        <div className="flex gap-4 h-[60%] overflow-hidden">
          <div className="w-3/5">
            <GanttChart />
          </div>
          <div className="w-2/5">
            <WorldMap />
          </div>
        </div>

        {/* Bottom Row - Charts (50%w) and Unassigned (50%w) */}
        <div className="flex gap-4 h-[40%]">
          <div className="w-1/2">
            <ChartsPanel />
          </div>
          <div className="w-1/2">
            <CostsPanel />
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