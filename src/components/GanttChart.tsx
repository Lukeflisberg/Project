import React, { useState, useRef } from 'react';
import { format, differenceInDays, addDays, addWeeks, addMonths, addYears } from 'date-fns';
import { Calendar, AlertTriangle, ChevronLeft, ChevronRight } from 'lucide-react';
import { useApp } from '../context/AppContext';
import { Task } from '../types';
import { importTasksFromFile } from '../helper/fileReader';

// --- Helpers ---
const clampDateRange = (start: Date, end: Date, min: Date, max: Date) => {
  const s = start < min ? min : start;
  const e = end > max ? max : end;
  return { start: s, end: e };
};

const durationDays = (t: Task) => differenceInDays(t.endDate, t.startDate); // inclusive width handled by +1 elsewhere

// Returns planned (start,end) for each task so that none overlap, after a move.
function planSequentialLayout(
  siblings: Task[],
  movedTaskId: string,
  movedNewStart: Date,
  timelineStart: Date,
  timelineEnd: Date
): Array<{ id: string; startDate: Date; endDate: Date }> {
  // Local copy
  const local = siblings.map(t => ({ ...t }));

  // Apply moved task's new dates locally first
  const moved = local.find(t => t.id === movedTaskId);
  if (!moved) return [];
  const movedDur = durationDays(moved);
  moved.startDate = movedNewStart;
  moved.endDate = addDays(movedNewStart, movedDur);

  // Sort by start date, but prioritize moved task if equal
  local.sort((a, b) => {
    const diff = a.startDate.getTime() - b.startDate.getTime();
    if (diff !== 0) return diff;

    if (a.id === movedTaskId) return -1;
    if (b.id === movedTaskId) return 1;

    return 0;
  });

  // Sweep forward ensuring no overlaps
  const updates: Array<{ id: string; startDate: Date; endDate: Date }> = [];
  let nextAvailableStart = timelineStart;

  for (const t of local) {
    const dur = durationDays(t);
    let start = t.startDate < nextAvailableStart ? nextAvailableStart : t.startDate;
    let end = addDays(start, dur);

    // Bound to timeline
    const bounded = clampDateRange(start, end, timelineStart, timelineEnd);
    start = bounded.start;
    end = bounded.end;

    // Record planned dates
    updates.push({ id: t.id, startDate: start, endDate: end });
    nextAvailableStart = addDays(end, 1);
  }

  return updates;
}

export function GanttChart() {
  const { state, dispatch } = useApp();
  const [draggedTask, setDraggedTask] = useState<string | null>(null);
  const [dropZone, setDropZone] = useState<{ parentId: string } | null>(null);
  const [insertionPoint, setInsertionPoint] = useState<{ parentId: string; position: 'before' | 'after'; targetTaskId: string } | null>(null);
  const [showUnassignedDropZone, setShowUnassignedDropZone] = useState(false);
  const [dragPosition, setDragPosition] = useState({ x: 0, y: 0 });
  const ganttRef = useRef<HTMLDivElement>(null);

  // Timeline end by scale
  const getTimelineEnd = () => {
    switch (state.timeScale) {
      case 'days': return addDays(state.timelineStart, 30);
      case 'weeks': return addWeeks(state.timelineStart, 12);
      case 'months': return addMonths(state.timelineStart, 12);
      case 'years': return addYears(state.timelineStart, 5);
      default: return addWeeks(state.timelineStart, 12);
    }
  };

  const timelineEnd = getTimelineEnd();
  const totalDays = differenceInDays(timelineEnd, state.timelineStart);

  const getTimeUnit = () => {
    switch (state.timeScale) {
      case 'days': return 1;
      case 'weeks': return 7;
      case 'months': return 30;
      case 'years': return 365;
      default: return 7;
    }
  };

  const timeUnit = getTimeUnit();
  const totalUnits = Math.ceil(totalDays / timeUnit);

  const getTasksByParent = (parentId: string | null) => {
    return state.tasks
      .filter(task => task.parentId === parentId)
      .sort((a, b) => {
        const diff = a.startDate.getTime() - b.startDate.getTime();
        if (diff !== 0) return diff;

        // If they start on the same day, prioritize the *currently dragged* task
        if (a.id === draggedTask) return -1;
        if (b.id === draggedTask) return 1;

        return 0; // otherwise keep stable
      });
  };

  const calculateTaskPosition = (task: Task) => {
    const startOffset = differenceInDays(task.startDate, state.timelineStart);
    const dur = differenceInDays(task.endDate, task.startDate) + 1; // +1 for full inclusive width
    const left = (startOffset / totalDays) * 100;
    const width = (dur / totalDays) * 100;
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

  const getInsertionPointFromMousePosition = (mouseX: number, mouseY: number): { parentId: string; position: 'before' | 'after'; targetTaskId: string } | null => {
    if (!ganttRef.current) return null;
    
    const parentId = getParentFromMousePosition(mouseY);
    if (!parentId) return null;
    
    // Check all drop indicators across all parent rows
    const dropIndicators = ganttRef.current.querySelectorAll('[data-drop-indicator]');
    const timelineContent = ganttRef.current.querySelector('.timeline-content');
    const timelineRect = timelineContent?.getBoundingClientRect();
    
    if (!timelineRect) return null;
    
    for (let i = 0; i < dropIndicators.length; i++) {
      const indicator = dropIndicators[i] as HTMLElement;
      const taskId = indicator.getAttribute('data-target-task-id');
      const position = indicator.getAttribute('data-position') as 'before' | 'after';
      const indicatorParentId = indicator.getAttribute('data-parent-id');
      const rect = indicator.getBoundingClientRect();
      
      if (!taskId || taskId === draggedTask || indicatorParentId !== parentId) continue;
      
      // Check if mouse is over this drop indicator
      if (mouseX >= rect.left && mouseX <= rect.right && mouseY >= rect.top && mouseY <= rect.bottom) {
        return { parentId: indicatorParentId, position, targetTaskId: taskId };
      }
    }
    
    return null;
  };
  const handleTaskMouseDown = (e: React.MouseEvent, taskId: string) => {
    e.preventDefault();
    e.stopPropagation();
    dispatch({ type: 'SET_SELECTED_TASK', taskId: null, toggle_parent: state.selectedParentId });

    const originalTask = state.tasks.find(t => t.id === taskId);
    if (!originalTask) return;

    const offset = { x: e.clientX, y: e.clientY };
    setDraggedTask(taskId);
    setDragPosition({ x: 0, y: 0 });
    dispatch({ type: 'SET_DRAGGING_GANTT_TASK', taskId: taskId });

    const handleMouseMove = (evt: MouseEvent) => {
      const newDragPosition = { x: evt.clientX - offset.x, y: evt.clientY - offset.y };
      setDragPosition(newDragPosition);

      // Check for insertion point
      const insertion = getInsertionPointFromMousePosition(evt.clientX, evt.clientY);
      setInsertionPoint(insertion);

      const targetParentId = getParentFromMousePosition(evt.clientY);
      if (targetParentId && targetParentId !== originalTask.parentId) {
        setDropZone({ parentId: targetParentId });
        setShowUnassignedDropZone(false);
      } else {
        setDropZone(null);
        const unassignedMenu = document.querySelector('.unassigned-tasks-container');
        if (unassignedMenu) {
          const r = unassignedMenu.getBoundingClientRect();
          setShowUnassignedDropZone(
            evt.clientX >= r.left && evt.clientX <= r.right && evt.clientY >= r.top && evt.clientY <= r.bottom
          );
        }
      }
    };

    const handleMouseUp = (evt: MouseEvent) => {
      const finalOffset = { x: evt.clientX - offset.x, y: evt.clientY - offset.y };
      dispatch({ type: 'SET_DRAGGING_GANTT_TASK', taskId: null });

      // Snapshot current task (don’t trust stale closure vars)
      const currentTask = state.tasks.find(t => t.id === taskId);
      if (!currentTask) return;

      let taskUpdated = false;
      const moveDistance = Math.sqrt(finalOffset.x ** 2 + finalOffset.y ** 2);

      if (moveDistance > 5) {
        // Handle insertion point positioning
        if (insertionPoint) {
          const targetTask = state.tasks.find(t => t.id === insertionPoint.targetTaskId);
          if (targetTask) {
            const siblings = state.tasks.filter(t => t.parentId === insertionPoint.parentId && t.id !== taskId);
            const targetIndex = siblings.findIndex(t => t.id === insertionPoint.targetTaskId);
            
            // Calculate new start date based on insertion position
            let newStartDate: Date;
            const dur = durationDays(currentTask);
            
            if (insertionPoint.position === 'before') {
              // Place before target task
              newStartDate = new Date(targetTask.startDate.getTime() - (dur + 1) * 24 * 60 * 60 * 1000);
            } else {
              // Place after target task
              newStartDate = new Date(targetTask.endDate.getTime() + 24 * 60 * 60 * 1000);
            }
            
            // Bound check
            if (newStartDate >= state.timelineStart && addDays(newStartDate, dur) <= getTimelineEnd()) {
              // Update parent if needed
              if (currentTask.parentId !== insertionPoint.parentId) {
                dispatch({ type: 'UPDATE_TASK_PARENT', taskId, newParentId: insertionPoint.parentId });
              }
              
              // Build updated siblings list including the moved task
              const allSiblings = state.tasks
                .filter(t => t.parentId === insertionPoint.parentId)
                .map(t => t.id === taskId ? { ...t, parentId: insertionPoint.parentId } : t);
              
              // Plan the sequential layout
              const plan = planSequentialLayout(
                allSiblings as Task[],
                taskId,
                newStartDate,
                state.timelineStart,
                getTimelineEnd()
              );
              
              // Apply the planned changes
              for (const u of plan) {
                const orig = state.tasks.find(t => t.id === u.id);
                if (!orig) continue;
                if (orig.startDate.getTime() !== u.startDate.getTime() || orig.endDate.getTime() !== u.endDate.getTime()) {
                  dispatch({
                    type: 'UPDATE_TASK_DATES',
                    taskId: u.id,
                    startDate: u.startDate,
                    endDate: u.endDate
                  });
                }
              }
              
              taskUpdated = true;
            }
          }
        }
        
        if (!taskUpdated) {
        // 1) Unassign drop
        const unassignedMenu = document.querySelector('.unassigned-tasks-container');
        if (unassignedMenu) {
          const r = unassignedMenu.getBoundingClientRect();
          if (evt.clientX >= r.left && evt.clientX <= r.right && evt.clientY >= r.top && evt.clientY <= r.bottom) {
            dispatch({ type: 'UPDATE_TASK_PARENT', taskId, newParentId: null });
            taskUpdated = true;
          }
        }

        if (!taskUpdated) {
          // 2) Horizontal shift (time)
          if (Math.abs(finalOffset.x) > 5 && ganttRef.current) {
            const timelineContent = ganttRef.current.querySelector('.timeline-content');
            const rect = timelineContent?.getBoundingClientRect();

            if (rect) {
              const daysDelta = Math.round((finalOffset.x / rect.width) * totalDays);
              const newStartDate = addDays(currentTask.startDate, daysDelta);
              const dur = durationDays(currentTask);
              const newEndDate = addDays(newStartDate, dur);

              // Bound check for moved task itself
              if (newStartDate >= state.timelineStart && newEndDate <= timelineEnd) {
                // Build local siblings snapshot including this task
                const siblings = state.tasks.filter(t => t.parentId === currentTask.parentId);

                // Plan the full, non-overlapping layout locally first
                const plan = planSequentialLayout(
                  siblings,
                  currentTask.id,
                  newStartDate,
                  state.timelineStart,
                  timelineEnd
                );

                // Dispatch only real changes
                for (const u of plan) {
                  const orig = state.tasks.find(t => t.id === u.id);
                  if (!orig) continue;
                  if (orig.startDate.getTime() !== u.startDate.getTime() || orig.endDate.getTime() !== u.endDate.getTime()) {
                    dispatch({
                      type: 'UPDATE_TASK_DATES',
                      taskId: u.id,
                      startDate: u.startDate,
                      endDate: u.endDate
                    });
                  }
                }
                taskUpdated = true;
              }
            }
          }

          // 3) Vertical shift (parent change)
          const newParentId = getParentFromMousePosition(evt.clientY);
          if (newParentId && newParentId !== currentTask.parentId) {
            // Move to new parent first
            dispatch({ type: 'UPDATE_TASK_PARENT', taskId, newParentId });

            // Reflow within the new parent immediately using local plan
            const keptStart = currentTask.startDate;
            const dur = durationDays(currentTask);
            const keptEnd = addDays(keptStart, dur);

            // If out of bounds, clamp before planning
            const { start: startClamped, end: endClamped } =
              clampDateRange(keptStart, keptEnd, state.timelineStart, timelineEnd);

            const newParentSiblings = state.tasks
              .filter(t => t.parentId === newParentId || t.id === taskId) // include moved task by id just in case parent update applies next tick
              .map(t => (t.id === taskId ? { ...t, parentId: newParentId, startDate: startClamped, endDate: endClamped } : t));

            const plan = planSequentialLayout(
              newParentSiblings as Task[],
              taskId,
              startClamped,
              state.timelineStart,
              timelineEnd
            );

            for (const u of plan) {
              const orig = state.tasks.find(t => t.id === u.id);
              if (!orig) continue;
              if (orig.startDate.getTime() !== u.startDate.getTime() || orig.endDate.getTime() !== u.endDate.getTime()) {
                dispatch({
                  type: 'UPDATE_TASK_DATES',
                  taskId: u.id,
                  startDate: u.startDate,
                  endDate: u.endDate
                });
              }
            }

            taskUpdated = true;
          }
        }
        }
      } else {
        // Click (no real drag)
        dispatch({ type: 'SET_SELECTED_TASK', taskId, toggle_parent: 'any' });
      }

      // Cleanup
      setDraggedTask(null);
      setDropZone(null);
      setInsertionPoint(null);
      setShowUnassignedDropZone(false);
      setDragPosition({ x: 0, y: 0 });

      document.removeEventListener('mousemove', handleMouseMove);
      document.removeEventListener('mouseup', handleMouseUp);
    };

    document.addEventListener('mousemove', handleMouseMove);
    document.addEventListener('mouseup', handleMouseUp);
  };

  // Navigation
  const navigateTimeline = (direction: 'prev' | 'next') => {
    let newStart: Date;
    switch (state.timeScale) {
      case 'days': newStart = direction === 'next' ? addDays(state.timelineStart, 7) : addDays(state.timelineStart, -7); break;
      case 'weeks': newStart = direction === 'next' ? addWeeks(state.timelineStart, 4) : addWeeks(state.timelineStart, -4); break;
      case 'months': newStart = direction === 'next' ? addMonths(state.timelineStart, 3) : addMonths(state.timelineStart, -3); break;
      case 'years': newStart = direction === 'next' ? addYears(state.timelineStart, 1) : addYears(state.timelineStart, -1); break;
      default: newStart = state.timelineStart;
    }
    dispatch({ type: 'SET_TIMELINE_START', startDate: newStart });
  };

  const formatHeaderLabel = (unitIndex: number) => {
    const date = addDays(state.timelineStart, unitIndex * timeUnit);
    switch (state.timeScale) {
      case 'days': return format(date, 'MMM dd');
      case 'weeks': return format(date, 'MMM dd');
      case 'months': return format(date, 'MMM yyyy');
      case 'years': return format(date, 'yyyy');
      default: return format(date, 'MMM dd');
    }
  };

  return (
    <div ref={ganttRef} className="gantt-chart-container relative bg-white rounded-lg shadow-lg p-6 h-full overflow-hidden">
      <div className="flex items-center gap-2 mb-4">
        <Calendar className="text-green-600" size={24}/>
        <h2 className="text-xl font-semibold text-gray-800">Task Timeline</h2>

        <div className="ml-auto flex items-center gap-4">
          <div className="flex gap-1 bg-gray-100 rounded-lg p-1">
            {(['days', 'weeks', 'months', 'years'] as const).map((scale) => (
              <button
                key={scale}
                onClick={() => dispatch({ type: 'SET_TIME_SCALE', timeScale: scale })}
                className={`px-3 py-1 rounded text-xs font-medium transition-colors ${
                  state.timeScale === scale ? 'bg-white text-green-600 shadow-sm' : 'text-gray-600 hover:text-gray-800'
                }`}
              >
                {scale.charAt(0).toUpperCase() + scale.slice(1)}
              </button>
            ))}
          </div>

          <div className="flex items-center gap-2">
            <button onClick={() => navigateTimeline('prev')} className="p-1 rounded hover:bg-gray-100 text-gray-600 hover:text-gray-800">
              <ChevronLeft size={16} />
            </button>
            <span className="text-sm font-medium text-gray-700 min-w-[120px] text-center">
              {format(state.timelineStart, 'MMM yyyy')} - {format(timelineEnd, 'MMM yyyy')}
            </span>
            <button onClick={() => navigateTimeline('next')} className="p-1 rounded hover:bg-gray-100 text-gray-600 hover:text-gray-800">
              <ChevronRight size={16} />
            </button>
          </div>
        </div>
      </div>

      <div className="mb-4 text-xs text-gray-500 text-center">
        Drag tasks horizontally to adjust timing, vertically to change teams
      </div>

      <>
        <div className="flex h-full">
          {/* Left: Teams */}
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
                onClick={() => dispatch({ type: 'SET_SELECTED_PARENT', parentId: parent.id })}
              >
                <div className="flex items-center gap-2">
                  <div className="w-3 h-3 rounded-full" style={{ backgroundColor: parent.color }} />
                  <span className="text-sm font-medium text-gray-700">{parent.name}</span>
                </div>
                {dropZone?.parentId === parent.id && (
                  <div className="ml-auto text-blue-600 text-xs font-medium">Drop here</div>
                )}
              </div>
            ))}
          </div>

          {/* Right: Timeline */}
          <div className="flex-1 overflow-x-auto">
            <div className="timeline-content relative">
              {/* Header scale */}
              <div className="h-12 border-b border-gray-200 relative">
                {Array.from({ length: totalUnits }, (_, unitIndex) => (
                  <div
                    key={unitIndex}
                    className="absolute top-0 h-full flex items-center justify-center text-xs text-gray-600 border-r border-gray-100"
                    style={{
                      left: `${(unitIndex * timeUnit / totalDays) * 100}%`,
                      width: `${(timeUnit / totalDays) * 100}%`
                    }}
                  >
                    {formatHeaderLabel(unitIndex)}
                  </div>
                ))}
              </div>

              {/* Rows */}
              {state.parents.map(parent => (
                <div
                  key={parent.id}
                  className={`h-16 border-b border-gray-100 relative transition-all ${
                    dropZone?.parentId === parent.id ? 'bg-blue-50' : ''
                  }`}
                  data-parent-row="true"
                  data-parent-id={parent.id}
                >
                  {/* Grid lines */}
                  {Array.from({ length: totalUnits }, (_, unitIndex) => (
                    <div
                      key={unitIndex}
                      className="absolute top-0 bottom-0 border-r border-gray-50"
                      style={{ left: `${((unitIndex + 1) * timeUnit / totalDays) * 100}%` }}
                    />
                  ))}

                  {/* Tasks */}
                  {getTasksByParent(parent.id).map(task => {
                    const position = calculateTaskPosition(task);
                    const isSelected = state.selectedTaskId === task.id;
                    const isBeingDragged = draggedTask === task.id;

                    const dragStyle = isBeingDragged
                      ? {
                          transform: `translate(${dragPosition.x}px, ${dragPosition.y}px)`,
                          zIndex: 1000,
                          cursor: 'grabbing',
                          transition: 'none',
                          pointerEvents: 'none'
                        }
                      : { cursor: 'grab' };

                    return (
                      <React.Fragment key={task.id}>
                        {/* Drop indicators - always visible when dragging */}
                        {draggedTask && draggedTask !== task.id && (
                          <>
                            {/* Before indicator */}
                            <div
                              className={`absolute top-0 bottom-0 w-2 bg-blue-400 bg-opacity-50 hover:bg-blue-500 hover:bg-opacity-70 transition-all cursor-pointer z-40 ${
                                insertionPoint?.targetTaskId === task.id && insertionPoint?.position === 'before' 
                                  ? 'bg-blue-600 bg-opacity-80 animate-pulse shadow-lg' 
                                  : ''
                              }`}
                              style={{ left: `calc(${position.left} - 4px)` }}
                              data-drop-indicator="true"
                              data-target-task-id={task.id}
                              data-position="before"
                              data-parent-id={parent.id}
                            />
                            {/* After indicator */}
                            <div
                              className={`absolute top-0 bottom-0 w-2 bg-blue-400 bg-opacity-50 hover:bg-blue-500 hover:bg-opacity-70 transition-all cursor-pointer z-40 ${
                                insertionPoint?.targetTaskId === task.id && insertionPoint?.position === 'after' 
                                  ? 'bg-blue-600 bg-opacity-80 animate-pulse shadow-lg' 
                                  : ''
                              }`}
                              style={{ left: `calc(${position.left} + ${position.width})` }}
                              data-drop-indicator="true"
                              data-target-task-id={task.id}
                              data-position="after"
                              data-parent-id={parent.id}
                            />
                          </>
                        )}
                        
                        <div
                          className={`absolute top-2 bottom-2 rounded px-2 py-1 text-xs font-medium cursor-move transition-all select-none 
                            ${isSelected ? 'ring-4 ring-yellow-400 ring-opacity-100 scale-105' : ''} 
                            ${isBeingDragged ? 'opacity-80 shadow-xl' : 'hover:shadow-md'}
                            text-white`}
                          style={{ backgroundColor: parent.color, ...position, ...dragStyle }}
                          onMouseDown={(e) => handleTaskMouseDown(e, task.id)}
                          data-task-id={task.id}
                        >
                          <div className="truncate flex items-center justify-between h-full">
                            <span>{task.name}</span>
                            {task.dependencies?.length > 0 && <AlertTriangle size={10} className="ml-1" />}
                          </div>
                        </div>
                      </React.Fragment>
                    );
                  })}

                  {/* Visual drop hint */}
                  {dropZone?.parentId === parent.id && (
                    <div className="absolute inset-0 bg-blue-200 bg-opacity-30 border-2 border-dashed border-blue-400 rounded flex items-center justify-center pointer-events-none">
                      <span className="text-blue-700 font-medium text-sm">Drop here to assign</span>
                    </div>
                  )}
                </div>
              ))}

              {/* Global drop hint when dragging from unassigned */}
              {state.draggingTaskId_unassigned && (
                <div className="absolute inset-0 bg-green-100 bg-opacity-50 border-2 border-dashed border-green-400 rounded-lg flex items-center justify-center z-10 pointer-events-none">
                  <div className="text-center">
                    <div className="flex items-center justify-center gap-2 text-green-700 mb-2">
                      <Calendar size={24} />
                      <span className="font-semibold text-lg">Drop here to assign to a team</span>
                    </div>
                    <div className="text-sm text-green-600">
                      Drag to specific team rows to assign to that team
                    </div>
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>

        {/* Debug HUD */}
        {draggedTask && (
          <div className="fixed top-4 right-4 bg-black bg-opacity-75 text-white p-2 rounded text-xs z-50">
            <div>Dragging: {state.tasks.find(t => t.id === draggedTask)?.name}</div>
            <div>Position: {dragPosition.x.toFixed(0)}, {dragPosition.y.toFixed(0)}</div>
            {dropZone && <div>Drop zone: {dropZone.parentId}</div>}
            {insertionPoint && <div>Insert {insertionPoint.position} task: {state.tasks.find(t => t.id === insertionPoint.targetTaskId)?.name}</div>}
            {showUnassignedDropZone && <div>Unassigned drop zone active</div>}
          </div>
        )}
      </>
    </div>
  );
}
                          <div
                            className="absolute top-0 bottom-0 w-1 bg-blue-500 rounded-full shadow-lg z-50 animate-pulse"
                            style={{ left: position.left }}
                          />
                        )}
                        
                        <div
                          className={`absolute top-2 bottom-2 rounded px-2 py-1 text-xs font-medium cursor-move transition-all select-none 
                            ${isSelected ? 'ring-4 ring-yellow-400 ring-opacity-100 scale-105' : ''} 
                            ${isBeingDragged ? 'opacity-80 shadow-xl' : 'hover:shadow-md'}
                            text-white`}
                          style={{ backgroundColor: parent.color, ...position, ...dragStyle }}
                          onMouseDown={(e) => handleTaskMouseDown(e, task.id)}
                          data-task-id={task.id}
                        >
                          <div className="truncate flex items-center justify-between h-full">
                            <span>{task.name}</span>
                            {task.dependencies?.length > 0 && <AlertTriangle size={10} className="ml-1" />}
                          </div>
                        </div>
                        
                        {/* Drop indicator - After */}
                        {draggedTask && draggedTask !== task.id && insertionPoint?.targetTaskId === task.id && insertionPoint?.position === 'after' && (
                          <div
                            className="absolute top-0 bottom-0 w-1 bg-blue-500 rounded-full shadow-lg z-50 animate-pulse"
                            style={{ left: `calc(${position.left} + ${position.width})` }}
                          />
                        )}
                      </React.Fragment>
                    );
                  })}

                  {/* Visual drop hint */}
                  {dropZone?.parentId === parent.id && (
                    <div className="absolute inset-0 bg-blue-200 bg-opacity-30 border-2 border-dashed border-blue-400 rounded flex items-center justify-center pointer-events-none">
                      <span className="text-blue-700 font-medium text-sm">Drop here to assign</span>
                    </div>
                  )}
                </div>
              ))}

              {/* Global drop hint when dragging from unassigned */}
              {state.draggingTaskId_unassigned && (
                <div className="absolute inset-0 bg-green-100 bg-opacity-50 border-2 border-dashed border-green-400 rounded-lg flex items-center justify-center z-10 pointer-events-none">
                  <div className="text-center">
                    <div className="flex items-center justify-center gap-2 text-green-700 mb-2">
                      <Calendar size={24} />
                      <span className="font-semibold text-lg">Drop here to assign to a team</span>
                    </div>
                    <div className="text-sm text-green-600">
                      Drag to specific team rows to assign to that team
                    </div>
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>

        {/* Debug HUD */}
        {draggedTask && (
          <div className="fixed top-4 right-4 bg-black bg-opacity-75 text-white p-2 rounded text-xs z-50">
            <div>Dragging: {state.tasks.find(t => t.id === draggedTask)?.name}</div>
            <div>Position: {dragPosition.x.toFixed(0)}, {dragPosition.y.toFixed(0)}</div>
            {dropZone && <div>Drop zone: {dropZone.parentId}</div>}
            {insertionPoint && <div>Insert {insertionPoint.position} task: {state.tasks.find(t => t.id === insertionPoint.targetTaskId)?.name}</div>}
            {showUnassignedDropZone && <div>Unassigned drop zone active</div>}
          </div>
        )}
      </>
    </div>
  );
}