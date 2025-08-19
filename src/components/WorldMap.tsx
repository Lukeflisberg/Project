import React, { useEffect, useState, useRef } from 'react';
import { useMapEvents, MapContainer, TileLayer, Marker, Popup, useMap } from 'react-leaflet';
import L from 'leaflet';
import { Map as MapIcon, MapPin } from 'lucide-react';
import { useApp } from '../context/AppContext';
import 'leaflet/dist/leaflet.css';

// Fix for default markers in react-leaflet
delete (L.Icon.Default.prototype as any)._getIconUrl;
L.Icon.Default.mergeOptions({
  iconRetinaUrl: 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.7.1/images/marker-icon-2x.png',
  iconUrl: 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.7.1/images/marker-icon.png',
  shadowUrl: 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.7.1/images/marker-shadow.png',
});

function DeselectOnMapClick({ onDeselect }: { onDeselect: () => void }) {
  useMapEvents({
    click(e) {
      onDeselect();
    }
  });
  return null;
}

export function WorldMap() {
  const { state, dispatch } = useApp();

  const createCustomIcon = (color: string, isSelected: boolean = false) => {
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
      ">
        <div style="
          width: ${size * 0.4}px;
          height: ${size * 0.4}px;
          background-color: white;
          border-radius: 50%;
        "></div>
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
    if (state.selectedParentId === 'all') return state.tasks;
     
    return state.tasks.filter(task => task.parentId === state.selectedParentId);
  };

  const getParentColor = (parentId: string | null) => {
    if (!parentId) return '#6B7280'; // Gray for unassigned
    const parent = state.parents.find(p => p.id === parentId);
    return parent?.color || '#6B7280';
  };

  const handleMarkerClick = (taskId: string) => {
    dispatch({ type: 'SET_SELECTED_TASK', taskId, toggle_parent: state.selectedParentId });
  };

  const handleParentToggle = (parentId: string | null) => {
    dispatch({ 
      type: 'SET_SELECTED_PARENT', parentId: state.selectedParentId === parentId ? 'all' : parentId 
    });
  };

  function MapController() {
    const { state } = useApp();
    const map = useMap();

    useEffect(() => {
      if (state.selectedTaskId) {
        const task = state.tasks.find(t => t.id === state.selectedTaskId);
        if (task) {
          map.flyTo([task.location.lat, task.location.lon], 15, { duration: 1 });
        }

        if (state.selectedParentId === 'any') handleParentToggle(state.selectedParentId)
      }
    }, [state.selectedTaskId, state.tasks, map]);

    return null;
  } 

  return (
    <div className="bg-white rounded-lg shadow-lg p-6 h-full flex flex-col">
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-2">
          <MapIcon className="text-blue-600" size={24} />
          <h2 className="text-xl font-semibold text-gray-800">Task Locations</h2>
        </div>
        
        {/* Filter Controls */}
        <div className="flex gap-2">
          
          {/* All Filter Button */}
          <button
            onClick={() => handleParentToggle('all')}
            className={`px-3 py-1 rounded-full text-xs font-medium transition-colors ${
              state.selectedParentId === 'all' 
                ? 'bg-gray-700 text-white' 
                : 'bg-gray-200 text-gray-700 hover:bg-gray-300'
            }`}
          >
            All 
          
          {/* Parent Filter Buttons */}
          </button>
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
                backgroundColor: state.selectedParentId === parent.id ? parent.color : `${parent.color}20`,
                borderColor: parent.color,
                borderWidth: '1px',
                borderStyle: 'solid'
              }}
            >
              {parent.name}
            </button>
          ))}
          
          {/* Unassigned Filter Button */}
          <button
            onClick={() => handleParentToggle(null)}
            className={`px-3 py-1 rounded-full text-xs font-medium transition-colors border border-gray-400 ${
              state.selectedParentId === null 
                ? 'bg-gray-600 text-white' 
                : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
            }`}
          >
            Unassigned
          </button>
        </div>
      </div>

      <div className="flex-1 rounded-lg overflow-hidden">
        <MapContainer
          center={[45.5017, -73.5673]}
          zoom={13}
          style={{ height: '100%', width: '100%' }}
          className="rounded-lg"
        >
          <TileLayer
            attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
            url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
          />
          <MapController />
          
          {/* Clear selection when clicking map background */}
          <DeselectOnMapClick onDeselect={() => handleMarkerClick('')} />

          {/* Managed marker visibility an clicking */}
          {getVisibleTasks().map(task => {
            const isSelected = state.selectedTaskId === task.id;
            const parentColor = getParentColor(task.parentId);
            
            return (
              <Marker
                key={task.id}
                position={[task.location.lat, task.location.lon]}
                icon={createCustomIcon(parentColor, isSelected)}
                eventHandlers={{
                  click: () => handleMarkerClick(task.id)
                }}
              >
                <Popup>
                  <div className="p-2">
                    <h3 className="font-semibold text-gray-800">{task.name}</h3>
                    <p className="text-sm text-gray-600">
                      Status: <span className="capitalize font-medium">{task.status}</span>
                    </p>
                    <p className="text-sm text-gray-600">
                      Parent: {task.parentId ? 
                        state.parents.find(p => p.id === task.parentId)?.name || 'Unknown' : 
                        'Unassigned'
                      }
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
        </MapContainer>
      </div>
    </div>
  );
}