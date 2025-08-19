import React, { useState, useRef, useEffect } from 'react';
import { format, differenceInDays, addDays, startOfWeek, endOfWeek } from 'date-fns';
import { Calendar, AlertTriangle } from 'lucide-react';
import { useApp } from '../context/AppContext';
import { Task } from '../types';

export function GanttChart() {
  const { state, dispatch } = useApp();
  const [draggedTask, setDraggedTask] = useState<string | null>(null);
  const [dropZone, setDropZone] = useState<{ parentId: string; position: number } | null>(null);
  const [invalidZones, setInvalidZones] = useState<Set<string>>(new Set());
  const [dragStartX, setDragStartX] = useState<number>(0);
  const [originalTask, setOriginalTask] = useState<Task | null>(null);
  const ganttRef = useRef<HTMLDivElement>(null);
  
  const timelineStart = new Date(2025, 0, 1);
  const timelineEnd = new Date(2025, 2, 31);
  const totalDays = differenceInDays(timelineEnd, timelineStart);
  
  const getTasksByParent = (parentId: string) => 
    state.tasks
      .filter(task => task.parentId === parentId)
      .sort((a, b) => a.startDate.getTime() - b.startDate.getTime());

  const validateTaskMove = (taskId: string, targetParentId: string): boolean => {
    const task = state.tasks.find(t => t.id === taskId);
    if (!task) return false;

    // Check if moving would break dependencies
    const dependencies = state.tasks.filter(t => task.dependencies.includes(t.id));
    const dependents = state.tasks.filter(t => t.dependencies.includes(taskId));
    
    // For now, just check basic constraints - in a real app, you'd check timeline conflicts
    return true;
  };

  const calculateTaskPosition = (task: Task) => {
    const startOffset = differenceInDays(task.startDate, timelineStart);
    const duration = differenceInDays(task.endDate, task.startDate) + 1;
    const left = (startOffset / totalDays) * 100;
    const width = (duration / totalDays) * 100;
    
    return { left: `${left}%`, width: `${width}%` };
  };

  const getDateFromPosition = (x: number, containerWidth: number): Date => {
    const percentage = x / containerWidth;
    const dayOffset = Math.round(percentage * totalDays);
    return addDays(timelineStart, dayOffset);
  };

  const handleTaskMouseDown = (e: React.MouseEvent, taskId: string) => {
    e.preventDefault();
    e.stopPropagation();
    
    const task = state.tasks.find(t => t.id === taskId);
    if (!task) return;

    const rect = e.currentTarget.getBoundingClientRect();
    const clickX = e.clientX - rect.left;
    const taskWidth = rect.width;

    setDraggedTask(taskId);
    setDragStartX(e.clientX);
    setOriginalTask({ ...task });
    
    dispatch({ 
      type: 'START_DRAG', 
      dragData: { 
        taskId, 
        sourceParentId: task.parentId,
        sourceIndex: getTasksByParent(task.parentId || '').indexOf(task) 
      }
    });

    // Add global mouse event listeners
    const handleMouseMove = (e: MouseEvent) => {
      if (!ganttRef.current) return;

      const ganttRect = ganttRef.current.getBoundingClientRect();
      const timelineContent = ganttRef.current.querySelector('.timeline-content');
      const timelineRect = timelineContent?.getBoundingClientRect();

      if (!timelineRect) return;

      const deltaX = e.clientX - dragStartX;
      const daysDelta = Math.round((deltaX / timelineRect.width) * totalDays);

      // Move entire task
      const newStartDate = addDays(task.startDate, daysDelta);
      const duration = differenceInDays(task.endDate, task.startDate);
      const newEndDate = addDays(newStartDate, duration);

      // Ensure dates are within bounds
      if (newStartDate >= timelineStart && newEndDate <= timelineEnd) {
        dispatch({
          type: 'UPDATE_TASK_DATES',
          taskId: taskId,
          startDate: newStartDate,
          endDate: newEndDate
        });
      }

      // Check for parent changes (vertical movement)
      const mouseY = e.clientY;
      const parentElements = ganttRef.current?.querySelectorAll('.parent-row');
      let targetParentId: string | null = null;

      parentElements?.forEach((element, index) => {
        const rect = element.getBoundingClientRect();
        if (mouseY >= rect.top && mouseY <= rect.bottom) {
          targetParentId = state.parents[index]?.id || null;
        }
      });

      if (targetParentId && targetParentId !== task.parentId) {
        setDropZone({ parentId: targetParentId, position: 0 });
        setInvalidZones(new Set());
      } else {
        setDropZone(null);
      }

      // Check if dragging over unassigned area
      const unassignedElement = document.querySelector('.unassigned-drop-zone');
      if (unassignedElement) {
        const rect = unassignedElement.getBoundingClientRect();
        if (e.clientX >= rect.left && e.clientX <= rect.right && 
            e.clientY >= rect.top && e.clientY <= rect.bottom) {
          setDropZone({ parentId: 'unassigned', position: 0 });
        }
      }
    };

    const handleMouseUp = (e: MouseEvent) => {
      // Handle parent change if there's a drop zone
      if (dropZone) {
        if (dropZone.parentId === 'unassigned') {
          // Move task to unassigned
          dispatch({
            type: 'MOVE_TASK',
            taskId: taskId,
            newParentId: null,
            newIndex: 0
          });
        } else if (dropZone.parentId !== task.parentId) {
          if (validateTaskMove(taskId, dropZone.parentId)) {
            dispatch({
              type: 'MOVE_TASK',
              taskId: taskId,
              newParentId: dropZone.parentId,
              newIndex: 0
            });
          }
        }
      }

      // Clean up
      setDraggedTask(null);
      setDropZone(null);
      setInvalidZones(new Set());
      setOriginalTask(null);
      dispatch({ type: 'END_DRAG' });

      // Remove global event listeners
      document.removeEventListener('mousemove', handleMouseMove);
      document.removeEventListener('mouseup', handleMouseUp);
    };

    // Add global mouse event listeners
    document.addEventListener('mousemove', handleMouseMove);
    document.addEventListener('mouseup', handleMouseUp);
  };

  return (
    <div ref={ganttRef} className="bg-white rounded-lg shadow-lg p-6 h-full overflow-hidden">
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
              className={`parent-row h-16 flex items-center border-b border-gray-100 px-2 ${
                dropZone?.parentId === parent.id ? 'bg-blue-50 border-blue-200' : ''
              } ${
                invalidZones.has(parent.id) ? 'bg-red-50 border-red-200' : ''
              }`}
            >
              <div className="flex items-center gap-2">
                <div 
                  className="w-3 h-3 rounded-full"
                  style={{ backgroundColor: parent.color }}
                />
                <span className="text-sm font-medium text-gray-700">{parent.name}</span>
              </div>
              {invalidZones.has(parent.id) && (
                <AlertTriangle className="ml-auto text-red-500" size={16} />
              )}
            </div>
          ))}
        </div>

        {/* Timeline Content */}
        <div className="flex-1 overflow-x-auto">
          <div className="timeline-content">
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
            {state.parents.map(parent => (
              <div 
                key={parent.id}
                className={`parent-row h-16 border-b border-gray-100 relative ${
                  invalidZones.has(parent.id) ? 'bg-red-50' : ''
                } ${
                  dropZone?.parentId === parent.id ? 'bg-blue-50' : ''
                }`}
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
                  const isDragging = draggedTask === task.id;
                  
                  return (
                    <div
                      key={task.id}
                      className={`absolute top-2 bottom-2 rounded px-2 py-1 text-xs font-medium cursor-move transition-all select-none ${
                        isSelected ? 'ring-2 ring-yellow-400 ring-opacity-75' : ''
                      } ${
                        isDragging ? 'opacity-70 z-10 shadow-lg' : 'hover:shadow-md'
                      } ${
                        task.status === 'completed' ? 'bg-green-500 text-white' :
                        task.status === 'in-progress' ? 'bg-blue-500 text-white' :
                        'bg-gray-500 text-white'
                      }`}
                      style={position}
                      onMouseDown={(e) => handleTaskMouseDown(e, task.id)}
                      onClick={(e) => {
                        e.stopPropagation();
                        dispatch({ type: 'SET_SELECTED_TASK', taskId: task.id, toggle_parent: 'any' });
                      }}
                    >
                      <div className="truncate flex items-center justify-between h-full">
                        <span>{task.name}</span>
                        {task.dependencies.length > 0 && (
                          <AlertTriangle size={10} className="ml-1" />
                        )}
                      </div>
                      {/* Resize handle */}
                      <div className="absolute right-0 top-0 bottom-0 w-2 cursor-ew-resize opacity-0 hover:opacity-100 bg-white bg-opacity-30 rounded-r" />
                    </div>
                  );
                })}

                {/* Drop Zone Indicator */}
                {dropZone?.parentId === parent.id && (
                  <div className="absolute inset-0 bg-blue-200 bg-opacity-30 border-2 border-dashed border-blue-400 rounded flex items-center justify-center">
                    <span className="text-blue-700 font-medium text-sm">Drop here to assign</span>
                  </div>
                )}

                {/* Invalid Drop Zone Indicator */}
                {invalidZones.has(parent.id) && (
                  <div className="absolute inset-0 bg-red-200 bg-opacity-50 flex items-center justify-center">
                    <AlertTriangle className="text-red-600" size={20} />
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}