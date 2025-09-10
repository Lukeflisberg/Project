import { useEffect } from 'react';
import { useMapEvents, MapContainer, TileLayer, Marker, Popup, useMap } from 'react-leaflet';
import L from 'leaflet';
import { Map as MapIcon, MapPin } from 'lucide-react';
import { useApp } from '../context/AppContext';
import 'leaflet/dist/leaflet.css';

// ---------------------------------------------
// Leaflet Marker Icon Fix
// ---------------------------------------------
// Ensures that the default Leaflet marker icons are loaded correctly
delete (L.Icon.Default.prototype as any)._getIconUrl;
L.Icon.Default.mergeOptions({
  iconRetinaUrl: 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.7.1/images/marker-icon-2x.png',
  iconUrl: 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.7.1/images/marker-icon.png',
  shadowUrl: 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.7.1/images/marker-shadow.png',
});

// ---------------------------------------------
// DeselectOnMapClick Component
// ---------------------------------------------
// Listens for map click events and calls the provided onDeselect callback.
// Used to clear the selected task when clicking on the map background.
function DeselectOnMapClick({ onDeselect }: { onDeselect: () => void }) {
  useMapEvents({
    click() {
      onDeselect();
    }
  });
  return null;
}

// ---------------------------------------------
// WorldMap Component
// ---------------------------------------------
// Displays a map with task markers, popups, and connection lines.
// Allows filtering by team/parent and selecting tasks by clicking markers.
export function WorldMap() {
  const { state, dispatch } = useApp();

  // ---------------------------------------------
  // createCustomIcon
  // ---------------------------------------------
  // Generates a custom circular marker icon with color, selection state, and optional index number.
  // Used for both plain and numbered markers.
  const createCustomIcon = (color: string, isSelected: boolean = false, index?: number) => {
    const size = isSelected ? 35 : 25;

    const iconHtml = `
      <div style="
        background-color: ${color};
        width: ${size}px;
        height: ${size}px;
        border-radius: 50%;
        border: ${isSelected ? '4px' : '2px'} solid white;
        box-shadow: 0 2px 8px rgba(0,0,0,0.3);
        display: flex;
        align-items: center;
        justify-content: center;
        ${isSelected ? 'animation: pulse 2s infinite;' : ''}
        color: white;
        font-weight: bold;
        font-size: ${isSelected ? 16 : 12}px;
      ">
        ${index !== undefined ? index : ''}
      </div>
    `;

    return L.divIcon({
      html: iconHtml,
      className: 'custom-marker',
      iconSize: [size, size],
      iconAnchor: [size / 2, size / 2]
    });
  };

  // ---------------------------------------------
  // getVisibleTasks
  // ---------------------------------------------
  // Returns the list of tasks to display based on the current parent/team filter.
  // If "all" is selected, returns all tasks; otherwise, filters by parentId.
  const getVisibleTasks = () => {
    // If "all" is selected, show all assigned tasks and unassigned if toggledNull is true
    if (state.selectedParentId === 'all') {
      return state.tasks.filter(task =>
        (task.parentId !== null) ||
        (state.toggledNull && task.parentId === null)
      );
    }
    // If a specific team is selected, show its tasks and unassigned if toggledNull is true
    return state.tasks.filter(task =>
      (task.parentId === state.selectedParentId) ||
      (state.toggledNull && task.parentId === null)
    );
  };

  // ---------------------------------------------
  // getTaskConnectionLines
  // ---------------------------------------------
  // For filtered views (single team), returns an array of line objects connecting tasks in chronological order.
  // Each line includes positions, color, and style for rendering as a PolyLine.
  const getTaskConnectionLines = () => {
    if (state.selectedParentId === 'all' || state.selectedParentId === null) return [];

    // Only connect assigned tasks
    const visibleTasks = getVisibleTasks().filter(task => task.parentId === state.selectedParentId);
    const sortedTasks = [...visibleTasks].sort((a, b) => a.startHour - b.startHour);

    const lines = [];
    for (let i = 0; i < sortedTasks.length - 1; i++) {
      const currentTask = sortedTasks[i];
      const nextTask = sortedTasks[i + 1];

      lines.push({
        id: `${currentTask.id}-${nextTask.id}`,
        positions: [
          [currentTask.location.lat, currentTask.location.lon],
          [nextTask.location.lat, nextTask.location.lon]
        ],
        color: getParentColor(currentTask.parentId),
        weight: 4,
        opacity: 0.8
      });
    }

    return lines;
  };

  // ---------------------------------------------
  // getParentColor
  // ---------------------------------------------
  // Returns the color associated with a parent/team, or gray if unassigned.
  const getParentColor = (parentId: string | null) => {
    if (!parentId) return '#6B7280'; // Gray for unassigned
    const parent = state.parents.find(p => p.id === parentId);
    return parent?.color || '#6B7280';
  };

  // ---------------------------------------------
  // handleMarkerClick
  // ---------------------------------------------
  // Sets the selected task in the global state when a marker is clicked.
  const handleMarkerClick = (taskId: string) => {
    dispatch({ type: 'SET_SELECTED_TASK', taskId, toggle_parent: state.selectedParentId });
  };

  // ---------------------------------------------
  // handleParentToggle && handleNullToggle
  // ---------------------------------------------
  // Toggles the parent/team/null filter. If already selected, switches to "all".
  const handleParentToggle = (parentId: string | null) => {
    dispatch({
      type: 'SET_SELECTED_PARENT',
      parentId: state.selectedParentId === parentId ? 'all' : parentId
    });
  };

  const handleNullToggle = () => {
    dispatch({
      type: 'TOGGLE_NULL',
      toggledNull: state.toggledNull ? false : true
    })
  }

  // ---------------------------------------------
  // MapController Component
  // ---------------------------------------------
  // Handles map fly-to behavior when a task is selected.
  // Also toggles parent filter if "any" is selected.
  function MapController() {
    const { state } = useApp();
    const map = useMap();

    useEffect(() => {
      if (state.selectedTaskId) {
        const task = state.tasks.find(t => t.id === state.selectedTaskId);
        if (task) {
          map.flyTo([task.location.lat, task.location.lon], 15, { duration: 1 });
        }

        if (state.selectedParentId === 'any') handleParentToggle(state.selectedParentId);
      }
    }, [state.selectedTaskId, state.tasks, map]);

    return null;
  }

  // ---------------------------------------------
  // PolyLine Component
  // ---------------------------------------------
  // Renders a dashed line between two task locations.
  // Cleans up the line when the component unmounts or updates.
  const PolyLine = ({ positions, color, weight, opacity }: any) => {
    const map = useMap();

    useEffect(() => {
      if (positions.length < 2) return;

      const polyline = L.polyline(positions, {
        color,
        weight,
        opacity,
        dashArray: '10, 5'
      }).addTo(map);

      return () => {
        map.removeLayer(polyline);
      };
    }, [positions, color, weight, opacity, map]);

    return null;
  };

  // ---------------------------------------------
  // Render
  // ---------------------------------------------
  // Main render block for the WorldMap component.
  // Includes header, filter controls, map, markers, popups, and connection lines.
  return (
    <div className="bg-white rounded-lg shadow-lg p-6 h-full flex flex-col">
      {/* Header and Filter Controls */}
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-2">
          <MapIcon className="text-blue-600" size={24} />
          <h2 className="text-xl font-semibold text-gray-800">Task Locations</h2>
        </div>

        {/* Team/Parent Filter Buttons */}
        <div className="flex gap-2">
          {/* All Tasks Button */}
          <button
            onClick={() => handleParentToggle('all')}
            className={`px-3 py-1 rounded-full text-xs font-medium transition-colors ${
              state.selectedParentId === 'all'
                ? 'bg-gray-700 text-white'
                : 'bg-gray-200 text-gray-700 hover:bg-gray-300'
            }`}
          >
            All
          </button>
          {/* Team Buttons */}
          {state.parents.map(parent => (
            <button
              key={parent.id}
              onClick={() => handleParentToggle(parent.id)}
              className={`px-3 py-1 rounded-full text-xs font-medium transition-colors ${
                state.selectedParentId === parent.id
                  ? 'text-white'
                  : 'text-gray-700 hover:opacity-80'
              }`}
              style={{
                backgroundColor:
                  state.selectedParentId === parent.id ? parent.color : `${parent.color}20`,
                borderColor: parent.color,
                borderWidth: '1px',
                borderStyle: 'solid'
              }}
            >
              {parent.name}
            </button>
          ))}
          
          {/* Unassigned Button */}
          <button 
            onClick={() => handleNullToggle()}
            className={`px-3 py-1 rounded-full text-xs font-medium transition-colors border border-gray-400 ${
              state.toggledNull === true
                ? 'bg-gray-600 text-white'
                : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
            }`}
          >
            Unassigned
          </button>
        </div>
      </div>

      {/* Map Display */}
      <div className="flex-1 rounded-lg overflow-hidden">
        <MapContainer
          center={[45.5017, -73.5673]}
          zoom={13}
          style={{ height: '100%', width: '100%' }}
          className="rounded-lg"
        >
          {/* Map Tiles */}
          <TileLayer
            attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
            url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
          />
          {/* Handles fly-to and parent toggling on selection */}
          <MapController />

          {/* Deselects task when clicking on map background */}
          <DeselectOnMapClick onDeselect={() => handleMarkerClick('')} />
          
          {/* Connection Lines (PolyLines) for filtered views */}
          {getTaskConnectionLines().map(line => (
            <PolyLine
              key={line.id}
              positions={line.positions}
              color={line.color}
              weight={line.weight}
              opacity={line.opacity}
            />
          ))}

          {/* Markers and Popups */}
          {(() => {
            // ALL view: show plain markers for all tasks
            if (state.selectedParentId === 'all') {
              return getVisibleTasks().map(task => {
                const isSelected = state.selectedTaskId === task.id;
                const parentColor = getParentColor(task.parentId);

                return (
                  <Marker
                    key={task.id}
                    position={[task.location.lat, task.location.lon]}
                    icon={createCustomIcon(parentColor, isSelected)} // no index
                    eventHandlers={{ click: () => handleMarkerClick(task.id) }}
                  >
                    {/* Popup with detailed task stats */}
                    <Popup>
                      <div className="p-2 space-y-1">
                        <h3 className="font-semibold text-gray-800">{task.name}</h3>
                        <div className="text-xs text-gray-700">
                          <div><span className="font-medium">Task ID:</span> {task.id}</div>
                          <div><span className="font-medium">Parent:</span> {task.parentId ? (state.parents.find(p => p.id === task.parentId)?.name || task.parentId) : 'Unassigned'}</div>
                          <div><span className="font-medium">Start Hour:</span> {task.startHour}</div>
                          <div><span className="font-medium">Default Duration:</span> {task.durationHours}h</div>
                          <div><span className="font-medium">Active Duration:</span> {
                              task.parentId && typeof task.specialTeams?.[task.parentId] === 'number'
                                ? task.specialTeams[task.parentId]
                                : task.durationHours
                            }h</div>
                          <div><span className="font-medium">Setup Duration:</span> {task.setup}h</div>
                          <div><span className="font-medium">Total Duration:</span> {
                              task.parentId && typeof task.specialTeams?.[task.parentId] === 'number'
                                ? (task.specialTeams[task.parentId] as number) + task.setup
                                : task.durationHours + task.setup
                            }h</div>
                          <div><span className="font-medium">Special Teams:</span> {
                              task.specialTeams
                                ? Object.entries(task.specialTeams).map(([team, val]) => `${team}: ${val}`).join(', ')
                                : 'None'
                            }</div>
                          <div><span className="font-medium">Location:</span> {task.location.lat.toFixed(4)}, {task.location.lon.toFixed(4)}</div>
                          <div><span className="font-medium">Invalid Periods:</span> {task.invalidPeriods?.length ? task.invalidPeriods.join(', ') : 'None'}</div>
                          <div><span className="font-medium">Dependencies:</span> {task.dependencies?.length ? task.dependencies.join(', ') : 'None'}</div>
                        </div>
                      </div>
                    </Popup>
                  </Marker>
                );
              });
            }

            // Filtered view: show numbered markers and simple popups for tasks in the selected team
            const assignedTasks = getVisibleTasks()
              .filter(task => task.parentId === state.selectedParentId)
              .sort((a, b) => a.startHour - b.startHour);

            const unassignedTasks = state.toggledNull
              ? getVisibleTasks().filter(task => task.parentId === null)
              : [];

            return (
              <>
                {/* Assigned tasks: numbered markers */}
                {assignedTasks.map((task, index) => {
                  const isSelected = state.selectedTaskId === task.id;
                  const parentColor = getParentColor(task.parentId);
                  const markerIndex = index + 1;

                  return (
                    <Marker
                      key={task.id}
                      position={[task.location.lat, task.location.lon]}
                      icon={createCustomIcon(parentColor, isSelected, markerIndex)}
                      eventHandlers={{ click: () => handleMarkerClick(task.id) }}
                    >
                      <Popup>
                        <div className="p-2">
                          <h3 className="font-semibold text-gray-800">{task.name}</h3>
                          <p className="text-sm text-gray-600">
                            Parent:{' '}
                            {task.parentId
                              ? state.parents.find(p => p.id === task.parentId)?.name || 'Unknown'
                              : 'Unassigned'}
                          </p>
                          <div className="flex items-center gap-1 text-xs text-gray-500 mt-1">
                            <MapPin size={12} />
                            {task.location.lat.toFixed(4)}, {task.location.lon.toFixed(4)}
                          </div>
                        </div>
                      </Popup>
                    </Marker>
                  );
                })}

                {/* Unassigned tasks: plain markers, no numbers */}
                {unassignedTasks.map(task => {
                  const isSelected = state.selectedTaskId === task.id;
                  const parentColor = getParentColor(task.parentId);

                  return (
                    <Marker
                      key={task.id}
                      position={[task.location.lat, task.location.lon]}
                      icon={createCustomIcon(parentColor, isSelected)}
                      eventHandlers={{ click: () => handleMarkerClick(task.id) }}
                    >
                      <Popup>
                        <div className="p-2">
                          <h3 className="font-semibold text-gray-800">{task.name}</h3>
                          <p className="text-sm text-gray-600">Parent: Unassigned</p>
                          <div className="flex items-center gap-1 text-xs text-gray-500 mt-1">
                            <MapPin size={12} />
                            {task.location.lat.toFixed(4)}, {task.location.lon.toFixed(4)}
                          </div>
                        </div>
                      </Popup>
                    </Marker>
                  );
                })}
              </>
            );
          })()}
        </MapContainer>
      </div>
    </div>
  );
}