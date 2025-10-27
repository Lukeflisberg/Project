import React, { useState } from 'react';
import { ChevronDown, ChevronUp, Package, MapPin } from 'lucide-react';
import { useApp } from '../context/AppContext';
import { findEarliestHour, isDisallowed } from '../helper/taskUtils';

// UnassignedTasks Component: displays tasks not assigned to any team and handles drag-and-drop assignment
export function UnassignedTasks() {
  const { state, dispatch } = useApp();
  const [isExpanded, setIsExpanded] = useState(true);
  const [draggedTask, setDraggedTask] = useState<string | null>(null);

  // Filter tasks not assigned too a team
  const unassignedTasks = state.tasks.filter(task => task.duration.teamId === null);

  // Handles mouse down event to start dragging a task
  const handleTaskMouseDown = (e: React.MouseEvent, taskId: string) => {
    e.preventDefault();
    e.stopPropagation();

    const task = state.tasks.find(t => t.task.id === taskId);
    if (!task) return;

    // Get the DOM element and its position/size
    const taskElement = e.currentTarget as HTMLElement;
    const taskRect = taskElement.getBoundingClientRect();

    // Offset so mouse is at the center of the block during drag
    const offset = { 
      x: e.clientX - taskRect.left, 
      y: e.clientY - taskRect.top 
    };

    setDraggedTask(taskId);

    // Create a visual clone of the task for dragging feedback
    const dragPreview = taskElement.cloneNode(true) as HTMLElement;
    dragPreview.style.position = 'fixed';
    dragPreview.style.top = `${taskRect.top}px`;
    dragPreview.style.left = `${taskRect.left}px`;
    dragPreview.style.width = `${taskRect.width}px`;
    dragPreview.style.height = `${taskRect.height}px`;
    dragPreview.style.zIndex = '9999';
    dragPreview.style.cursor = 'grabbing';
    dragPreview.style.transition = 'none';
    dragPreview.style.pointerEvents = 'none';
    dragPreview.style.transform = 'rotate(2deg)';
    dragPreview.style.opacity = '0.8';
    dragPreview.id = 'drag-preview'; 
    document.body.appendChild(dragPreview);

    // Notify global state that a drag is in progress
    dispatch({ 
      type: 'SET_DRAGGING_TO_GANTT', 
      taskId: taskId 
    });
    dispatch({ 
      type: 'TOGGLE_UNASSIGN_DROP',
      toggledDrop: true
    });
    dispatch({ 
      type: 'SET_SELECTED_TASK', 
      taskId, 
      toggle_team: state.selectedTeamId });

    // Mouse move handler: update drag preview position so mouse stays centered
    const handleMouseMove = (e: MouseEvent) => {
      dragPreview.style.left = `${e.clientX - offset.x}px`;
      dragPreview.style.top = `${e.clientY - offset.y}px`;
    };

    // Mouse up handler: drop logic and cleanup
    const handleMouseUp = (e: MouseEvent) => {
      // Remove drag preview from DOM
      const existingPreview = document.getElementById('drag-preview');
      if (existingPreview) {
        document.body.removeChild(existingPreview);
      }

      // Clear dragging state
      dispatch({ 
        type: 'SET_DRAGGING_TO_GANTT', 
        taskId: null 
      });
      dispatch({ 
        type: 'TOGGLE_UNASSIGN_DROP', 
        toggledDrop: false
      });
      setDraggedTask(null);

      // Check if dropped on the Gantt chart
      const elementUnderMouse = document.elementFromPoint(e.clientX, e.clientY);
      const ganttChart = elementUnderMouse?.closest('.gantt-chart-container');
      
      if (ganttChart) {
        // Find which team row the mouse is over
        const teamRow = elementUnderMouse?.closest('[data-team-row]');
        
        if (teamRow) {
          const teamId = teamRow.getAttribute('data-team-id');
          
          // First check if valid in that team
          if (teamId && !isDisallowed(task, teamId)) {            
            // Calculate startHour based on mouse X position in the timeline
            const timeline = ganttChart.querySelector('.timeline-content');
            const timelineRect = timeline?.getBoundingClientRect();
            
            if (timelineRect) {
              const totalHours = state.totalHours; 
              const filteredTasks = state.tasks
                    .filter(t => t.duration.teamId === teamId)
                    .sort((a, b) => a.duration.startHour - b.duration.startHour)
              
              const result = findEarliestHour(task, filteredTasks, totalHours, state.periods, teamId);
              // console.log("Total hours: ", totalHours);
              // console.log("Task stats: ", task);
              // console.log("Tasks: ", state.tasks);
              // console.log("Calculated earliest: ", result);
              
              if (result !== null) {
                dispatch({
                  type: 'UPDATE_TASK_HOURS',
                  taskId: task.task.id,
                  startHour: result,
                  defaultDuration: task.duration.defaultDuration
                })
                dispatch({
                  type: 'UPDATE_TASK_TEAM',
                  taskId: task.task.id,
                  newTeamId: teamId
                });
                dispatch({ type: 'SET_SELECTED_TASK', taskId, toggle_team: teamId });
              }
            }
          } 
          else {
            alert(`❌ Task not allowed in team ${teamId}`);
          }
        }
      }

      cleanup();
    };

    // Cleanup function to remove event listeners
    const cleanup = () => {
      document.removeEventListener('mousemove', handleMouseMove);
      document.removeEventListener('mouseup', handleMouseUp);
    };

    // Add global mouse event listeners for drag
    document.addEventListener('mousemove', handleMouseMove);
    document.addEventListener('mouseup', handleMouseUp);
  };

  const handleTaskClick = (e: React.MouseEvent, taskId: string) => {
    // Handles click to select a task (if not dragging)
    if (!draggedTask) {
      e.stopPropagation();
      dispatch({ type: 'SET_SELECTED_TASK', taskId, toggle_team: state.selectedTeamId });
    }
  };

  return (
    <div className={`unassigned-tasks-container bg-white rounded-lg shadow-lg overflow-hidden transition-all ${
      draggedTask || state.dragging_from_gantt
        ? 'ring-2 ring-orange-400 bg-orange-50' 
        : ''
    }`}>

      {/* Header: shows title, count, and expand/collapse */}
      <div 
        className={`flex items-center justify-between p-4 cursor-pointer transition-colors ${
          draggedTask || state.dragging_from_gantt
            ? 'bg-orange-100 hover:bg-orange-200' 
            : 'bg-gray-50 hover:bg-gray-100'
        }`}
        onClick={() => setIsExpanded(!isExpanded)}
      >
        <div className="flex items-center gap-2">
          <Package className="text-orange-600" size={20} />
          <h3 className="font-semibold text-gray-800">Unassigned Tasks</h3>
          <span className="bg-orange-100 text-orange-800 text-xs font-medium px-2 py-1 rounded-full">
            {unassignedTasks.length}
          </span>
        </div>
        {isExpanded ? <ChevronUp size={20} /> : <ChevronDown size={20} />}
      </div>

      {/* Drop zone indicator when dragging from Gantt */}
      {state.dragging_from_gantt && (
        <div className="mx-4 mb-4 p-3 border-2 border-dashed border-orange-400 bg-orange-50 rounded-lg text-center">
          <div className="flex items-center justify-center gap-2 text-orange-700">
            <Package size={18} />
            <span className="font-medium text-sm">Drop here to unassign from team</span>
          </div>
          <div className="text-xs text-orange-600 mt-1">
            Task will be moved to unassigned list
          </div>
        </div>
      )}

      {/* List of unassigned tasks */}
      {isExpanded && (
        <div className="max-h-96 overflow-y-auto">
          {unassignedTasks.length === 0 ? (
            <div className="p-6 text-center text-gray-500">
              <Package size={48} className="mx-auto mb-3 text-gray-300" />
              <p className="text-sm">No unassigned tasks</p>
            </div>
          ) : (
            <div className="p-4 space-y-3">
              {unassignedTasks.map(task => {
                const isSelected = state.selectedTaskId === task.task.id;
                const isDragging = draggedTask === task.task.id;
                
                return (
                  <div
                    key={task.task.id}
                    className={`p-3 border rounded-lg cursor-move transition-all ${
                      isSelected 
                        ? 'border-yellow-400 bg-yellow-50 ring-2 ring-yellow-400 ring-opacity-50' 
                        : 'border-gray-200 hover:border-gray-300 hover:shadow-sm'
                    } ${
                      isDragging ? 'opacity-50 rotate-2 scale-105' : ''
                    }`}
                    onMouseDown={(e) => handleTaskMouseDown(e, task.task.id)}
                    onClick={(e) => handleTaskClick(e, task.task.id)}
                  >
                    <div className="flex items-start justify-between">
                      <div className="flex-1 min-w-0">
                        <h4 className="font-medium text-gray-800 truncate">
                          {task.task.id}
                        </h4>
                        <div className="mt-1 flex items-center gap-4 text-xs text-gray-500">
                          <div className="flex items-center gap-1">
                            <MapPin size={12} />
                            {task.task.lat.toFixed(2)}, {task.task.lon.toFixed(2)}
                          </div>
                        </div>
                      </div>
                      <div className="flex-shrink-0 text-gray-400">
                        <div className="w-6 h-6 border-2 border-dashed border-gray-300 rounded flex items-center justify-center">
                          <div className="w-2 h-2 bg-gray-300 rounded-full"></div>
                        </div>
                      </div>
                    </div>
                    
                    <div className="mt-2 text-xs text-gray-500">
                      Start: {task.duration.startHour}h • Duration: {task.duration.defaultDuration}h • Distance: n/a • Cost: n/a 
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}

      {/* Instructions for drag-and-drop */}
      {isExpanded && unassignedTasks.length > 0 && (
        <div className="px-4 py-3 bg-gray-50 border-t border-gray-200">
          <p className="text-xs text-gray-600 text-center">
            Click and drag tasks to the Gantt chart to assign them to teams
          </p>
        </div>
      )}
    </div>
  );
}