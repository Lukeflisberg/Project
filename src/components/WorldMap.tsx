import { useEffect, useRef, useState } from 'react';
import { useMapEvents, MapContainer, TileLayer, Marker, Popup, useMap } from 'react-leaflet';
import L from 'leaflet';
import { Map as MapIcon, MapPin } from 'lucide-react';
import { useApp } from '../context/AppContext';
import { Task } from '../types';
import { findEarliestHour } from '../helper/taskUtils';
import 'leaflet/dist/leaflet.css';
import proj4 from 'proj4';

// Define EPSG:3006 (SWEREF99 TM) and WGS84
proj4.defs('EPSG:3006', '+proj=utm +zone=33 +ellps=GRS80 +towgs84=0,0,0,0,0,0,0 +units=m +no_defs');
proj4.defs('EPSG:4326', '+proj=longlat +datum=WGS84 +no_defs');

// Helper function to convert SWEREF99 TM to WGS84
const swerefToWGS84 = (northing: number, easting: number): [number, number] => {
  try {
    const [lon, lat] = proj4('EPSG:3006', 'EPSG:4326', [easting, northing]);
    return [lat, lon];
  } catch (error) {
    console.error('Error converting coordinates:', error, { northing, easting });
    // Fallback to approximate center of Sweden if conversion fails
    return [62.0, 15.0];
  }
};

// Leaflet Marker Icon Fix
delete (L.Icon.Default.prototype as any)._getIconUrl;
L.Icon.Default.mergeOptions({
  iconRetinaUrl: 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.7.1/images/marker-icon-2x.png',
  iconUrl: 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.7.1/images/marker-icon.png',
  shadowUrl: 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.7.1/images/marker-shadow.png',
});

// DeselectOnMapClick Component
function DeselectOnMapClick({ onDeselect }: { onDeselect: () => void }) {
  useMapEvents({
    click() {
      onDeselect();
      console.log("Deselected");
    }
  });
  return null;
}

// WorldMap Component
export function WorldMap() {
  const { state, dispatch } = useApp();

  const createCustomIcon = (color: string, isSelected: boolean = false, index?: number) => {
    const size = isSelected ? 20 : 8;

    const iconHtml = `
      <div style="
        background-color: ${color};
        width: ${size}px;
        height: ${size}px;
        border-radius: 50%;
        border: ${isSelected ? '4px' : '1px'} ${isSelected ? 'solid white' : 'solid black'};
        box-shadow: 0 2px 8px rgba(0,0,0,0.3);
        display: flex;
        align-items: center;
        justify-content: center;
        ${isSelected ? 'animation: pulse 2s infinite;' : ''}
      ">
        <span style="
          position: absolute;
          top: -10px;
          right: -5px;
          color: white;
          font-weight: bold;
          font-size: ${isSelected ? 16 : 12}px;
          text-shadow: 
            -1px -1px 0 black,  
            1px -1px 0 black,
            -1px  1px 0 black,
            1px  1px 0 black;
        ">
          ${index !== undefined ? index : ''}
        </span>
      </div>
    `;

    return L.divIcon({
      html: iconHtml,
      className: 'custom-marker',
      iconSize: [size, size],
      iconAnchor: [size / 2, size / 2]
    });
  };

  const getVisibleTasks = () => {
    if (state.selectedTeamId === 'all') {
      return state.tasks.filter(task =>
        (task.teamId !== null) ||
        (state.toggledNull && task.teamId === null)
      );
    }
    return state.tasks.filter(task =>
      (task.teamId === state.selectedTeamId) ||
      (state.toggledNull && task.teamId === null)
    );
  };

  const getTaskConnectionLines = () => {
    if (state.selectedTeamId === 'all' || state.selectedTeamId === null) return [];

    const visibleTasks = getVisibleTasks().filter(task => task.teamId === state.selectedTeamId);
    const sortedTasks = [...visibleTasks].sort((a, b) => a.startHour - b.startHour);

    const lines = [];
    for (let i = 0; i < sortedTasks.length - 1; i++) {
      const currentTask = sortedTasks[i];
      const nextTask = sortedTasks[i + 1];

      // Convert SWEREF99 to WGS84 for display
      const currentPos = swerefToWGS84(currentTask.location.lat, currentTask.location.lon);
      const nextPos = swerefToWGS84(nextTask.location.lat, nextTask.location.lon);

      lines.push({
        id: `${currentTask.id}-${nextTask.id}`,
        positions: [currentPos, nextPos],
        color: getTeamColor(currentTask.teamId),
        weight: 2.5,
        opacity: 0.8
      });
    }

    return lines;
  };

  const getTeamColor = (teamId: string | null) => {
    if (!teamId) return '#6B7280';
    const team = state.teams.find(p => p.id === teamId);
    return team?.color || '#6B7280';
  };

  const handleMarkerClick = (taskId: string | null) => {
    dispatch({
      type: 'SET_SELECTED_TASK',
      taskId, 
      toggle_team: state.selectedTeamId 
    });
    console.log(`Click on marker ${taskId}`);
  };

  const handleTeamToggle = (teamId: string | null) => {
    dispatch({
      type: 'SET_SELECTED_TEAM',
      teamId: state.selectedTeamId === teamId ? 'all' : teamId
    });
    console.log(`Toggled team ${state.selectedTeamId}`);
  };

  const handleNullToggle = () => {
    dispatch({
      type: 'TOGGLE_NULL',
      toggledNull: state.toggledNull ? false : true
    })
    console.log("Toggled null");
  }

  // MapController Component
  function MapController() {
    const { state } = useApp();
    const map = useMap();

    useEffect(() => {
      if (state.selectedTaskId) {
        const task = state.tasks.find(t => t.id === state.selectedTaskId);
        if (task) {
          try {
            // Convert SWEREF99 to WGS84
            const [lat, lon] = swerefToWGS84(task.location.lat, task.location.lon);
            console.log(`Moving to task ${task.id}:`, { sweref: [task.location.lat, task.location.lon], wgs84: [lat, lon] });
            
            if (isFinite(lat) && isFinite(lon)) {
              map.setView([lat, lon], map.getZoom(), { animate: true, duration: 1 });
            }
          } catch (error) {
            console.error('Error navigating to task:', error);
          }
        }

        if (state.selectedTeamId === 'any') handleTeamToggle(state.selectedTeamId);
      }
    }, [state.selectedTaskId, state.tasks, map]);

    return null;
  }

  // PolyLine Component
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

  function DraggableUnassignedMarker({ task }: { task: Task }) {
    const map = useMap();
    const wgs84Pos = swerefToWGS84(task.location.lat, task.location.lon);
    const markerRef = useRef<L.Marker>(null);
    const [, setIsDragging] = useState(false);

    useEffect(() => {
      const marker = markerRef.current;
      if (!marker) return;

      let isDrag = false;
      let cloneElement: HTMLElement | null = null;

      const handleMouseDown = (e: L.LeafletMouseEvent) => {
        e.originalEvent.stopPropagation();
        e.originalEvent.preventDefault();

        if (state.selectedTaskId !== task.id) {
          dispatch({ 
            type: 'SET_DRAGGING_TO_GANTT', 
            taskId: task.id
          });
        }

        isDrag = false;
        setIsDragging(true);

        if (map?.dragging?.disable) map.dragging.disable();

        const markerElement = marker.getElement();
        if (markerElement) {
          cloneElement = markerElement.cloneNode(true) as HTMLElement;
          cloneElement.style.position = 'fixed';
          cloneElement.style.zIndex = '9999';
          cloneElement.style.pointerEvents = 'none';
          cloneElement.style.opacity = '0.7';
          cloneElement.style.transform = 'none';
          
          cloneElement.style.left = `${e.originalEvent.clientX}px`;
          cloneElement.style.top = `${e.originalEvent.clientY}px`;
          
          document.body.appendChild(cloneElement);
        }

        const handleMouseMove = (e: MouseEvent) => {
          isDrag = true;

          if (cloneElement) {
            cloneElement.style.left = `${e.clientX}px`;
            cloneElement.style.top = `${e.clientY}px`;
          }
        }

        const handleMouseUp = (e: MouseEvent) => {
          setIsDragging(false);
          dispatch({
            type: 'SET_DRAGGING_TO_GANTT',
            taskId: null 
          });

          if (cloneElement && cloneElement.parentNode) {
            cloneElement.parentNode.removeChild(cloneElement);
            cloneElement = null;
          }

          setTimeout(() => {
            if (map?.dragging?.enable) map.dragging.enable();
          }, 0);

          document.removeEventListener('mousemove', handleMouseMove);
          document.removeEventListener('mouseup', handleMouseUp);

          if (!isDrag) {
            handleMarkerClick(task.id);
          }

          const elementUnderMouse = document.elementFromPoint(e.clientX, e.clientY);
          const ganttChart = elementUnderMouse?.closest('.gantt-chart-container');
          
          if (ganttChart) {
            const teamRow = elementUnderMouse?.closest('[data-team-row]');

            if (teamRow) {
              const teamId = teamRow.getAttribute('data-team-id');

              if (teamId) {
                const timeline = ganttChart.querySelector('.timeline-content');
                const timelineRect = timeline?.getBoundingClientRect();

                if (timelineRect) {
                  const totalHours = state.totalHours; 
                  const filteredTasks = state.tasks
                    .filter(t => t.teamId === teamId)
                    .sort((a, b) => a.startHour - b.startHour)

                  const result = findEarliestHour(task, filteredTasks, totalHours, state.periods);
                  
                  if (result !== null) {
                    dispatch({
                      type: 'UPDATE_TASK_TEAM',
                      taskId: task.id,
                      newTeamId: teamId
                    });
                    dispatch({
                      type: 'UPDATE_TASK_HOURS',
                      taskId: task.id,
                      startHour: result,
                      defaultDuration: task.defaultDuration
                    })
                  }
                }
              }
            }
          }
        };

        document.addEventListener('mousemove', handleMouseMove);
        document.addEventListener('mouseup', handleMouseUp);
      };

      marker.on('mousedown', handleMouseDown);

      return () => {
        marker.off('mousedown', handleMouseDown);
        if (map?.dragging?.enable) map.dragging.enable();
      };
    }, [map, wgs84Pos, task.id]);

    return (
      <Marker
        key={task.id}
        ref={markerRef}
        position={wgs84Pos}
        icon={createCustomIcon(
          getTeamColor(task.teamId), 
          state.selectedTaskId === task.id
        )}
      >
        <Popup>
          <div className="p-2">
            <h3 className="font-semibold text-gray-800">{task.id}</h3>
            <p className="text-sm text-gray-600">Team: Unassigned</p>
            <div className="flex items-center gap-1 text-xs text-gray-500 mt-1">
              <MapPin size={12} />
              N: {task.location.lat.toFixed(2)}, E: {task.location.lon.toFixed(2)}
            </div>
          </div>
        </Popup>
      </Marker>
    );
  }

  // Render
  return (
    <div className="world-map-container bg-white rounded-lg shadow-lg p-6 h-full flex flex-col">
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-2">
          <MapIcon className="text-blue-600" size={24} />
          <h2 className="text-xl font-semibold text-gray-800">Task Locations</h2>
        </div>

        <div className="flex flex-wrap gap-2">
          <button
            onClick={() => handleTeamToggle('all')}
            className={`px-3 py-1 rounded-full text-xs font-medium transition-colors ${
              state.selectedTeamId === 'all'
                ? 'bg-gray-700 text-white'
                : 'bg-gray-200 text-gray-700 hover:bg-gray-300'
            }`}
          >
            All
          </button>
          {state.teams.map(team => (
            <button
              key={team.id}
              onClick={() => handleTeamToggle(team.id)}
              className={`relative px-3 py-1 rounded-full text-xs font-medium transition-colors ${
                state.selectedTeamId === team.id
                  ? 'text-white'
                  : 'text-gray-700 hover:opacity-80'
              }`}
              style={{
                backgroundColor: 
                  state.selectedTeamId === team.id
                  ? team.color
                  : `color-mix(in srgb, ${team.color} 20%, transparent)`,
                borderColor: team.color,
                borderWidth: '1px',
                borderStyle: 'solid'
              }}
            >
              {team.id}
            </button>
          ))}
          
          <button 
            onClick={() => handleNullToggle()}
            className={`px-3 py-1 rounded-full text-xs font-medium transition-all duration-200 border-2 ${
              state.toggledNull === true
                ? 'bg-orange-500 text-white border-orange-600 shadow-md hover:bg-orange-600'
                : 'bg-white text-orange-600 border-orange-400 hover:bg-orange-50 hover:border-orange-500'
            }`}
          >
            Unassigned
          </button>
        </div>
      </div>

      <div className="flex-1 rounded-lg overflow-hidden">
        <MapContainer
          center={[62.0, 15.0]}
          zoom={5}
          minZoom={4}
          maxZoom={15}
          style={{ height: '100%', width: '100%' }}
          className="rounded-lg"
        >
          <TileLayer
            attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
            url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
          />
          <MapController />
          <DeselectOnMapClick onDeselect={() => handleMarkerClick(null)} />
          
          {getTaskConnectionLines().map(line => (
            <PolyLine
              key={line.id}
              positions={line.positions}
              color={line.color}
              weight={line.weight}
              opacity={line.opacity}
            />
          ))}

          {(() => {
            if (state.selectedTeamId === 'all') {
              const assignedTasks = getVisibleTasks().filter(task => task.teamId !== null);
              const unassignedTasks = state.toggledNull
                ? getVisibleTasks().filter(task => task.teamId === null)
                : [];

              return (
                <>
                {assignedTasks.map((task) => {
                  const isSelected = state.selectedTaskId === task.id;
                  const teamColor = getTeamColor(task.teamId);
                  const wgs84Pos = swerefToWGS84(task.location.lat, task.location.lon);

                  return (
                  <Marker
                    key={task.id}
                    position={wgs84Pos}
                    icon={createCustomIcon(teamColor, isSelected)} 
                    eventHandlers={{ click: () => handleMarkerClick(task.id) }}
                  >
                    <Popup>
                      <div className="p-2 space-y-1">
                        <h3 className="font-semibold text-gray-800">{task.id}</h3>
                        <div className="text-xs text-gray-700">
                          <div><span className="font-medium">Task ID:</span> {task.id}</div>
                          <div><span className="font-medium">Team:</span> {task.teamId ? (state.teams.find(p => p.id === task.teamId)?.id || task.teamId) : 'Unassigned'}</div>
                          <div><span className="font-medium">Start Hour:</span> {task.startHour}</div>
                          <div><span className="font-medium">Default Duration:</span> {task.defaultDuration}h</div>
                          <div><span className="font-medium">Active Duration:</span> {
                              task.teamId && typeof task.specialTeams?.[task.teamId] === 'number'
                                ? task.specialTeams[task.teamId]
                                : task.defaultDuration
                            }h</div>
                          <div><span className="font-medium">Setup Duration:</span> {task.defaultSetup}h</div>
                          <div><span className="font-medium">Total Duration:</span> {
                              task.teamId && typeof task.specialTeams?.[task.teamId] === 'number'
                                ? (task.specialTeams[task.teamId] as number) + task.defaultSetup
                                : task.defaultDuration + task.defaultSetup
                            }h</div>
                          <div><span className="font-medium">Special Teams:</span> {
                              task.specialTeams
                                ? Object.entries(task.specialTeams).map(([team, val]) => `${team}: ${val}`).join(', ')
                                : 'None'
                            }</div>
                          <div><span className="font-medium">Coordinates:</span> N: {task.location.lat.toFixed(2)}, E: {task.location.lon.toFixed(2)}</div>
                          <div><span className="font-medium">Invalid Periods:</span> {task.invalidPeriods?.length ? task.invalidPeriods.join(', ') : 'None'}</div>
                        </div>
                      </div>
                    </Popup>
                  </Marker>
                  );
                })};

                {unassignedTasks.map(task => (
                  <DraggableUnassignedMarker key={task.id} task={task} />
                ))}
                </>
              )
            }

            const assignedTasks = getVisibleTasks()
              .filter(task => task.teamId === state.selectedTeamId)
              .sort((a, b) => a.startHour - b.startHour);

            const unassignedTasks = state.toggledNull
              ? getVisibleTasks().filter(task => task.teamId === null)
              : [];

            return (
              <>
                {assignedTasks.map((task, index) => {
                  const isSelected = state.selectedTaskId === task.id;
                  const teamColor = getTeamColor(task.teamId);
                  const markerIndex = index + 1;
                  const wgs84Pos = swerefToWGS84(task.location.lat, task.location.lon);

                  return (
                    <Marker
                      key={task.id}
                      position={wgs84Pos}
                      icon={createCustomIcon(teamColor, isSelected, markerIndex)}
                      eventHandlers={{ click: () => handleMarkerClick(task.id) }}
                    >
                      <Popup>
                        <div className="p-2">
                          <h3 className="font-semibold text-gray-800">{task.id}</h3>
                          <p className="text-sm text-gray-600">
                            Team:{' '}
                            {task.teamId
                              ? state.teams.find(p => p.id === task.teamId)?.id || 'Unknown'
                              : 'Unassigned'}
                          </p>
                          <div className="flex items-center gap-1 text-xs text-gray-500 mt-1">
                            <MapPin size={12} />
                            N: {task.location.lat.toFixed(2)}, E: {task.location.lon.toFixed(2)}
                          </div>
                        </div>
                      </Popup>
                    </Marker>
                  );
                })}

                {unassignedTasks.map(task => (
                  <DraggableUnassignedMarker key={task.id} task={task} />
                ))}
              </>
            );
          })()}
        </MapContainer>
      </div>
    </div>
  );
}