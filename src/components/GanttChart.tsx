import React, { useState, useRef } from 'react';
import { format, differenceInDays, addDays } from 'date-fns';
import { Calendar, AlertTriangle } from 'lucide-react';
import { useApp } from '../context/AppContext';
import { Task } from '../types';

export function GanttChart() {
  const { state, dispatch } = useApp();
  const [draggedTask, setDraggedTask] = useState<string | null>(null);
  const [dropZone, setDropZone] = useState<{ parentId: string } | null>(null);
  const [dragPosition, setDragPosition] = useState({ x: 0, y:0 })
  const ganttRef = useRef<HTMLDivElement>(null);
  
  const timelineStart = new Date(2025, 0, 1);
  const timelineEnd = new Date(2025, 2, 31);
  const totalDays = differenceInDays(timelineEnd, timelineStart);
  
  const getTasksByParent = (parentId: string | null) => 
    state.tasks
      .filter(task => task.parentId === parentId)
      .sort((a, b) => a.startDate.getTime() - b.startDate.getTime());

  const calculateTaskPosition = (task: Task) => {
    const startOffset = differenceInDays(task.startDate, timelineStart);
    const duration = differenceInDays(task.endDate, task.startDate) + 1;
    const left = (startOffset / totalDays) * 100;
    const width = (duration / totalDays) * 100;
    
    return { left: `${left}%`, width: `${width}%` };
  };

  const getParentFromMousePosition = (mouseY: number): string | null => {
    if (!ganttRef.current) return null;
    
    const parentRows = ganttRef.current.querySelectorAll('[data-parent-row]');
    
    for (let i = 0; i < parentRows.length; i++) {
      const rect = parentRows[i].getBoundingClientRect();
      if (mouseY >= rect.top && mouseY <= rect.bottom) {
        const parentId = parentRows[i].getAttribute('data-parent-id');
        return parentId;
      }
    }
    
    return null;
  };

  const handleTaskMouseDown = (e: React.MouseEvent, taskId: string) => {
    e.preventDefault();
    e.stopPropagation();
    
    const task = state.tasks.find(t => t.id === taskId);
    if (!task) return;

    // Get the task element to calcualte the intial offset
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

    console.log("Initial:", {
      clientX: e.clientX,
      clientY: e.clientY,
      taskRect,
      offset,
      dragPosition
    });

    const handleMouseMove = (e: MouseEvent) => {
      // Calculate how far the mouse has moved from the start position
      const newDragPosition = { 
        x: e.clientX - offset.x,
        y: e.clientY - offset.y
      };

      setDragPosition(newDragPosition)

      // Update drop zone UI immediately
      const targetParentId = getParentFromMousePosition(e.clientY);
      if (targetParentId && targetParentId !== task.parentId) {
        setDropZone({ parentId: targetParentId });
      } else {
        setDropZone(null);
      }
    };

    const handleMouseUp = (e: MouseEvent) => { // Test      
      const finalOffset = {
        x: e.clientX - offset.x,
        y: e.clientY - offset.y
      };

      // Get the current task state (may have been updated during drag)
      const currentTask = state.tasks.find(t => t.id === taskId);
      if (!currentTask) return;

      let taskUpdated = false;

      // Check for movement (small threshold to avoid accidental updates)
      const moveDistance = Math.sqrt(finalOffset.x ** 2 + finalOffset.y ** 2);

      if (moveDistance > 5) {
        // Handle horizontal movement (time change)
        if (Math.abs(finalOffset.x) > 5 && ganttRef.current) {
          const timelineContent = ganttRef.current.querySelector('.timeline-content');
          const timelineRect = timelineContent?.getBoundingClientRect();
          
          if (timelineRect) {
            const daysDelta = Math.round((finalOffset.x / timelineRect.width) * totalDays);
            const newStartDate = addDays(task.startDate, daysDelta);
            const duration = differenceInDays(task.endDate, task.startDate);
            const newEndDate = addDays(newStartDate, duration);

            // Ensure dates are within bounds
            if (newStartDate >= timelineStart && newEndDate <= timelineEnd) {
              console.log('Updating task dates:', { 
                taskName: task.name,
                oldStart: task.startDate,
                newStart: newStartDate,
                oldEnd: task.endDate,
                newEnd: newEndDate 
              });
              
              // Create updated task with new dates
              dispatch({
                type: 'UPDATE_TASK_DATES',
                taskId: taskId,
                startDate: newStartDate,
                endDate: newEndDate
              });
              taskUpdated = true;
            }
          }
        }

        // Handle vertical movement (parent change)
        const newParentId = getParentFromMousePosition(e.clientY);

        if (newParentId && newParentId !== task.parentId){

          // Create updated task with new parent
          dispatch({
            type: 'UPDATE_TASK_PARENT',
            taskId: taskId,
            newParentId: newParentId
          })
          taskUpdated = true;
        }
      }
      else {
        // If we didn't drag, treat it as a click to select the task
        dispatch({
          type: 'SET_SELECTED_TASK',
          taskId: taskId,
          toggle_parent: 'any'
        })
      }

      // Clean up
      setDraggedTask(null);
      setDropZone(null);
      setDragPosition({ x: 0, y: 0 });

      // Remove global event listeners
      document.removeEventListener('mousemove', handleMouseMove);
      document.removeEventListener('mouseup', handleMouseUp);
    };

    // Add global mouse event listeners
    document.addEventListener('mousemove', handleMouseMove);
    document.addEventListener('mouseup', handleMouseUp);
  };

  return (
    <div ref={ganttRef} className="gantt-chart-container bg-white rounded-lg shadow-lg p-6 h-full overflow-hidden">
      <div className="flex items-center gap-2 mb-4">
        <Calendar className="text-green-600" size={24} />
        <h2 className="text-xl font-semibold text-gray-800">Task Timeline</h2>
        <div className="ml-auto text-xs text-gray-500">
          Drag tasks horizontally to adjust timing, vertically to change teams
        </div>
      </div>

      <div className="flex h-full">
        {/* Timeline Header */}
        <div className="w-48 flex-shrink-0">
          <div className="h-12 flex items-center font-medium text-gray-700 border-b border-gray-200">
            Teams
          </div>
          {state.parents.map(parent => (
            <div 
              key={parent.id} 
              className={`h-16 flex items-center border-b border-gray-100 px-2 transition-all ${
                dropZone?.parentId === parent.id ? 'bg-blue-50 border-blue-300 border-l-4 border-l-blue-500' : ''
              }`}
              data-parent-row="true"
              data-parent-id={parent.id}
            >
              <div className="flex items-center gap-2">
                <div 
                  className="w-3 h-3 rounded-full"
                  style={{ backgroundColor: parent.color }}
                />
                <span className="text-sm font-medium text-gray-700">{parent.name}</span>
              </div>
              {dropZone?.parentId === parent.id && (
                <div className="ml-auto text-blue-600 text-xs font-medium">
                  Drop here
                </div>
              )}
            </div>
          ))}
        </div>

        {/* Timeline Content */}
        <div className="flex-1 overflow-x-auto">
          <div className="timeline-content relative">
            
            {/* Timeline Header */}
            <div className="h-12 border-b border-gray-200 relative">
              {Array.from({ length: Math.ceil(totalDays / 7) }, (_, weekIndex) => {
                const weekStart = addDays(timelineStart, weekIndex * 7);
                return (
                  <div 
                    key={weekIndex}
                    className="absolute top-0 h-full flex items-center justify-center text-xs text-gray-600 border-r border-gray-100"
                    style={{ 
                      left: `${(weekIndex * 7 / totalDays) * 100}%`, 
                      width: `${(7 / totalDays) * 100}%` 
                    }}
                  >
                    {format(weekStart, 'MMM dd')}
                  </div>
                );
              })}
            </div>

            {/* Task Rows */}
            {state.parents.map((parent, parentIndex) => (
              <div 
                key={parent.id}
                className={`h-16 border-b border-gray-100 relative transition-all ${
                  dropZone?.parentId === parent.id ? 'bg-blue-50' : ''
                }`}
                data-parent-row="true"
                data-parent-id={parent.id}
              >
                {/* Week Grid Lines */}
                {Array.from({ length: Math.ceil(totalDays / 7) }, (_, weekIndex) => (
                  <div 
                    key={weekIndex}
                    className="absolute top-0 bottom-0 border-r border-gray-50"
                    style={{ left: `${((weekIndex + 1) * 7 / totalDays) * 100}%` }}
                  />
                ))}
                
                {/* Tasks */}
                {getTasksByParent(parent.id).map(task => {
                  const position = calculateTaskPosition(task);
                  const isSelected = state.selectedTaskId === task.id;
                  const isBeingDragged = draggedTask === task.id;
                  
                  // Apply drag offset if this task is being dragged
                  const dragStyle = isBeingDragged ? {
                    transform: `translate(${dragPosition.x}px, ${dragPosition.y}px)`,
                    zIndex: 1000,
                    cursor: 'grabbing',
                    transition: 'none',
                    pointerEvents: 'none'
                  } : {
                    cursor: 'grab'
                  };
                  
                  return (
                    <div
                      key={task.id}
                      className={`absolute top-2 bottom-2 rounded px-2 py-1 text-xs font-medium cursor-move transition-all select-none ${
                        isSelected ? 'ring-2 ring-yellow-400 ring-opacity-75' : ''
                      } ${
                        isBeingDragged ? 'opacity-80 shadow-xl' : 'hover:shadow-md'
                      } ${
                        task.status === 'completed' ? 'bg-green-500 text-white' :
                        task.status === 'in-progress' ? 'bg-blue-500 text-white' :
                        'bg-gray-500 text-white'
                      }`}
                      style={{
                        ...position,
                        ...dragStyle
                      }}
                      onMouseDown={(e) => handleTaskMouseDown(e, task.id)}
                      onClick={(e) => {
                        e.stopPropagation();
                        if (!draggedTask) {
                          dispatch({ type: 'SET_SELECTED_TASK', taskId: task.id, toggle_parent: 'any' });
                        }
                      }}
                    >
                      <div className="truncate flex items-center justify-between h-full">
                        <span>{task.name}</span>
                        {task.dependencies?.length > 0 && (
                          <AlertTriangle size={10} className="ml-1" />
                        )}
                      </div>
                    </div>
                  );
                })}

                {/* Drop Zone Indicator */}
                {dropZone?.parentId === parent.id && (
                  <div className="absolute inset-0 bg-blue-200 bg-opacity-30 border-2 border-dashed border-blue-400 rounded flex items-center justify-center pointer-events-none">
                    <span className="text-blue-700 font-medium text-sm">Drop here to assign</span>
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>
      </div>
      
      {/* Debug info */}
      {draggedTask && (
        <div className="fixed top-4 right-4 bg-black bg-opacity-75 text-white p-2 rounded text-xs z-50">
          <div>Dragging: {state.tasks.find(t => t.id === draggedTask)?.name}</div>
          <div>Position: {dragPosition.x.toFixed(0)}, {dragPosition.y.toFixed(0)}</div>
          {dropZone && <div>Drop zone: {dropZone.parentId}</div>}
        </div>
      )}
    </div>
  );
}