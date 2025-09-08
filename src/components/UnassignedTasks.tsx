import React, { useState } from 'react';
import { ChevronDown, ChevronUp, Package, MapPin } from 'lucide-react';
import { useApp } from '../context/AppContext';

export function UnassignedTasks() {
  const { state, dispatch } = useApp();
  const [isExpanded, setIsExpanded] = useState(true);
  const [draggedTask, setDraggedTask] = useState<string | null>(null);

  const unassignedTasks = state.tasks.filter(task => task.parentId === null);

  const handleTaskMouseDown = (e: React.MouseEvent, taskId: string) => {
    e.preventDefault();
    e.stopPropagation();

    const task = state.tasks.find(t => t.id === taskId);
    if (!task) return;

    // Create a visual clone of the task for dragging
    const taskElement = e.currentTarget as HTMLElement;
    const taskRect = taskElement.getBoundingClientRect();

    // Calculate the initial offset between mouse and task's top-left corner
    const offset = { 
      x: e.clientX - taskRect.left, 
      y: e.clientY - taskRect.top 
    };

    setDraggedTask(taskId);

    // Create a drag preview
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
    dragPreview.id = 'drag-preview'; // Add ID for easier cleanup
    document.body.appendChild(dragPreview);

    // Set dragging state for global drop zone detection
    dispatch({ type: 'SET_DRAGGING_UNASSIGNED_TASK', taskId: taskId });

    const handleMouseMove = (e: MouseEvent) => {
      // Update drag preview position relative to cursor
      dragPreview.style.left = `${e.clientX - offset.x}px`;
      dragPreview.style.top = `${e.clientY - offset.y}px`;
    };

    const handleMouseUp = (e: MouseEvent) => {
      // Clean up the drag preview first
      const existingPreview = document.getElementById('drag-preview');
      if (existingPreview) {
        document.body.removeChild(existingPreview);
      }

      // Clear dragging state
      dispatch({ type: 'SET_DRAGGING_UNASSIGNED_TASK', taskId: null });
      setDraggedTask(null);

      // Get the current task state (may have been updated during drag)
      const currentTask = state.tasks.find(t => t.id === taskId);
      if (!currentTask) {
        cleanup();
        return;
      }

      // Check if dropped on Gantt chart
      const elementUnderMouse = document.elementFromPoint(e.clientX, e.clientY);
      const ganttChart = elementUnderMouse?.closest('.gantt-chart-container');
      
      if (ganttChart) {
        // Find parent row under mouse
        const parentRow = elementUnderMouse?.closest('[data-parent-row]');
        
        if (parentRow) {
          const parentId = parentRow.getAttribute('data-parent-id');
          
          if (parentId) {
            // Calculate startHour based on mouse X position
            const timeline = ganttChart.querySelector('.timeline-content');
            const timelineRect = timeline?.getBoundingClientRect();
            
            if (timelineRect) {
              const totalHours = state.totalHours || 24; // Default fallback
              const duration = currentTask.durationHours;
              const mousePct = Math.max(0, Math.min(1, (e.clientX - timelineRect.left) / timelineRect.width));
              let startHour = Math.round(mousePct * totalHours);

              // Clamp startHour to valid range
              startHour = Math.max(0, Math.min(totalHours - duration, startHour));

              // Check for overlap with existing tasks
              const siblings = state.tasks.filter(t => t.parentId === parentId && t.id !== taskId);
              const overlaps = siblings.some(t => {
                const tStart = t.startHour;
                const tEnd = t.startHour + t.durationHours;
                return startHour < tEnd && (startHour + duration) > tStart;
              });

              if (overlaps) {
                alert('Cannot place task here: overlaps with another task.');
              } else {
                // Successfully assign the task
                dispatch({ 
                  type: 'UPDATE_TASK_PARENT',
                  taskId: taskId,
                  newParentId: parentId
                });
                dispatch({
                  type: 'UPDATE_TASK_HOURS',
                  taskId: taskId,
                  startHour: startHour,
                  durationHours: duration
                });
              }
            }
          }
        }
      }

      cleanup();
    };

    const cleanup = () => {
      // Remove event listeners
      document.removeEventListener('mousemove', handleMouseMove);
      document.removeEventListener('mouseup', handleMouseUp);
    };

    // Add global mouse event listeners
    document.addEventListener('mousemove', handleMouseMove);
    document.addEventListener('mouseup', handleMouseUp);
  };

  const handleTaskClick = (e: React.MouseEvent, taskId: string) => {
    // Only handle click if not dragging
    if (!draggedTask) {
      e.stopPropagation();
      dispatch({ type: 'SET_SELECTED_TASK', taskId, toggle_parent: state.selectedParentId });
    }
  };

  return (
    <div className={`unassigned-tasks-container bg-white rounded-lg shadow-lg overflow-hidden transition-all ${
      draggedTask || state.draggingTaskId_gantt
        ? 'ring-2 ring-orange-400 bg-orange-50' 
        : ''
    }`}>

      {/* Header */}
      <div 
        className={`flex items-center justify-between p-4 cursor-pointer transition-colors ${
          draggedTask || state.draggingTaskId_gantt
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

      {/* Drop Zone Indicator for assigned tasks being dragged from Gantt */}
      {state.draggingTaskId_gantt && (
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

      {/* Tasks List */}
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
                const isSelected = state.selectedTaskId === task.id;
                const isDragging = draggedTask === task.id;
                
                return (
                  <div
                    key={task.id}
                    className={`p-3 border rounded-lg cursor-move transition-all ${
                      isSelected 
                        ? 'border-yellow-400 bg-yellow-50 ring-2 ring-yellow-400 ring-opacity-50' 
                        : 'border-gray-200 hover:border-gray-300 hover:shadow-sm'
                    } ${
                      isDragging ? 'opacity-50 rotate-2 scale-105' : ''
                    }`}
                    onMouseDown={(e) => handleTaskMouseDown(e, task.id)}
                    onClick={(e) => handleTaskClick(e, task.id)}
                  >
                    <div className="flex items-start justify-between">
                      <div className="flex-1 min-w-0">
                        <h4 className="font-medium text-gray-800 truncate">
                          {task.name}
                        </h4>
                        <div className="mt-1 flex items-center gap-4 text-xs text-gray-500">
                          <span className="px-2 py-1 rounded-full font-medium bg-gray-100 text-gray-800">
                            {/* You might want to add task type or status here */}
                          </span>
                          <div className="flex items-center gap-1">
                            <MapPin size={12} />
                            {task.location.lat.toFixed(2)}, {task.location.lon.toFixed(2)}
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
                      Start: {task.startHour}h • Duration: {task.durationHours}h
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}

      {/* Drop Instructions */}
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