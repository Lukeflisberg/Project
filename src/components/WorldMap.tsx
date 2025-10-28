import { useEffect, useRef, useState } from 'react';
import { useMapEvents, MapContainer, TileLayer, Marker, Popup, useMap } from 'react-leaflet';
import L from 'leaflet';
import { Map as MapIcon, MapPin, Maximize2, Minimize2, RotateCcw } from 'lucide-react';
import { useApp } from '../context/AppContext';
import { Task, Team } from '../types';
import { planSequentialLayoutHours, isDisallowed } from '../helper/taskUtils';
import 'leaflet/dist/leaflet.css';
import proj4 from 'proj4';
import { historyManager } from '../context/HistoryManager';

const DEFAULT_POSITION: { x: number, y: number } = { x: 1156, y: 66 };
const DEFAULT_SIZE: { width: number, height: number } = { width: 750, height: 475 };

proj4.defs('EPSG:3006', '+proj=utm +zone=33 +ellps=GRS80 +towgs84=0,0,0,0,0,0,0 +units=m +no_defs');
proj4.defs('EPSG:4326', '+proj=longlat +datum=WGS84 +no_defs');

const getAvvFormColorPalette = (uniqueAvvForm: string[]): Record<string, string> => {
  const colors = ['#FF3B30', '#00D4AA', '#007AFF', '#A8E6CF', '#FFD3B6', '#FFAAA5'];
  const palette: Record<string, string> = {};
  uniqueAvvForm.forEach((avvForm, index) => {
    palette[avvForm] = colors[index % colors.length];
  });

  return palette;
};

const getBarighetColorPalette = (uniqueBarighet: string[]): Record<string, string> => {
  const colors = ['#FFD93D', '#FF9F43', '#EE5A6F', '#A8E6CF', '#FFD3B6', '#FFAAA5', '#FF8B94', '#A8D8EA', '#AA96DA', '#FCBAD3'];
  const palette: Record<string, string> = {};
  uniqueBarighet.forEach((barighet, index) => {
    palette[barighet] = colors[index % colors.length];
  });

  return palette;
};

const swerefToWGS84 = (northing: number, easting: number): [number, number] => {
  try {
    const [lon, lat] = proj4('EPSG:3006', 'EPSG:4326', [easting, northing]);
    return [lat, lon];
  } catch (error) {
    console.error('Error converting coordinates:', error, { northing, easting });
    return [62.0, 15.0];
  }
};

// const wgs84ToSWEREF = (lat: number, lon: number): [number, number] => {
//   try {
//     const [easting, northing] = proj4('EPSG:4326', 'EPSG:3006', [lon, lat]);
//     return [northing, easting];
//   } catch (error) {
//     console.error('Error converting coordinates:', error, { lat, lon });
//     return [6900000, 500000];
//   }
// };

delete (L.Icon.Default.prototype as any)._getIconUrl;
L.Icon.Default.mergeOptions({
  iconRetinaUrl: 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.7.1/images/marker-icon-2x.png',
  iconUrl: 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.7.1/images/marker-icon.png',
  shadowUrl: 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.7.1/images/marker-shadow.png',
});

function DeselectOnMapClick({ onDeselect }: { onDeselect: () => void }) {
  useMapEvents({
    click() {
      onDeselect();
    }
  });
  return null;
}

export function WorldMap() {
  const { state, dispatch } = useApp();

  const containerRef: React.RefObject<HTMLDivElement> = useRef<HTMLDivElement>(null);
  const wrapperRef: React.RefObject<HTMLDivElement> = useRef<HTMLDivElement>(null);
  const mapRef: React.MutableRefObject<L.Map | null> = useRef<L.Map | null>(null);

  const [isMaximized, setIsMaximized] = useState(false);
  const [position, setPosition] = useState(DEFAULT_POSITION);
  const [size, setSize] = useState(DEFAULT_SIZE);
  const dragStartRef = useRef({ x: 0, y: 0 });

  const [selectedAvvForm, setSelectedAvvForm] = useState<string[]>([]);
  const [selectedBarighet, setSelectedBarighet] = useState<string[]>([]);
  const [showAvvFormPopup, setShowAvvFormPopup] = useState(false);
  const [showBarighetPopup, setShowBarighetPopup] = useState(false);
  const [showAllTeams, setShowAllTeams] = useState(true);
  const [colorMode, setColorMode] = useState<'none' | 'avvForm' | 'barighet'>('none');

  useEffect(() => {
    if (!mapRef.current) return;

    mapRef.current.invalidateSize();

    setTimeout(() => {
      mapRef.current?.invalidateSize();
    }, 300);

  }, [isMaximized, size]);

  useEffect(() => {
    if (isMaximized || !containerRef.current) return;

    const handleMouseDown = (e: MouseEvent) => {
      const target: HTMLElement = e.target as HTMLElement;

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

  const getColorForTask = (task: Task, mode: 'none' | 'avvForm' | 'barighet' = colorMode): string => {
      if (mode === 'none') return state.defaultColor;

      if (mode === 'avvForm') {
        const avvFormPalette = getAvvFormColorPalette(getUniqueAvvForm());
        return avvFormPalette[task.task.avvForm] || state.defaultColor;
      }

      if (mode === 'barighet') {
        const barighetPalette = getBarighetColorPalette(getUniqueBarighet());
        return barighetPalette[task.task.barighet] || state.defaultColor;
      }

      return state.defaultColor;
    };

  const createMarkerIcon = (color: string, isSelected: boolean = false, index?: number) => {
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

  const createUnassignedMarkerIcon = (color: string, isSelected: boolean = false, index?: number) => {
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

    if (showAllTeams) {
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

    tasks = tasks.filter(task => 
      task.duration.teamId === state.selectedTeamId || 
      selectedAvvForm.includes(task.task.avvForm)
    );
    tasks = tasks.filter(task => 
      task.duration.teamId === state.selectedTeamId || 
      selectedBarighet.includes(task.task.barighet)
    );

    return tasks;
  };

  const getVisibleTeams = () => {
    if (showAllTeams || state.selectedTeamId === null) return state.teams;
    const t: Team | undefined = state.teams.find(t => t.id === state.selectedTeamId);
    return t ? [t] : [];
  };

  const getTaskConnectionLines = () => {
    if (state.selectedTeamId === null) return [];

    // const allAvvForms = getUniqueAvvForm();
    // const allBarighet = getUniqueBarighet();
    
    // const isAvvFormFiltered = selectedAvvForm.length !== allAvvForms.length;
    // const isBarighetFiltered = selectedBarighet.length !== allBarighet.length;
    
    // if (isAvvFormFiltered || isBarighetFiltered) return [];

    const firstMonth = state.months[0];
    if (!firstMonth) return [];

    const firstMonthPeriods = state.periods.filter(p => firstMonth.periods.includes(p.id));

    const firstMonthStart = 0;
    const firstMonthEnd = firstMonthPeriods.reduce((sum, period) => sum + period.length_h, 0);

    const visibleTasks: Task[] = getVisibleTasks().filter(task =>
      task.duration.teamId === state.selectedTeamId &&
      task.duration.startHour >= firstMonthStart &&
      task.duration.startHour < firstMonthEnd
    );

    const sortedTasks: Task[] = [...visibleTasks].sort((a, b) => a.duration.startHour - b.duration.startHour);

    const selectedTeam = state.teams.find(t => t.id === state.selectedTeamId);
    const maxWheelingDist_km = selectedTeam?.maxWheelingDist_km || 0;

    const lines = [];
    for (let i = 0; i < sortedTasks.length - 1; i++) {
      const currentTask: Task = sortedTasks[i];
      const nextTask: Task = sortedTasks[i + 1];

      const dx = nextTask.task.lon - currentTask.task.lon;
      const dy = nextTask.task.lat - currentTask.task.lat;
      const distanceMeters = Math.sqrt(dx * dx + dy * dy);
      const distanceKm = distanceMeters / 1000;

      const lineColor = distanceKm <= maxWheelingDist_km
        ? '#10B981'
        : '#EF4444';

      const currentPos: [number, number] = swerefToWGS84(currentTask.task.lat, currentTask.task.lon);
      const nextPos: [number, number] = swerefToWGS84(nextTask.task.lat, nextTask.task.lon);

      lines.push({
        id: `${currentTask.task.id}-${nextTask.task.id}`,
        positions: [currentPos, nextPos],
        color: lineColor,
        weight: 2.5,
        opacity: 0.8
      });
    }

    return lines;
  };

  const handleMarkerClick = (taskId: string | null, type?: string) => {
    dispatch({
      type: 'SET_SELECTED_TASK',
      taskId,
      toggle_team: state.selectedTeamId
    });

    if (type === 'unassigned') {
      // Return the opposite (null or taskId)
      dispatch({ type: 'SET_DRAGGING_TO_GANTT', taskId: state.dragging_to_gantt === taskId ? null : taskId });
    }

    console.log(`Click on marker ${taskId}`);
  };

  const handleMarkerDragEnd = (taskId: string, mousePosition: { x: number, y: number }) => {
    document.body.setAttribute('data-dragging-to-gantt', '');
    
    // Clear the dragging state
    dispatch({ type: 'SET_DRAGGING_TO_GANTT', taskId: null });
  
    const ganttElement = document.querySelector('.gantt-chart-container');
    const ganttRect = ganttElement?.getBoundingClientRect();
    
    if (ganttRect && 
        mousePosition.x >= ganttRect.left && 
        mousePosition.x <= ganttRect.right &&
        mousePosition.y >= ganttRect.top && 
        mousePosition.y <= ganttRect.bottom) {
      
      console.log('Dropped inside Gantt chart!', taskId);
      
      // Get the timeline-content element (this is the actual timeline area)
      const timelineContent = document.querySelector('.timeline-content');
      if (!timelineContent) {
        console.log('Timeline content not found');
        return;
      }
      
      const timelineRect = timelineContent.getBoundingClientRect();
      
      // Check if dropped inside the timeline area
      if (mousePosition.x >= timelineRect.left && 
          mousePosition.x <= timelineRect.right &&
          mousePosition.y >= timelineRect.top && 
          mousePosition.y <= timelineRect.bottom) {
        
        // Get all team rows
        const teamRows = document.querySelectorAll('[data-team-row="true"]');
        
        // Find which team row the task was dropped on (by Y position)
        for (const teamRow of teamRows) {
          const teamRowRect = teamRow.getBoundingClientRect();
          
          // Check if the drop Y position is within this team row
          if (mousePosition.y >= teamRowRect.top && 
              mousePosition.y <= teamRowRect.bottom) {
            
            const teamId = teamRow.getAttribute('data-team-id');
            console.log('Dropped on team:', teamId);
            
            // Find the task being moved
            const task = state.tasks.find(t => t.task.id === taskId);
            if (!task) {
              console.error('Task not found:', taskId);
              return;
            }
            
            // Check if task is allowed on this team
            if (isDisallowed(task, teamId)) {
              console.log(`Task ${taskId} is not allowed on team ${teamId}`);
              return;
            }

            // Before any changes are made, create a snapshot
            if (state.taskSnapshot.length === 0) {
              dispatch({
                type: 'SET_TASKSNAPSHOT',
                taskSnapshot: state.tasks
              });
            }

            dispatch({
              type: 'UPDATE_TASK_TEAM',
              taskId: taskId,
              newTeamId: teamId
            });
            
            // Calculate drop hour based on x position within timeline
            const relativeX = mousePosition.x - timelineRect.left;
            const timelineWidth = timelineRect.width;
            const dropHour = Math.floor((relativeX / timelineWidth) * state.totalHours);
            
            console.log('Drop hour:', dropHour);
            
            // Get all tasks in the target team (including the one we just moved)
            const newTeamSiblings = state.tasks
              .filter(t => t.duration.teamId === teamId || t.task.id === task.task.id)
              .map(t => (t.task.id === task.task.id ? { ...t, duration: { ...t.duration, teamId: teamId } } : t));

            // Use planSequentialLayoutHours to handle repositioning
            const plan = planSequentialLayoutHours(
              newTeamSiblings,
              task.task.id,
              dropHour,
              state.totalHours
            );
            
            const batchUpdates = plan['updates'].map(u => ({
              taskId: u.id,
              startHour: u.startHour,
              defaultDuration: u.defaultDuration
            }));

            if (batchUpdates.length > 0) {
              console.log('📤 DISPATCHING BATCH_UPDATE_TASK_HOURS with', batchUpdates.length, 'updates');
              dispatch({
                type: 'BATCH_UPDATE_TASK_HOURS',
                updates: batchUpdates
              });
            }

            // Handle unassigned tasks (those pushed beyond maxHour)
            for (const id of plan['unassign']) {
              dispatch({
                type: 'UPDATE_TASK_TEAM',
                taskId: id,
                newTeamId: null
              });
              console.log(`⚠️ Task ${id} was pushed beyond the timeline and unassigned`);
            }

            dispatch({
              type: 'TOGGLE_COMPARISON_MODAL',
              toggledModal: true
            });
            historyManager.push(state.tasks);
            
            break;
          }
        }
      }
    } else {
      console.log('Dropped outside Gantt chart');
    }
    
    // In case a push is missed
    historyManager.push(state.tasks);
  };

  const handleTeamToggle = (teamId: string | null) => {
    dispatch({
      type: 'SET_SELECTED_TEAM',
      teamId: teamId
    });
    console.log(`Toggled team ${state.selectedTeamId}`);
  };

  const handleAllTeamsToggle = () => {
    setShowAllTeams(!showAllTeams);
  }

  const handleNullToggle = () => {
    dispatch({
      type: 'TOGGLE_NULL',
      toggledNull: state.toggledNull ? false : true
    })
    console.log("Toggled null");
  }

  const getUniqueAvvForm = () => {
    const avvFormValues = new Set<string>();
    state.tasks.forEach(task => {
      if (task.task.barighet) {
        avvFormValues.add(task.task.avvForm);
      }
    });
    return Array.from(avvFormValues).sort();
  };

  const getUniqueBarighet = () => {
    const barighetValues = new Set<string>();
    state.tasks.forEach(task => {
      if (task.task.barighet) {
        barighetValues.add(task.task.barighet);
      }
    });
    return Array.from(barighetValues).sort();
  };

  useEffect(() => {
    const uniqueAvvForm = getUniqueAvvForm();
    if (selectedAvvForm.length === 0 && uniqueAvvForm.length > 0) {
      setSelectedAvvForm(uniqueAvvForm);
    }
  }, [state.tasks]);

  useEffect(() => {
    const uniqueBarighet = getUniqueBarighet();
    if (selectedBarighet.length === 0 && uniqueBarighet.length > 0) {
      setSelectedBarighet(uniqueBarighet);
    }
  }, [state.tasks]);

  const toggleAvvForm = (form: string) => {
    setSelectedAvvForm(prev =>
      prev.includes(form)
        ? prev.filter(f => f !== form)
        : [...prev, form]
    );
  };

  const toggleBarighet = (barighet: string) => {
    setSelectedBarighet(prev =>
      prev.includes(barighet)
        ? prev.filter(b => b !== barighet)
        : [...prev, barighet]
    );
  };

  const toggleColorMode = (mode: 'avvForm' | 'barighet') => {
    const newMode = colorMode === mode ? 'none' : mode;
    setColorMode(newMode);

    state.tasks.forEach(task => {
      const color = getColorForTask(task, newMode);
      dispatch({
        type: 'SET_TASK_COLOR',
        taskId: task.task.id,
        color: color
      });
    });
  };

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

  function MapController() {
    const { state } = useApp();
    const map: L.Map = useMap();

    useEffect(() => {
      if (state.selectedTaskId) {
        const task: Task | undefined = state.tasks.find(t => t.task.id === state.selectedTaskId);
        if (task) {
          try {
            const [lat, lon]: [number, number] = swerefToWGS84(task.task.lat, task.task.lon);

            if (isFinite(lat) && isFinite(lon)) {
              const bounds: L.LatLngBounds = map.getBounds();
              const markerLatLng: L.LatLng = L.latLng(lat, lon);

              if (!bounds.contains(markerLatLng)) {
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

      {!isMaximized && (
        <>
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

        <div className="mb-4">
          <h3 className="text-xs font-semibold text-gray-600 mb-2">Filters</h3>
          <div className="flex flex-wrap gap-2">
            <button
              onClick={() => handleAllTeamsToggle()}
              className={`px-3 py-1 rounded-full text-xs font-medium transition-colors ${showAllTeams
                  ? 'bg-gray-700 text-white'
                  : 'bg-gray-200 text-gray-700 hover:bg-gray-300'
                }`}
            >
              All Teams
            </button>

            <button
              onClick={() => handleNullToggle()}
              className={`px-3 py-1 rounded-full text-xs font-medium transition-all duration-200 border-2 ${state.toggledNull === true
                  ? 'bg-orange-500 text-white border-orange-600 shadow-md hover:bg-orange-600'
                  : 'bg-white text-orange-600 border-orange-400 hover:bg-orange-50 hover:border-orange-500'
                }`}
            >
              Unassigned
            </button>

            <div className="relative">
              <button
                onClick={() => {
                  setShowAvvFormPopup(!showAvvFormPopup);
                  setShowBarighetPopup(false);
                }}
                className={`filter-button px-3 py-1 rounded-full text-xs font-medium transition-colors flex items-center gap-1 ${
                  colorMode === 'avvForm'
                    ? 'bg-blue-600 text-white ring-2 ring-blue-300'
                    : 'bg-blue-500 text-white hover:bg-blue-600'
                }`}
              >
                AvvForm ({selectedAvvForm.length})
              </button>

              {showAvvFormPopup && (
                <div className="filter-popup absolute top-full left-0 mt-1 bg-white border border-gray-300 rounded-lg shadow-lg p-3 z-50 min-w-[200px]" style={{ zIndex: 9999 }}>
                  <div className="mb-3 pb-2 border-b border-gray-200">
                    <button
                      onClick={() => toggleColorMode('avvForm')}
                      className={`w-full px-3 py-1.5 rounded text-xs font-medium transition-colors ${
                        colorMode === 'avvForm'
                          ? 'bg-blue-600 text-white'
                          : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
                      }`}
                    >
                      {colorMode === 'avvForm' ? '✓ Color Mode Active' : 'Toggle Color Mode'}
                    </button>
                  </div>
                  <div className="space-y-2">
                    {getUniqueAvvForm().map(form => {
                      const avvFormPalette = getAvvFormColorPalette(getUniqueAvvForm());
                      return (
                      <label key={form} className="flex items-center gap-2 cursor-pointer hover:bg-gray-50 p-1 rounded">
                        <input
                          type="checkbox"
                          checked={selectedAvvForm.includes(form)}
                          onChange={() => toggleAvvForm(form)}
                          className="w-4 h-4 cursor-pointer"
                        />
                        {colorMode === 'avvForm' && (
                          <div
                            className="w-4 h-4 rounded border border-gray-300"
                            style={{ backgroundColor: avvFormPalette[form] }}
                          />
                        )}
                        <span className="text-sm text-gray-700">{form}</span>
                      </label>
                      );
                    })}
                  </div>
                </div>
              )}
            </div>

            <div className="relative">
              <button
                onClick={() => {
                  setShowBarighetPopup(!showBarighetPopup);
                  setShowAvvFormPopup(false);
                }}
                className={`filter-button px-3 py-1 rounded-full text-xs font-medium transition-colors flex items-center gap-1 ${
                  colorMode === 'barighet'
                    ? 'bg-teal-600 text-white ring-2 ring-teal-300'
                    : 'bg-teal-500 text-white hover:bg-teal-600'
                }`}
              >
                Barighet ({selectedBarighet.length})
              </button>

              {showBarighetPopup && (
                <div className="filter-popup absolute top-full left-0 mt-1 bg-white border border-gray-300 rounded-lg shadow-lg p-3 z-50 min-w-[200px] max-h-[300px] overflow-y-auto" style={{ zIndex: 9999 }}>
                  <div className="mb-3 pb-2 border-b border-gray-200">
                    <button
                      onClick={() => toggleColorMode('barighet')}
                      className={`w-full px-3 py-1.5 rounded text-xs font-medium transition-colors ${
                        colorMode === 'barighet'
                          ? 'bg-teal-600 text-white'
                          : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
                      }`}
                    >
                      {colorMode === 'barighet' ? '✓ Color Mode Active' : 'Toggle Color Mode'}
                    </button>
                  </div>
                  <div className="space-y-2">
                    {getUniqueBarighet().map(barighet => {
                      const barighetPalette = getBarighetColorPalette(getUniqueBarighet());
                      return (
                        <label key={barighet} className="flex items-center gap-2 cursor-pointer hover:bg-gray-50 p-1 rounded">
                          <input
                            type="checkbox"
                            checked={selectedBarighet.includes(barighet)}
                            onChange={() => toggleBarighet(barighet)}
                            className="w-4 h-4 cursor-pointer"
                          />
                          {colorMode === 'barighet' && (
                            <div
                              className="w-4 h-4 rounded border border-gray-300"
                              style={{ backgroundColor: barighetPalette[barighet] }}
                            />
                          )}
                          <span className="text-sm text-gray-700">{barighet}</span>
                        </label>
                      );
                    })}
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>

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
                  icon={createHomeBaseIcon(state.defaultColor, isSelectedTeam)}
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
              if (showAllTeams) {
                const allTeamTasks: Task[] = state.tasks
                  .filter(task => task.duration.teamId === state.selectedTeamId)
                  .sort((a, b) => a.duration.startHour - b.duration.startHour);

                const taskIndexMap = new Map<string, number>();
                allTeamTasks.forEach((task, index) => {
                  taskIndexMap.set(task.task.id, index + 1);
                });

                const assignedTasks: Task[] = getVisibleTasks()
                  .filter(task => task.duration.teamId !== null)
                  .sort((a, b) => a.duration.startHour - b.duration.startHour);

                const unassignedTasks: Task[] = state.toggledNull
                  ? getVisibleTasks().filter(task => task.duration.teamId === null)
                  : [];

                return (
                  <>
                    {assignedTasks.map((task) => {
                      const isSelected: boolean = state.selectedTaskId === task.task.id;
                      const markerColor: string = getColorForTask(task);
                      const wgs84Pos: [number, number] = swerefToWGS84(task.task.lat, task.task.lon);
                      const isSelectedTeam = task.duration.teamId === state.selectedTeamId;
                      const markerIndex = isSelectedTeam ? taskIndexMap.get(task.task.id) : undefined;

                      return (
                        <Marker
                          key={task.task.id}
                          position={wgs84Pos}
                          icon={isSelectedTeam ? createMarkerIcon(markerColor, isSelected, markerIndex) : createMarkerIcon(markerColor, isSelected)}
                          eventHandlers={{ click: () => handleMarkerClick(task.task.id) }}
                          zIndexOffset={isSelectedTeam ? 20 : 10}
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

                    {unassignedTasks.map((task) => {
                      const isSelected: boolean = state.selectedTaskId === task.task.id;
                      const markerColor: string = getColorForTask(task);
                      const wgs84Pos: [number, number] = swerefToWGS84(task.task.lat, task.task.lon);

                      return (
                        <Marker
                          key={task.task.id}
                          position={wgs84Pos}
                          icon={createUnassignedMarkerIcon(markerColor, isSelected)}
                          draggable={true}
                          eventHandlers={{
                            click: () => handleMarkerClick(task.task.id, 'unassigned'),
                            dragstart: () => {
                              document.body.setAttribute('data-dragging-to-gantt', task.task.id || '');
                            },
                            dragend: (e) => {
                              const marker = e.target;
                              
                              // Get the container point (pixel coordinates on the map)
                              const map = marker._map;
                              const latLng = marker.getLatLng();
                              const containerPoint = map.latLngToContainerPoint(latLng);
                              
                              // Convert to screen coordinates
                              const mapContainer = map.getContainer();
                              const rect = mapContainer.getBoundingClientRect();
                              const mousePosition = { 
                                x: rect.left + containerPoint.x, 
                                y: rect.top + containerPoint.y 
                              };
                              
                              // Reset marker to original position immediately
                              marker.setLatLng(wgs84Pos);
                              
                              // Pass both task ID and mouse position to handler
                              handleMarkerDragEnd(task.task.id, mousePosition);
                            }
                          }}
                          zIndexOffset={30}
                        >
                          <Popup>
                            <div className="p-2">
                              <h3 className="font-semibold text-gray-800">{task.task.id}</h3>
                              <p className="text-sm text-orange-600 font-medium">Unassigned (Draggable)</p>
                              <p className="text-sm text-gray-600">Avvform: {task.task.avvForm}</p>
                              <p className="text-sm text-gray-600">Barighet: {task.task.barighet}</p>
                              <div className="flex items-center gap-1 text-xs text-gray-500 mt-1">
                                <MapPin size={12} />
                                N: {task.task.lat.toFixed(2)}, E: {task.task.lon.toFixed(2)}
                              </div>
                              <p className="text-xs text-gray-400 mt-2 italic">Drag to reposition</p>
                            </div>
                          </Popup>
                        </Marker>
                      );
                    })}
                  </>
                )
              }

              const allTeamTasks: Task[] = state.tasks
                .filter(task => task.duration.teamId === state.selectedTeamId)
                .sort((a, b) => a.duration.startHour - b.duration.startHour);

              const taskIndexMap = new Map<string, number>();
              allTeamTasks.forEach((task, index) => {
                taskIndexMap.set(task.task.id, index + 1);
              });

              const assignedTasks: Task[] = getVisibleTasks()
                .filter(task => task.duration.teamId === state.selectedTeamId)
                .sort((a, b) => a.duration.startHour - b.duration.startHour);

              const unassignedTasks = state.toggledNull
                ? getVisibleTasks().filter(task => task.duration.teamId === null)
                : [];

              return (
                <>
                  {assignedTasks.map((task) => {
                    const isSelected: boolean = state.selectedTaskId === task.task.id;
                    const markerColor: string = getColorForTask(task);
                    const markerIndex: number | undefined = taskIndexMap.get(task.task.id);
                    const wgs84Pos: [number, number] = swerefToWGS84(task.task.lat, task.task.lon);

                    return (
                      <Marker
                        key={task.task.id}
                        position={wgs84Pos}
                        icon={createMarkerIcon(markerColor, isSelected, markerIndex)}
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

                  {unassignedTasks.map((task) => {
                    const isSelected: boolean = state.selectedTaskId === task.task.id;
                    const markerColor: string = getColorForTask(task);
                    const wgs84Pos: [number, number] = swerefToWGS84(task.task.lat, task.task.lon);

                    return (
                      <Marker
                        key={task.task.id}
                        position={wgs84Pos}
                        icon={createUnassignedMarkerIcon(markerColor, isSelected)}
                        draggable={true} // Make it so that the markers position is reset on drag end
                        eventHandlers={{
                          click: () => handleMarkerClick(task.task.id, 'unassigned'),
                          dragstart: () => {
                            document.body.setAttribute('data-dragging-to-gantt', task.task.id || '');
                          },
                          dragend: (e) => {
                            const marker = e.target;
                            
                            // Get the container point (pixel coordinates on the map)
                            const map = marker._map;
                            const latLng = marker.getLatLng();
                            const containerPoint = map.latLngToContainerPoint(latLng);
                            
                            // Convert to screen coordinates
                            const mapContainer = map.getContainer();
                            const rect = mapContainer.getBoundingClientRect();
                            const mousePosition = { 
                              x: rect.left + containerPoint.x, 
                              y: rect.top + containerPoint.y 
                            };
                            
                            // Reset marker to original position immediately
                            marker.setLatLng(wgs84Pos);
                            
                            // Pass both task ID and mouse position to handler
                            handleMarkerDragEnd(task.task.id, mousePosition);
                          }
                        }}
                        zIndexOffset={30}
                      >
                        <Popup>
                          <div className="p-2">
                            <h3 className="font-semibold text-gray-800">{task.task.id}</h3>
                            <p className="text-sm text-orange-600 font-medium">Unassigned (Draggable)</p>
                            <p className="text-sm text-gray-600">Avvform: {task.task.avvForm}</p>
                            <p className="text-sm text-gray-600">Barighet: {task.task.barighet}</p>
                            <div className="flex items-center gap-1 text-xs text-gray-500 mt-1">
                              <MapPin size={12} />
                              N: {task.task.lat.toFixed(2)}, E: {task.task.lon.toFixed(2)}
                            </div>
                            <p className="text-xs text-gray-400 mt-2 italic">Drag to reposition</p>
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
    </div>
  );
}