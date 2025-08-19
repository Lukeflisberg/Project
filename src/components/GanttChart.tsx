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

  const handleTaskDragStart = (e: React.DragEvent, taskId: string) => {
    setDraggedTask(taskId);
    const task = state.tasks.find(t => t.id === taskId);
    if (task) {
      dispatch({ 
        type: 'START_DRAG', 
        dragData: { 
          taskId, 
          sourceParentId: task.parentId, 
          sourceIndex: getTasksByParent(task.parentId || '').indexOf(task) 
        }
      });
    }
  };

  const handleTaskDragEnd = () => {
    setDraggedTask(null);
    setDropZone(null);
    setInvalidZones(new Set());
    dispatch({ type: 'END_DRAG' });
  };

  const handleParentDragOver = (e: React.DragEvent, parentId: string) => {
    e.preventDefault();
    
    if (!draggedTask) return;
    
    const isValid = validateTaskMove(draggedTask, parentId);
    
    if (!isValid) {
      setInvalidZones(prev => new Set([...prev, parentId]));
    } else {
      setDropZone({ parentId, position: 0 });
      setInvalidZones(prev => {
        const newSet = new Set([...prev]);
        newSet.delete(parentId);
        return newSet;
      });
    }
  };

  const handleParentDrop = (e: React.DragEvent, parentId: string) => {
    e.preventDefault();
    
    if (!draggedTask) return;
    
    if (validateTaskMove(draggedTask, parentId)) {
      dispatch({
        type: 'MOVE_TASK',
        taskId: draggedTask,
        newParentId: parentId,
        newIndex: 0
      });
    }
    
    handleTaskDragEnd();
  };

  return (
    <div className="bg-white rounded-lg shadow-lg p-6 h-full overflow-hidden">
      <div className="flex items-center gap-2 mb-4">
        <Calendar className="text-green-600" size={24} />
        <h2 className="text-xl font-semibold text-gray-800">Task Timeline</h2>
      </div>

      <div className="flex h-full">
        {/* Timeline Header */}
        <div className="w-48 flex-shrink-0">
          <div className="h-12 flex items-center font-medium text-gray-700 border-b border-gray-200">
            Teams
          </div>
          {state.parents.map(parent => (
            <div key={parent.id} className="h-16 flex items-center border-b border-gray-100">
              <div className="flex items-center gap-2">
                <div 
                  className="w-3 h-3 rounded-full"
                  style={{ backgroundColor: parent.color }}
                />
                <span className="text-sm font-medium text-gray-700">{parent.name}</span>
              </div>
            </div>
          ))}
        </div>

        {/* Timeline Content */}
        <div className="flex-1 overflow-x-auto">
          
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
              className={`h-16 border-b border-gray-100 relative ${
                invalidZones.has(parent.id) ? 'bg-red-50' : ''
              } ${
                dropZone?.parentId === parent.id ? 'bg-blue-50' : ''
              }`}
              onDragOver={(e) => handleParentDragOver(e, parent.id)}
              onDrop={(e) => handleParentDrop(e, parent.id)}
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
                    className={`absolute top-2 bottom-2 rounded px-2 py-1 text-xs font-medium cursor-move transition-all ${
                      isSelected ? 'ring-2 ring-yellow-400 ring-opacity-75' : ''
                    } ${
                      isDragging ? 'opacity-50 z-10' : 'hover:shadow-md'
                    } ${
                      task.status === 'completed' ? 'bg-green-500 text-white' :
                      task.status === 'in-progress' ? 'bg-blue-500 text-white' :
                      'bg-gray-500 text-white'
                    }`}
                    style={position}
                    draggable
                    onDragStart={(e) => handleTaskDragStart(e, task.id)}
                    onDragEnd={handleTaskDragEnd}
                    onClick={() => dispatch({ type: 'SET_SELECTED_TASK', taskId: task.id, toggle_parent: 'any' })}
                  >
                    <div className="truncate">{task.name}</div>
                    {task.dependencies.length > 0 && (
                      <AlertTriangle size={10} className="inline-block ml-1" />
                    )}
                  </div>
                );
              })}

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
  );
}