import { useEffect, useRef, useState } from 'react';
import { useMapEvents, MapContainer, TileLayer, Marker, Popup, useMap } from 'react-leaflet';
import L from 'leaflet';
import { Map as MapIcon, MapPin, Maximize2, Minimize2, RotateCcw } from 'lucide-react';
import { useApp } from '../context/AppContext';
import { Task, Team } from '../types';
import { findEarliestHour, effectiveDuration, isDisallowed, getTaskColor } from '../helper/taskUtils';
import 'leaflet/dist/leaflet.css';
import proj4 from 'proj4';

const DEFAULT_POSITION: { x: number, y: number } = { x: 1156, y: 66 };
const DEFAULT_SIZE: { width: number, height: number } = { width: 750, height: 475 };

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

  const containerRef: React.RefObject<HTMLDivElement> = useRef<HTMLDivElement>(null);
  const wrapperRef: React.RefObject<HTMLDivElement> = useRef<HTMLDivElement>(null);
  const mapRef: React.MutableRefObject<L.Map | null> = useRef<L.Map | null>(null);

  const [isMaximized, setIsMaximized] = useState(false);
  const [position, setPosition] = useState(DEFAULT_POSITION);
  const [size, setSize] = useState(DEFAULT_SIZE);
  const dragStartRef = useRef({ x: 0, y: 0 });

  // Filter states
  const [selectedAvvForm, setSelectedAvvForm] = useState<string[]>(['�A', 'GA', 'SA']);
  const [selectedBarighet, setSelectedBarighet] = useState<string[]>([]);
  const [showAvvFormPopup, setShowAvvFormPopup] = useState(false);
  const [showBarighetPopup, setShowBarighetPopup] = useState(false);

  useEffect(() => {
    if (!mapRef.current) return;

    // immediate revalidation
    mapRef.current.invalidateSize();

    // delay revalidation (after DOM reflow)
    setTimeout(() => {
      mapRef.current?.invalidateSize();
    }, 300);

  }, [isMaximized, size]);

  useEffect(() => {
    if (isMaximized || !containerRef.current) return;

    const handleMouseDown = (e: MouseEvent) => {
      const target: HTMLElement = e.target as HTMLElement;

      // Only allow dragging if not clicking on the map container itself
      if (target.closest('.leaflet-container')) return;

      e.preventDefault();
      dragStartRef.current = {
        x: e.clientX - position.x,
        y: e.clientY - position.y
      };

      const handleMouseMove = (e: MouseEvent) => {
        setPosition({
          x: e.clientX - dragStartRef.current.x,
          y: e.clientY - dragStartRef.current.y
        });
      };

      const handleMouseUp = () => {
        document.removeEventListener('mousemove', handleMouseMove);
        document.removeEventListener('mouseup', handleMouseUp);
      };

      document.addEventListener('mousemove', handleMouseMove);
      document.addEventListener('mouseup', handleMouseUp);
    };

    const container: HTMLDivElement = containerRef.current;
    container.addEventListener('mousedown', handleMouseDown);

    return () => {
      container.removeEventListener('mousedown', handleMouseDown);
    };
  }, [isMaximized, position]);

  const handleReset = () => {
    setPosition(DEFAULT_POSITION);
    setSize(DEFAULT_SIZE);
    setIsMaximized(false);
  };

  const handleResize = (e: React.MouseEvent, edge: string) => {
    e.preventDefault();
    e.stopPropagation();

    const startX: number = e.clientX;
    const startY: number = e.clientY;
    const startWidth: number = size.width;
    const startHeight: number = size.height;
    const startPosX: number = position.x;
    const startPosY: number = position.y;

    const handleMouseMove = (e: MouseEvent) => {
      const deltaX: number = e.clientX - startX;
      const deltaY: number = e.clientY - startY;

      let newWidth = startWidth;
      let newHeight = startHeight;
      let newPosX = startPosX;
      let newPosY = startPosY;

      if (edge.includes('e')) {
        newWidth = Math.max(400, startWidth + deltaX);
      }
      if (edge.includes('w')) {
        newWidth = Math.max(400, startWidth - deltaX);
        newPosX = startPosX + (startWidth - newWidth);
      }
      if (edge.includes('s')) {
        newHeight = Math.max(300, startHeight + deltaY);
      }
      if (edge.includes('n')) {
        newHeight = Math.max(300, startHeight - deltaY);
        newPosY = startPosY + (startHeight - newHeight);
      }

      setSize({ width: newWidth, height: newHeight });
      setPosition({ x: newPosX, y: newPosY });
    };

    const handleMouseUp = () => {
      document.removeEventListener('mousemove', handleMouseMove);
      document.removeEventListener('mouseup', handleMouseUp);
    };

    document.addEventListener('mousemove', handleMouseMove);
    document.addEventListener('mouseup', handleMouseUp);
  };

  const toggleMaximized = () => {
    setIsMaximized(!isMaximized);
  };

  const createMarkerIcon = (color: string, isSelected: boolean = false, index?: number) => {
    const size: number = isSelected ? 20 : 8;

    const iconHtml: string = `
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

  const createUnassignedMarkerIcon = (color: string, isSelected: boolean = false, index?: number) => {
    const size: number = isSelected ? 20 : 8;

    const iconHtml: string = `
      <div style="
        background-color: ${color};
        width: ${size}px;
        height: ${size}px;
        border-radius: 0;
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

  // Home base triangle icon for teams
  const createHomeBaseIcon = (color: string, isSelected: boolean = false) => {
    const size: number = isSelected ? 12 : 8;
    const stroke: number = isSelected ? 2 : 1;
    const iconHtml: string = `
      <svg width="${size}" height="${size}" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg" style="filter: drop-shadow(0 2px 4px rgba(0,0,0,0.35));">
        <polygon points="12,2 22,22 2,22" fill="${color}" stroke="black" stroke-width="${stroke}" />
      </svg>
    `;
    return L.divIcon({
      html: iconHtml,
      className: 'custom-marker',
      iconSize: [size, size],
      iconAnchor: [size / 2, size / 2]
    });
  };

  const getVisibleTasks = () => {
    let tasks: Task[] = state.tasks;

    // Filter by team
    if (state.selectedTeamId === 'all') {
      tasks = tasks.filter(task =>
        (task.duration.teamId !== null) ||
        (state.toggledNull && task.duration.teamId === null)
      );
    } else {
      tasks = tasks.filter(task =>
        (task.duration.teamId === state.selectedTeamId) ||
        (state.toggledNull && task.duration.teamId === null)
      );
    }

    // Filter by avvForm
    tasks = tasks.filter(task => selectedAvvForm.includes(task.task.avvForm));

    // Filter by barighet
    tasks = tasks.filter(task => selectedBarighet.includes(task.task.barighet));

    return tasks;
  };

  const getVisibleTeams = () => {
    if (state.selectedTeamId === 'all' || state.selectedTeamId === null) return state.teams;
    const t: Team | undefined = state.teams.find(t => t.id === state.selectedTeamId);
    return t ? [t] : [];
  };

  const getTaskConnectionLines = () => {
    if (state.selectedTeamId === 'all' || state.selectedTeamId === null) return [];

    // Get the first month's period IDs
    const firstMonth = state.months[0];
    if (!firstMonth) return [];

    // Get periods that belong to the first month
    const firstMonthPeriods = state.periods.filter(p => firstMonth.periods.includes(p.id));

    // Get the boundaries for the first month
    const firstMonthStart = 0;
    const firstMonthEnd = firstMonthPeriods.reduce((sum, period) => sum + period.length_h, 0);

    console.log(firstMonthStart, firstMonthEnd);

    const visibleTasks: Task[] = getVisibleTasks().filter(task =>
      task.duration.teamId === state.selectedTeamId &&
      task.duration.startHour >= firstMonthStart &&
      task.duration.startHour < firstMonthEnd
    );

    const sortedTasks: Task[] = [...visibleTasks].sort((a, b) => a.duration.startHour - b.duration.startHour);

    const lines = [];
    for (let i = 0; i < sortedTasks.length - 1; i++) {
      const currentTask: Task = sortedTasks[i];
      const nextTask: Task = sortedTasks[i + 1];

      // Convert SWEREF99 to WGS84 for display
      const currentPos: [number, number] = swerefToWGS84(currentTask.task.lat, currentTask.task.lon);
      const nextPos: [number, number] = swerefToWGS84(nextTask.task.lat, nextTask.task.lon);

      lines.push({
        id: `${currentTask.task.id}-${nextTask.task.id}`,
        positions: [currentPos, nextPos],
        color: getTaskColor(currentTask, state.teams.find(t => t.id === currentTask.duration.teamId)?.color),
        weight: 2.5,
        opacity: 0.8
      });
    }

    return lines;
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

  // Get unique barighet values dynamically
  const getUniqueBarighet = () => {
    const barighetValues = new Set<string>();
    state.tasks.forEach(task => {
      if (task.task.barighet) {
        barighetValues.add(task.task.barighet);
      }
    });
    return Array.from(barighetValues).sort();
  };

  // Initialize barighet filter when tasks change
  useEffect(() => {
    const uniqueBarighet = getUniqueBarighet();
    if (selectedBarighet.length === 0 && uniqueBarighet.length > 0) {
      setSelectedBarighet(uniqueBarighet);
    }
  }, [state.tasks]);

  // Toggle avvForm filter
  const toggleAvvForm = (form: string) => {
    setSelectedAvvForm(prev =>
      prev.includes(form)
        ? prev.filter(f => f !== form)
        : [...prev, form]
    );
  };

  // Toggle barighet filter
  const toggleBarighet = (barighet: string) => {
    setSelectedBarighet(prev =>
      prev.includes(barighet)
        ? prev.filter(b => b !== barighet)
        : [...prev, barighet]
    );
  };

  // Close popups when clicking outside
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      const target = e.target as HTMLElement;
      if (!target.closest('.filter-popup') && !target.closest('.filter-button')) {
        setShowAvvFormPopup(false);
        setShowBarighetPopup(false);
      }
    };

    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const ResizeHandler = () => {
    const map: L.Map = useMap();
    const container: HTMLElement = map.getContainer();

    useEffect(() => {
      const observer: ResizeObserver = new ResizeObserver(() => {
        map.invalidateSize();
      });

      observer.observe(container);
      return () => observer.disconnect();
    }, [map, container]);

    return null
  }

  // MapController Component
  function MapController() {
    const { state } = useApp();
    const map: L.Map = useMap();

    useEffect(() => {
      if (state.selectedTaskId) {
        const task: Task | undefined = state.tasks.find(t => t.task.id === state.selectedTaskId);
        if (task) {
          try {
            // Convert SWEREF99 to WGS84
            const [lat, lon]: [number, number] = swerefToWGS84(task.task.lat, task.task.lon);

            if (isFinite(lat) && isFinite(lon)) {
              // Check if the marker is within the current map bounds
              const bounds: L.LatLngBounds = map.getBounds();
              const markerLatLng: L.LatLng = L.latLng(lat, lon);

              if (!bounds.contains(markerLatLng)) {
                // Only move the map if the marker is outside the current view
                console.log(`Moving to task ${task.task.id}:`, { sweref: [task.task.lat, task.task.lon], wgs84: [lat, lon] });
                map.setView([lat, lon], map.getZoom(), { animate: true, duration: 1 });
              } else {
                console.log(`Task ${task.task.id} is already in view, not moving map`);
              }
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
    const map: L.Map = useMap();

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
    const map: L.Map = useMap();
    const wgs84Pos: [number, number] = swerefToWGS84(task.task.lat, task.task.lon);
    const markerRef: React.RefObject<L.Marker<any>> = useRef<L.Marker>(null);
    const [, setIsDragging] = useState(false);

    useEffect(() => {
      const marker: L.Marker<any> | null = markerRef.current;
      if (!marker) return;

      let isDrag = false;
      let cloneElement: HTMLElement | null = null;
      let hasMoved = false;
      let startX = 0;
      let startY = 0;

      const handleMouseDown = (e: L.LeafletMouseEvent) => {
        e.originalEvent.stopPropagation();
        e.originalEvent.preventDefault();

        if (state.selectedTaskId !== task.task.id) {
          dispatch({
            type: 'SET_DRAGGING_TO_GANTT',
            taskId: task.task.id
          });
        }

        isDrag = false;
        hasMoved = false;
        startX = e.originalEvent.clientX;
        startY = e.originalEvent.clientY;
        setIsDragging(true);

        if (map?.dragging?.disable) map.dragging.disable();

        const markerElement: HTMLElement | undefined = marker.getElement();
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
          const dx = Math.abs(e.clientX - startX);
          const dy = Math.abs(e.clientY - startY);
          
          // Consider it a drag if moved more than 5 pixels
          if (dx > 5 || dy > 5) {
            isDrag = true;
            hasMoved = true;
          }

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

          // If it wasn't a drag (just a click), open the popup
          if (!hasMoved) {
            handleMarkerClick(task.task.id);
            // Manually open the popup
            marker.openPopup();
          } else {
            // It was a drag, handle the drop logic
            const elementUnderMouse: Element | null = document.elementFromPoint(e.clientX, e.clientY);
            const ganttChart: Element | null | undefined = elementUnderMouse?.closest('.gantt-chart-container');

            if (ganttChart) {
              const teamRow: Element | null | undefined = elementUnderMouse?.closest('[data-team-row]');

              if (teamRow) {
                const teamId: string | null = teamRow.getAttribute('data-team-id');

                if (teamId && !isDisallowed(task, teamId)) {
                  const timeline: Element | null = ganttChart.querySelector('.timeline-content');
                  const timelineRect: DOMRect | undefined = timeline?.getBoundingClientRect();

                  if (timelineRect) {
                    const totalHours: number = state.totalHours;
                    const filteredTasks: Task[] = state.tasks
                      .filter(t => t.duration.teamId === teamId)
                      .sort((a, b) => a.duration.startHour - b.duration.startHour)

                    console.log(`Attempting to move task "${task.task.id}" to team ${teamId}`);
                    console.log(`Task: ${effectiveDuration(task, teamId)}h, Existing tasks in team: ${filteredTasks.length}`);

                    const result: number | null = findEarliestHour(task, filteredTasks, totalHours, state.periods, teamId);

                    if (result !== null) {
                      dispatch({
                        type: 'UPDATE_TASK_TEAM',
                        taskId: task.task.id,
                        newTeamId: teamId
                      });
                      dispatch({
                        type: 'UPDATE_TASK_HOURS',
                        taskId: task.task.id,
                        startHour: result,
                        defaultDuration: task.duration.defaultDuration
                      });
                      dispatch({
                        type: 'TOGGLE_COMPARISON_MODAL',
                        toggledModal: true
                      });

                      if (state.taskSnapshot.length === 0) {
                        dispatch({ type: 'SET_TASKSNAPSHOT', taskSnapshot: state.tasks });
                      }

                      // Success
                      console.log(`✅ Task successfully placed at hour ${result}`);
                    } else {
                      console.log(`FAILED: No valid slot found for task in team ${teamId}`);
                      console.log(`Reason: No gaps large enough or all slots conflict with invalid periods`);

                      // Failure
                      console.log(`❌ Unable to place task\n\nNo valid time slot found in this team.\nTry:\n• Removing or moving other tasks\n• Checking period restrictions\n• Using a different team`);
                    }
                  }
                }
                else {
                  console.log(`❌ Task not allowed in team ${teamId}`);
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
    }, [map, wgs84Pos, task.task.id]);

    return (
      <Marker
        key={task.task.id}
        ref={markerRef}
        position={wgs84Pos}
        icon={createUnassignedMarkerIcon(
          getTaskColor(task, state.teams.find(t => t.id === task.duration.teamId)?.color),
          state.selectedTaskId === task.task.id
        )}
      >
        <Popup>
          <div className="p-2">
            <h3 className="font-semibold text-gray-800">{task.task.id}</h3>
            <p className="text-sm text-gray-600">Team: {task.duration.teamId === null ? 'Unassigned' : task.duration.teamId}</p>
            <p className="text-sm text-gray-600">Avvform: {task.task.avvForm}</p>
            <p className="text-sm text-gray-600">Barighet: {task.task.barighet}</p>
            <div className="flex items-center gap-1 text-xs text-gray-500 mt-1">
              <MapPin size={12} />
              N: {task.task.lat.toFixed(2)}, E: {task.task.lon.toFixed(2)}
            </div>
          </div>
        </Popup>
      </Marker>
    );
  }

  // Render
  return (
    <div
      ref={wrapperRef}
      className={`${isMaximized ? 'fixed inset-0 z-50' : 'absolute z-10'}`}
      style={
        isMaximized
          ? {}
          : {
            left: `${position.x}px`,
            top: `${position.y}px`,
            width: `${size.width}px`,
            height: `${size.height}px`,
          }
      }
    >

      {/* Resize Handles */}
      {!isMaximized && (
        <>
          {/* Corner handles */}
          <div
            onMouseDown={(e) => handleResize(e, 'nw')}
            className="absolute -top-1 -left-1 w-3 h-3 cursor-nw-resize z-10 hover:bg-blue-200 transition-colors"
          />
          <div
            onMouseDown={(e) => handleResize(e, 'ne')}
            className="absolute -top-1 -right-1 w-3 h-3 cursor-ne-resize z-10 hover:bg-blue-200 transition-colors"
          />
          <div
            onMouseDown={(e) => handleResize(e, 'sw')}
            className="absolute -bottom-1 -left-1 w-3 h-3 cursor-sw-resize z-10 hover:bg-blue-200 transition-colors"
          />
          <div
            onMouseDown={(e) => handleResize(e, 'se')}
            className="absolute -bottom-1 -right-1 w-3 h-3 cursor-se-resize z-10 hover:bg-blue-200 transition-colors"
          />

          {/* Edge handles */}
          <div
            onMouseDown={(e) => handleResize(e, 'n')}
            className="absolute -top-1 left-8 right-8 h-2 cursor-n-resize z-10 hover:bg-blue-200 transition-colors"
          />
          <div
            onMouseDown={(e) => handleResize(e, 's')}
            className="absolute -bottom-1 left-8 right-8 h-2 cursor-s-resize z-10 hover:bg-blue-200 transition-colors"
          />
          <div
            onMouseDown={(e) => handleResize(e, 'w')}
            className="absolute -left-1 top-8 bottom-8 w-2 cursor-w-resize z-10 hover:bg-blue-200 transition-colors"
          />
          <div
            onMouseDown={(e) => handleResize(e, 'e')}
            className="absolute -right-1 top-8 bottom-8 w-2 cursor-e-resize z-10 hover:bg-blue-200 transition-colors"
          />
        </>
      )}

      {/* Heading */}
      <div
        ref={containerRef}
        className="world-map-container bg-white rounded-lg shadow-lg p-4 h-full flex flex-col"
        style={{ cursor: !isMaximized ? 'move' : 'default' }}
      >
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-2">
            <MapIcon className="text-blue-600" width="24" height="24" />
            <h2 className="text-xl font-semibold text-gray-800">Task Locations</h2>
          </div>

          <div className="flex items-center gap-2 control-buttons">
            <button
              onClick={toggleMaximized}
              className="p-2 rounded-lg bg-gray-200 text-gray-700 hover:bg-gray-300 transition-colors"
              title={isMaximized ? 'Restore' : 'Maximize'}
            >
              {isMaximized ? <Minimize2 size={18} /> : <Maximize2 size={18} />}
            </button>

            <button
              onClick={handleReset}
              className="p-2 rounded-lg bg-gray-200 text-gray-700 hover:bg-gray-300 transition-colors"
              title="Reset map size"
            >
              <RotateCcw size={18} />
            </button>
          </div>
        </div>

        {/* Sub Heading */}
        {/* Team Filters */}
        <div className="mb-4">
          <h3 className="text-xs font-semibold text-gray-600 mb-2">Filters</h3>
          <div className="flex flex-wrap gap-2">
            <button
              onClick={() => handleTeamToggle('all')}
              className={`px-3 py-1 rounded-full text-xs font-medium transition-colors ${state.selectedTeamId === 'all'
                  ? 'bg-gray-700 text-white'
                  : 'bg-gray-200 text-gray-700 hover:bg-gray-300'
                }`}
            >
              All Teams
            </button>

            {/* Unassigned Button */}
            <button
              onClick={() => handleNullToggle()}
              className={`px-3 py-1 rounded-full text-xs font-medium transition-all duration-200 border-2 ${state.toggledNull === true
                  ? 'bg-orange-500 text-white border-orange-600 shadow-md hover:bg-orange-600'
                  : 'bg-white text-orange-600 border-orange-400 hover:bg-orange-50 hover:border-orange-500'
                }`}
            >
              Unassigned
            </button>

            {/* AvvForm Filter Button */}
            <div className="relative">
              <button
                onClick={() => {
                  setShowAvvFormPopup(!showAvvFormPopup);
                  setShowBarighetPopup(false);
                }}
                className="filter-button px-3 py-1 rounded-full text-xs font-medium transition-colors bg-blue-500 text-white hover:bg-blue-600 flex items-center gap-1"
              >
                AvvForm ({selectedAvvForm.length})
              </button>

              {showAvvFormPopup && (
                <div className="filter-popup absolute top-full left-0 mt-1 bg-white border border-gray-300 rounded-lg shadow-lg p-3 z-50 min-w-[150px] z-50 style={{ zIndex: 9999 }}">
                  <div className="space-y-2">
                    {['�A', 'GA', 'SA'].map(form => (
                      <label key={form} className="flex items-center gap-2 cursor-pointer hover:bg-gray-50 p-1 rounded">
                        <input
                          type="checkbox"
                          checked={selectedAvvForm.includes(form)}
                          onChange={() => toggleAvvForm(form)}
                          className="w-4 h-4 cursor-pointer"
                        />
                        <span className="text-sm text-gray-700">{form}</span>
                      </label>
                    ))}
                  </div>
                </div>
              )}
            </div>

            {/* Barighet Filter Button */}
            <div className="relative">
              <button
                onClick={() => {
                  setShowBarighetPopup(!showBarighetPopup);
                  setShowAvvFormPopup(false);
                }}
                className="filter-button px-3 py-1 rounded-full text-xs font-medium transition-colors bg-teal-500 text-white hover:bg-teal-600 flex items-center gap-1"
              >
                Barighet ({selectedBarighet.length})
              </button>

              {showBarighetPopup && (
                <div className="filter-popup absolute top-full left-0 mt-1 bg-white border border-gray-300 rounded-lg shadow-lg p-3 z-50 min-w-[150px] max-h-[300px] overflow-y-auto z-50 style={{ zIndex: 9999 }}">
                  <div className="space-y-2">
                    {getUniqueBarighet().map(barighet => (
                      <label key={barighet} className="flex items-center gap-2 cursor-pointer hover:bg-gray-50 p-1 rounded">
                        <input
                          type="checkbox"
                          checked={selectedBarighet.includes(barighet)}
                          onChange={() => toggleBarighet(barighet)}
                          className="w-4 h-4 cursor-pointer"
                        />
                        <span className="text-sm text-gray-700">{barighet}</span>
                      </label>
                    ))}
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>

        {/* Map Container */}
        <div className="flex-1 rounded-lg overflow-hidden" style={{ cursor: 'default', zIndex: 1 }}>
          <MapContainer
            ref={mapRef}
            center={[62.0, 15.0]}
            zoom={5}
            maxZoom={19}
            style={{ height: '100%', width: '100%' }}
            className="rounded-lg"
          >
            <TileLayer
              attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
              url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
            />
            <ResizeHandler />
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

            {getVisibleTeams().map(team => {
              const isSelectedTeam: boolean = state.selectedTeamId === team.id;
              const wgs84Pos: [number, number] = swerefToWGS84(team.lat, team.lon);
              return (
                <Marker
                  key={`homebase-${team.id}`}
                  position={wgs84Pos}
                  icon={createHomeBaseIcon(team.color, isSelectedTeam)}
                  eventHandlers={{ click: () => handleTeamToggle(team.id) }}
                >
                  <Popup>
                    <div className="p-2">
                      <h3 className="font-semibold text-gray-800">Team {team.id}</h3>
                      <p className="text-xs text-gray-600">Home base</p>
                      <div className="flex items-center gap-1 text-xs text-gray-500 mt-1">
                        <MapPin size={12} />
                        N: {team.lat.toFixed(2)}, E: {team.lon.toFixed(2)}
                      </div>
                    </div>
                  </Popup>
                </Marker>
              );
            })}

            {(() => {
              if (state.selectedTeamId === 'all') {
                const assignedTasks: Task[] = getVisibleTasks().filter(task => task.duration.teamId !== null);
                const unassignedTasks: Task[] = state.toggledNull
                  ? getVisibleTasks().filter(task => task.duration.teamId === null)
                  : [];

                return (
                  <>
                    {assignedTasks.map((task) => {
                      const isSelected: boolean = state.selectedTaskId === task.task.id;
                      const teamColor: string = getTaskColor(task, state.teams.find(t => t.id === task.duration.teamId)?.color);
                      const wgs84Pos: [number, number] = swerefToWGS84(task.task.lat, task.task.lon);

                      return (
                        <Marker
                          key={task.task.id}
                          position={wgs84Pos}
                          icon={createMarkerIcon(teamColor, isSelected)}
                          eventHandlers={{ click: () => handleMarkerClick(task.task.id) }}
                        >
                          <Popup>
                            <div className="p-2">
                              <h3 className="font-semibold text-gray-800">{task.task.id}</h3>
                              <p className="text-sm text-gray-600">Team: {task.duration.teamId === null ? 'Unassigned' : task.duration.teamId}</p>
                              <p className="text-sm text-gray-600">Avvform: {task.task.avvForm}</p>
                              <p className="text-sm text-gray-600">Barighet: {task.task.barighet}</p>
                              <div className="flex items-center gap-1 text-xs text-gray-500 mt-1">
                                <MapPin size={12} />
                                N: {task.task.lat.toFixed(2)}, E: {task.task.lon.toFixed(2)}
                              </div>
                            </div>
                          </Popup>
                        </Marker>
                      );
                    })}

                    {unassignedTasks.map(task => (
                      <DraggableUnassignedMarker key={task.task.id} task={task} />
                    ))}
                  </>
                )
              }

              const assignedTasks: Task[] = getVisibleTasks()
                .filter(task => task.duration.teamId === state.selectedTeamId)
                .sort((a, b) => a.duration.startHour - b.duration.startHour);

              const unassignedTasks = state.toggledNull
                ? getVisibleTasks().filter(task => task.duration.teamId === null)
                : [];

              return (
                <>
                  {assignedTasks.map((task, index) => {
                    const isSelected: boolean = state.selectedTaskId === task.task.id;
                    const teamColor: string = getTaskColor(task, state.teams.find(t => t.id === task.duration.teamId)?.color);
                    const markerIndex: number = index + 1;
                    const wgs84Pos: [number, number] = swerefToWGS84(task.task.lat, task.task.lon);

                    return (
                      <Marker
                        key={task.task.id}
                        position={wgs84Pos}
                        icon={createMarkerIcon(teamColor, isSelected, markerIndex)}
                        eventHandlers={{ click: () => handleMarkerClick(task.task.id) }}
                      >
                        <Popup>
                          <div className="p-2">
                            <h3 className="font-semibold text-gray-800">{task.task.id}</h3>
                            <p className="text-sm text-gray-600">Team: {task.duration.teamId === null ? 'Unassigned' : task.duration.teamId}</p>
                            <p className="text-sm text-gray-600">Avvform: {task.task.avvForm}</p>
                            <p className="text-sm text-gray-600">Barighet: {task.task.barighet}</p>
                            <div className="flex items-center gap-1 text-xs text-gray-500 mt-1">
                              <MapPin size={12} />
                              N: {task.task.lat.toFixed(2)}, E: {task.task.lon.toFixed(2)}
                            </div>
                          </div>
                        </Popup>
                      </Marker>
                    );
                  })}

                  {unassignedTasks.map(task => (
                    <DraggableUnassignedMarker key={task.task.id} task={task} />
                  ))}
                </>
              );
            })()}
          </MapContainer>
        </div>
      </div>
    </div>
  );
}