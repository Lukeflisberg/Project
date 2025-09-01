import { useState, useRef } from 'react';
import { format, differenceInDays, addDays, addWeeks, addMonths, addYears } from 'date-fns';
import { Calendar, AlertTriangle, ChevronLeft, ChevronRight, Upload } from 'lucide-react';
import { useApp } from '../context/AppContext';
import { Task } from '../types';
import { importTasksFromFile } from '../helper/fileReader';

// --- Helpers ---
export const clampDateRange = (start: Date, end: Date, min: Date, max: Date) => {
  const s = start < min ? min : start;
  const e = end > max ? max : end;
  return { start: s, end: e };
};

export const durationDays = (t: Task) => differenceInDays(t.endDate, t.startDate); // inclusive width handled by +1 elsewhere

// Returns planned (start,end) for each task so that none overlap, after a move.
export function planSequentialLayout(
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
  const [, setShowUnassignedDropZone] = useState(false);
  const [dragPosition, setDragPosition] = useState({ x: 0, y: 0 });
  const [snapTarget, setSnapTarget] = useState<{ parentId: string; taskId: string; side: 'left' | 'right' } | null>(null);
  const [, setSnapLeftPct] = useState<number | null>(null);
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

  // Compute snap target at a point (drop-time priority)
  const getSnapAt = (
    clientX: number,
    clientY: number,
    excludeTaskId: string
  ): { parentId: string; taskId: string; side: 'left' | 'right' } | null => {
    const parentId = getParentFromMousePosition(clientY);
    if (!parentId || !ganttRef.current) return null;

    const timelineContent = ganttRef.current.querySelector('.timeline-content') as HTMLElement | null;
    const rect = timelineContent?.getBoundingClientRect();
    if (!rect) return null;

    const zoneWidthPx = 16;
    const pointerX = clientX;

    const candidates = state.tasks.filter(t => t.parentId === parentId && t.id !== excludeTaskId);

    for (const t of candidates) {
      const startOffsetDays = differenceInDays(t.startDate, state.timelineStart);
      const endOffsetDays = differenceInDays(t.endDate, state.timelineStart) + 1;
      const leftPx = rect.left + (startOffsetDays / totalDays) * rect.width;
      const rightPx = rect.left + (endOffsetDays / totalDays) * rect.width;

      const inLeftZone = pointerX >= leftPx - zoneWidthPx / 2 && pointerX <= leftPx + zoneWidthPx / 2;
      const inRightZone = pointerX >= rightPx - zoneWidthPx / 2 && pointerX <= rightPx + zoneWidthPx / 2;

      if (inLeftZone) {
        // capacity check (left)
        const moving = state.tasks.find(x => x.id === excludeTaskId);
        if (!moving) continue;
        const requiredDays = durationDays(moving) + 1;
        const preds = state.tasks.filter(x => x.parentId === parentId && x.id !== t.id && x.id !== excludeTaskId && x.endDate < t.startDate);
        const predecessor = preds.sort((a,b) => b.endDate.getTime() - a.endDate.getTime())[0];
        const earliestStart = predecessor ? addDays(predecessor.endDate, 1) : state.timelineStart;
        const desiredStart = addDays(t.startDate, -requiredDays);
        if (desiredStart >= earliestStart) return { parentId, taskId: t.id, side: 'left' };
      }
      if (inRightZone) {
        // capacity check (right)
        const moving = state.tasks.find(x => x.id === excludeTaskId);
        if (!moving) continue;
        const succs = state.tasks.filter(x => x.parentId === parentId && x.id !== t.id && x.id !== excludeTaskId && x.startDate > t.endDate);
        const successor = succs.sort((a,b) => a.startDate.getTime() - b.startDate.getTime())[0];
        const desiredStart = addDays(t.endDate, 1);
        const desiredEnd = addDays(desiredStart, durationDays(moving));
        const latestEnd = successor ? addDays(successor.startDate, -1) : timelineEnd;
        if (desiredEnd <= latestEnd) return { parentId, taskId: t.id, side: 'right' };
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

      // Snap detection near other task edges
      setSnapTarget(null);
      setSnapLeftPct(null);
      const targetParentIdForSnap = getParentFromMousePosition(evt.clientY);
      const timelineContent = ganttRef.current?.querySelector('.timeline-content') as HTMLElement | null;
      const rect = timelineContent?.getBoundingClientRect();
      if (rect && targetParentIdForSnap) {
        const pointerX = evt.clientX;
        const candidates = state.tasks.filter(t => t.parentId === targetParentIdForSnap && t.id !== (draggedTask ?? ''));
        const zoneWidthPx = 16; // visual snap zone width
        let match: { taskId: string; side: 'left'|'right'; pct: number } | null = null;

        for (const t of candidates) {
          const startOffsetDays = differenceInDays(t.startDate, state.timelineStart);
          const endOffsetDays = differenceInDays(t.endDate, state.timelineStart) + 1; // next day boundary
          const leftPx = rect.left + (startOffsetDays / totalDays) * rect.width;
          const rightPx = rect.left + (endOffsetDays / totalDays) * rect.width;

          const inLeftZone = pointerX >= leftPx - zoneWidthPx / 2 && pointerX <= leftPx + zoneWidthPx / 2;
          const inRightZone = pointerX >= rightPx - zoneWidthPx / 2 && pointerX <= rightPx + zoneWidthPx / 2;

          if (inLeftZone) {
            match = { taskId: t.id, side: 'left', pct: (startOffsetDays / totalDays) * 100 };
            break;
          }
          if (inRightZone) {
            match = { taskId: t.id, side: 'right', pct: (endOffsetDays / totalDays) * 100 };
            break;
          }
        }

        if (match && draggedTask) {
          const target = state.tasks.find(t => t.id === match.taskId);
          const moving = state.tasks.find(t => t.id === draggedTask);
          if (target && moving) {
            const requiredDays = durationDays(moving) + 1; // inclusive width needed
            if (match.side === 'left') {
              // find predecessor
              const preds = state.tasks.filter(t => t.parentId === targetParentIdForSnap && t.id !== target.id && t.id !== draggedTask && t.endDate < target.startDate);
              const predecessor = preds.sort((a,b) => b.endDate.getTime() - a.endDate.getTime())[0];
              const earliestStart = predecessor ? addDays(predecessor.endDate, 1) : state.timelineStart;
              const desiredStart = addDays(target.startDate, -requiredDays);
              if (desiredStart >= earliestStart) {
                setSnapTarget({ parentId: targetParentIdForSnap, taskId: match.taskId, side: match.side });
                setSnapLeftPct(match.pct);
              }
            } else {
              // right side: ensure space before successor
              const succs = state.tasks.filter(t => t.parentId === targetParentIdForSnap && t.id !== target.id && t.id !== draggedTask && t.startDate > target.endDate);
              const successor = succs.sort((a,b) => a.startDate.getTime() - b.startDate.getTime())[0];
              const desiredStart = addDays(target.endDate, 1);
              const desiredEnd = addDays(desiredStart, durationDays(moving));
              const latestEnd = successor ? addDays(successor.startDate, -1) : timelineEnd;
              if (desiredEnd <= latestEnd) {
                setSnapTarget({ parentId: targetParentIdForSnap, taskId: match.taskId, side: match.side });
                setSnapLeftPct(match.pct);
              }
            }
          }
        }
      }

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
        // 1) Snap to neighbor edges (priority at drop)
        const snapNow = getSnapAt(evt.clientX, evt.clientY, taskId);
        if (snapNow) {
          const target = state.tasks.find(t => t.id === snapNow.taskId);
          if (target) {
            const dur = durationDays(currentTask);
            const desiredStart = snapNow.side === 'left'
              ? addDays(target.startDate, -(dur + 1))
              : addDays(target.endDate, 1);

            if (snapNow.parentId === currentTask.parentId) {
              const siblings = state.tasks.filter(t => t.parentId === currentTask.parentId);
              const plan = planSequentialLayout(
                siblings,
                currentTask.id,
                desiredStart,
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
            } else {
              // Move to new parent and reflow with desiredStart
              dispatch({ type: 'UPDATE_TASK_PARENT', taskId, newParentId: snapNow.parentId });
              const desiredEnd = addDays(desiredStart, dur);
              const { start: startClamped, end: endClamped } =
                clampDateRange(desiredStart, desiredEnd, state.timelineStart, timelineEnd);

              const newParentSiblings = state.tasks
                .filter(t => t.parentId === snapNow.parentId || t.id === taskId)
                .map(t => (t.id === taskId ? { ...t, parentId: snapNow.parentId, startDate: startClamped, endDate: endClamped } : t));

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

        // 2) Unassign drop
        if (!taskUpdated) {
          const unassignedMenu = document.querySelector('.unassigned-tasks-container');
          if (unassignedMenu) {
            const r = unassignedMenu.getBoundingClientRect();
            if (evt.clientX >= r.left && evt.clientX <= r.right && evt.clientY >= r.top && evt.clientY <= r.bottom) {
              dispatch({ type: 'UPDATE_TASK_PARENT', taskId, newParentId: null });
              taskUpdated = true;
            }
          }
        }

        if (!taskUpdated) {
          // 2) Snap to neighbor edges
          if (snapTarget) {
            const target = state.tasks.find(t => t.id === snapTarget.taskId);
            if (target) {
              const dur = durationDays(currentTask);
              const desiredStart = snapTarget.side === 'left'
                ? addDays(target.startDate, -(dur + 1))
                : addDays(target.endDate, 1);

              if (snapTarget.parentId === currentTask.parentId) {
                const siblings = state.tasks.filter(t => t.parentId === currentTask.parentId);
                const plan = planSequentialLayout(
                  siblings,
                  currentTask.id,
                  desiredStart,
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
              } else {
                // Move to new parent and reflow with desiredStart
                dispatch({ type: 'UPDATE_TASK_PARENT', taskId, newParentId: snapTarget.parentId });
                const desiredEnd = addDays(desiredStart, dur);
                const { start: startClamped, end: endClamped } =
                  clampDateRange(desiredStart, desiredEnd, state.timelineStart, timelineEnd);

                const newParentSiblings = state.tasks
                  .filter(t => t.parentId === snapTarget.parentId || t.id === taskId)
                  .map(t => (t.id === taskId ? { ...t, parentId: snapTarget.parentId, startDate: startClamped, endDate: endClamped } : t));

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

          // 3) Horizontal shift (time)
          if (!taskUpdated && Math.abs(finalOffset.x) > 5 && ganttRef.current) {
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
          const newParentId = !taskUpdated ? getParentFromMousePosition(evt.clientY) : null;
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
      } else {
        // Click (no real drag)
        dispatch({ type: 'SET_SELECTED_TASK', taskId, toggle_parent: 'any' });
      }

      // Cleanup
      setDraggedTask(null);
      setDropZone(null);
      setShowUnassignedDropZone(false);
      setDragPosition({ x: 0, y: 0 });
      setSnapTarget(null);
      setSnapLeftPct(null);

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

          {/* Import tasks */}
          <div className="relative">
            <input
              id="import-file-input"
              type="file"
              accept="application/json"
              className="hidden"
              onChange={async (e) => {
                const file = e.target.files?.[0];
                if (!file) return;
                try {
                  const existingIds = state.tasks.map(t => t.id);
                  const newTasks = await importTasksFromFile(file, existingIds.length); 
                  // ensure date instances (in case JSON parser returns strings already handled above)
                  const normalized = newTasks.map(t => ({
                    ...t,
                    startDate: new Date(t.startDate),
                    endDate: new Date(t.endDate),
                  }));
                  dispatch({ type: 'ADD_TASKS', tasks: normalized });
                } catch (_) {
                  // silently ignore malformed files
                } finally {
                  e.currentTarget.value = '';
                }
              }}
            />
            <button
              type="button"
              onClick={() => document.getElementById('import-file-input')?.click()}
              className="flex items-center gap-2 px-3 py-1 rounded text-xs font-medium bg-green-600 text-white hover:bg-green-700"
            >
              <Upload size={14} /> Import
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

                  {/* Edge guides on all tasks (wider, animated, labeled) */}
                  {(draggedTask || state.draggingTaskId_unassigned) && getTasksByParent(parent.id).map(t => {
                    const startPct = (differenceInDays(t.startDate, state.timelineStart) / totalDays) * 100;
                    const endPct = ((differenceInDays(t.endDate, state.timelineStart) + 1) / totalDays) * 100;
                    const isLeftActive = !!(snapTarget && snapTarget.parentId === parent.id && snapTarget.taskId === t.id && snapTarget.side === 'left');
                    const isRightActive = !!(snapTarget && snapTarget.parentId === parent.id && snapTarget.taskId === t.id && snapTarget.side === 'right');
                    return (
                      <div key={`${t.id}-guides`}>
                        {/* Left guide */}
                        <div
                          className="absolute top-0 bottom-0 pointer-events-none"
                          style={{ left: `${startPct}%`, marginLeft: -8, width: 16, zIndex: 20 }}
                        >
                          <div
                            className={`relative h-full rounded-sm ${isLeftActive ? 'bg-emerald-500/50 animate-pulse' : 'bg-emerald-400/20'}`}
                            style={{ boxShadow: isLeftActive ? '0 0 0 2px rgba(16,185,129,0.6)' : undefined }}
                          >
                            <div className="absolute inset-y-0 left-1/2 -translate-x-1/2 w-px bg-emerald-700/70"></div>
                            {isLeftActive && (
                              <div className="absolute -top-5 left-1/2 -translate-x-1/2 px-2 py-0.5 rounded text-[10px] font-semibold bg-emerald-600 text-white shadow">
                                Before
                              </div>
                            )}
                          </div>
                        </div>
                        {/* Right guide */}
                        <div
                          className="absolute top-0 bottom-0 pointer-events-none"
                          style={{ left: `${endPct}%`, marginLeft: -8, width: 16, zIndex: 20 }}
                        >
                          <div
                            className={`relative h-full rounded-sm ${isRightActive ? 'bg-emerald-500/50 animate-pulse' : 'bg-emerald-400/20'}`}
                            style={{ boxShadow: isRightActive ? '0 0 0 2px rgba(16,185,129,0.6)' : undefined }}
                          >
                            <div className="absolute inset-y-0 left-1/2 -translate-x-1/2 w-px bg-emerald-700/70"></div>
                            {isRightActive && (
                              <div className="absolute -top-5 left-1/2 -translate-x-1/2 px-2 py-0.5 rounded text-[10px] font-semibold bg-emerald-600 text-white shadow">
                                After
                              </div>
                            )}
                          </div>
                        </div>
                      </div>
                    );
                  })}

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
                      <div
                        key={task.id}
                        className={`absolute top-2 bottom-2 rounded px-2 py-1 text-xs font-medium cursor-move transition-all select-none 
                          ${isSelected ? 'ring-4 ring-yellow-400 ring-opacity-100 scale-105' : ''} 
                          ${isBeingDragged ? 'opacity-80 shadow-xl' : 'hover:shadow-md'}
                          text-white`}
                        style={{ backgroundColor: parent.color, ...position, ...dragStyle }}
                        onMouseDown={(e) => handleTaskMouseDown(e, task.id)}
                      >
                        <div className="truncate flex items-center justify-between h-full">
                          <span>{task.name}</span>
                          {task.dependencies?.length > 0 && <AlertTriangle size={10} className="ml-1" />}
                        </div>
                      </div>
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

              </>
    </div>
  );
}