import React, { useState } from 'react';
import { ChevronDown, ChevronUp, Package, AlertCircle, MapPin } from 'lucide-react';
import { useApp } from '../context/AppContext';

export function UnassignedTasks() {
  const { state, dispatch } = useApp();
  const [isExpanded, setIsExpanded] = useState(true);
  const [draggedTask, setDraggedTask] = useState<string | null>(null);
  const [dragPosition, setDragPosition] = useState({ x: 0, y: 0});

  const unassignedTasks = state.tasks.filter(task => task.parentId === null);

  const handleTaskMouseDown = (e: React.MouseEvent, taskId: string) => {
    e.preventDefault();
    e.stopPropagation();

    const task = state.tasks.find(t => t.id === taskId);
    if (!task) return;

    // Create a visual clone of the task for dragging
    const taskElement = e.currentTarget as HTMLElement;
    const taskRect = taskElement.getBoundingClientRect();

    // Calculate the intial offset between mouse and task's position
    setDraggedTask(taskId);
    const offset = { x: e.clientX, y: e.clientY }

    // set initial position aligned with cursor
    setDragPosition({
      x: 0, 
      y: 0 
    });

    // Create a drag preview
    const dragPreview = taskElement.cloneNode(true) as HTMLElement;
    dragPreview.style.position = 'fixed';
    dragPreview.style.top = `${taskRect.top}px`;
    dragPreview.style.left = `${taskRect.left}px`;
    dragPreview.style.width = `${taskRect.width}px`;
    dragPreview.style.zIndex = '9999';
    dragPreview.style.cursor = 'grabbing',
    dragPreview.style.transition = 'none',
    dragPreview.style.pointerEvents = 'none';
    dragPreview.style.transform = 'rotate(2deg)';
    document.body.appendChild(dragPreview);

    const handleMouseMove = (e: MouseEvent) => {
      // Calculate how far the mouse has moved from the start position
      const newDragPosition = { 
        x: e.clientX - offset.x,
        y: e.clientY - offset.y
      };

      console.log('moving');

      setDragPosition(newDragPosition)

      dragPreview.style.left = `${taskRect.left + newDragPosition.x}px`;
      dragPreview.style.top = `${taskRect.top + newDragPosition.y}px`;
    };

    const handleMouseUp = (e: MouseEvent) => {
      // Undo the small rotation
      dragPreview.style.transform = 'rotate(-2deg)';

      const finalOffset = {
        x: e.clientX - offset.x,
        y: e.clientY - offset.y
      };

      // Clean up the drag preview
      document.body.removeChild(dragPreview);

      // Get the current task state (may have been updated during drag)
      const currentTask = state.tasks.find(t => t.id === taskId);
      if (!currentTask) return;

      let taskUpdated = false;

      // Check for movement (small threshold to avoid accidental updates)
      const moveDistance = Math.sqrt(finalOffset.x ** 2 + finalOffset.y ** 2);

      if (moveDistance > 5){
        // Check if droppped on Gantt chart
        const GanttChart = document.querySelector('.gantt-chart-container');
        if (GanttChart) {
          const ganttRect = GanttChart.getBoundingClientRect();
          if (e.clientX >= ganttRect.left && e.clientX <= ganttRect.right && e.clientY >= ganttRect.top && e.clientY <= ganttRect.bottom ) {
            // Handle time change

            // Handle parent change
            const parentRows = GanttChart.querySelectorAll('[data-parent-row]');
      
            for (let i = 0; i < parentRows.length; i++) {
              const rect = parentRows[i].getBoundingClientRect();
              if (e.clientY >= rect.top && e.clientY <= rect.bottom) {
                const parentId = parentRows[i].getAttribute('data-parent-id');
                if (parentId) {
                  dispatch({ 
                    type: 'UPDATE_TASK_PARENT',
                    taskId: taskId,
                    newParentId: parentId
                  });
                  taskUpdated = true;

                  break;
                }
              }
            }
          }
        }
      }

      // Clean up
      setDraggedTask(null);
      setDragPosition({ x: 0, y: 0 });

      // Remove event listeners
      document.removeEventListener('mousemove', handleMouseMove);
      document.removeEventListener('mouseup', handleMouseUp);
    };

    // Add global mouse event listeners
    document.addEventListener('mousemove', handleMouseMove);
    document.addEventListener('mouseup', handleMouseUp);
  };

  const handleTaskClick = (taskId: string) => {
    dispatch({ type: 'SET_SELECTED_TASK', taskId, toggle_parent: state.selectedParentId });
  };

  return (
    <div className="bg-white rounded-lg shadow-lg overflow-hidden">

      {/* Header */}
      <div 
        className="flex items-center justify-between p-4 bg-gray-50 cursor-pointer hover:bg-gray-100 transition-colors"
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
                const hasDependencies = task.dependencies.length > 0;
                
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
                    onClick={() => handleTaskClick(task.id)}
                  >
                    <div className="flex items-start justify-between">
                      <div className="flex-1 min-w-0">
                        <h4 className="font-medium text-gray-800 truncate">
                          {task.name}
                        </h4>
                        <div className="mt-1 flex items-center gap-4 text-xs text-gray-500">
                          <span className={`px-2 py-1 rounded-full font-medium ${
                            task.status === 'completed' ? 'bg-green-100 text-green-800' :
                            task.status === 'in-progress' ? 'bg-blue-100 text-blue-800' :
                            'bg-gray-100 text-gray-800'
                          }`}>
                            {task.status}
                          </span>
                          <div className="flex items-center gap-1">
                            <MapPin size={12} />
                            {task.location.lat.toFixed(2)}, {task.location.lon.toFixed(2)}
                          </div>
                        </div>
                        {hasDependencies && (
                          <div className="mt-2 flex items-center gap-1 text-xs text-orange-600">
                            <AlertCircle size={12} />
                            <span>{task.dependencies.length} dependencies</span>
                          </div>
                        )}
                      </div>
                      <div className="flex-shrink-0 text-gray-400">
                        <div className="w-6 h-6 border-2 border-dashed border-gray-300 rounded flex items-center justify-center">
                          <div className="w-2 h-2 bg-gray-300 rounded-full"></div>
                        </div>
                      </div>
                    </div>
                    
                    <div className="mt-2 text-xs text-gray-500">
                      {task.startDate.toLocaleDateString()} - {task.endDate.toLocaleDateString()}
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