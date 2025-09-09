import { useState, useRef } from 'react';
import type { CSSProperties } from 'react';
import { Calendar, Upload } from 'lucide-react';
import { useApp } from '../context/AppContext';
import { Task } from '../types';
import { importTasksFromFile, processImportedTasks } from '../helper/fileReader';

// ----------------------
// Period Configuration
// ----------------------
// Default periods and their lengths used for fallback and initial state.
const PERIODS_FALLBACK = ['P1','P2','P3','P4','P5','P6','P7','P8','P9','P10','P11','P12','P13'];
const PERIOD_LEN_FALLBACK = 40; 

// ----------------------
// Task Utility Functions
// ----------------------
// Calculate effective duration, check for disallowed assignments, and clamp values.
const effectiveDuration = (t: Task, parentId?: string | null) => {
  const pid = parentId !== undefined ? parentId : t.parentId;
  const ov = pid ? t.specialTeams?.[pid] : undefined;
  return typeof ov === 'number' ? Math.max(1, ov + setupOf(t)) : Math.max(1, t.durationHours + setupOf(t));
};
const isDisallowed = (t: Task, parentId?: string | null) => {
  const pid = parentId !== undefined ? parentId : t.parentId;
  const ov = pid ? t.specialTeams?.[pid] : undefined;
  return ov === 'x';
};
const endHour = (t: Task) => t.startHour + effectiveDuration(t);
const clamp = (v: number, min: number, max: number) => Math.max(min, Math.min(max, v));

// Setup helpers
const setupOf = (t: Task) => {
  const n = t.setup ?? 0;
  return Number.isFinite(n) ? Math.max(0, n) : 0;
};

// ----------------------
// Invalid Period Helpers
// ----------------------
// Checks if a task's scheduled time overlaps with any invalid period.
function isInInvalidPeriod(task: Task, startHour: number, endHour: number, periods: string[], periodOffsets: number[], periodLengths: number[]): boolean {
  if (!task.invalidPeriods || !task.invalidPeriods.length) return false;
  for (const period of task.invalidPeriods) {
    const idx = periods.indexOf(period);
    if (idx === -1) continue;
    const periodStart = periodOffsets[idx];
    const periodEnd = periodStart + periodLengths[idx];
    // If any overlap
    if (startHour < periodEnd && endHour > periodStart) return true;
  }
  return false;
}

const occStart = (t: Task) => t.startHour;
const occEnd = (t: Task) => endHour(t);

// ----------------------
// Sequential Layout Planner
// ----------------------
// Returns planned (startHour, durationHours) for each task so none overlap, after a move.
function planSequentialLayoutHours(
  siblings: Task[],
  movedTaskId: string,
  movedNewStartHour: number,
  maxHour: number
): Array<{ id: string; startHour: number; durationHours: number }> {
  // Local copy of siblings
  const local = siblings.map(t => ({ ...t }));

  // Apply moved task's new start locally first (no snapping)
  const moved = local.find(t => t.id === movedTaskId);
  if (!moved) return [];
  const movedDur = effectiveDuration(moved, moved.parentId);
  moved.startHour = clamp(movedNewStartHour, 0, Math.max(0, maxHour - movedDur));

  // Sort other tasks by their current occupied start positions
  const others = local.filter(t => t.id !== movedTaskId)
                      .sort((a, b) => occStart(a) - occStart(b));

  // Find where to insert the moved task based on its new occupied start
  const movedOccStart = occStart(moved);
  let insertIndex = 0;
  while (insertIndex < others.length && occStart(others[insertIndex]) < movedOccStart) {
    insertIndex++;
  }

  // Insert moved task at determined position
  const orderedTasks = [
    ...others.slice(0, insertIndex),
    moved,
    ...others.slice(insertIndex)
  ];

  // Sweep both forward and backwards ensuring no overlaps, keeping moved at or as close as possible to its desired position
  const updates: Array<{ id: string; startHour: number; durationHours: number }> = [];
  
  // Create working array with current positions
  const working = orderedTasks.map(t => ({
    task: t,
    occStart: occStart(t),
    occEnd: occEnd(t),
    duration: effectiveDuration(t, t.parentId),
  }));

  // Resolve overlaps by pushing tasks in both directions from the insertion point
  let changed = true;
  let iterations = 0;
  const maxIterations = working.length * 2; // Prevent infinite loops

  while (changed && iterations < maxIterations) {
    changed = false;
    iterations++;

    // Forward pass: push tasks to the right if they overlap with previous task
    for (let i = 1; i < working.length; i++) {
      const prev = working[i - 1];
      const curr = working[i];
      
      if (curr.occStart < prev.occEnd) {
        // Overlap detected - push current task to the right
        const newOccStart = prev.occEnd;
        const newStart = newOccStart;
        const clampedStart = clamp(newStart, 0, Math.max(0, maxHour - curr.duration));
        
        if (clampedStart !== curr.task.startHour) {
          curr.task.startHour = clampedStart;
          curr.occStart = occStart(curr.task);
          curr.occEnd = occEnd(curr.task);
          changed = true;
        }
      }
    }
  }

  // Generate updates for all tasks
  for (const item of working) {
    updates.push({
      id: item.task.id,
      startHour: item.task.startHour,
      durationHours: item.task.durationHours
    });
  }

  return updates;
}

// ----------------------
// Main GanttChart Component
// ----------------------
// Renders the timeline, team rows, tasks, drag-and-drop logic, and import functionality.
export function GanttChart() {
  const { state, dispatch } = useApp();
  const [draggedTask, setDraggedTask] = useState<string | null>(null);
  const [dropZone, setDropZone] = useState<{ parentId: string } | null>(null);
  const [dragPosition, setDragPosition] = useState({ x: 0, y: 0 });
  const [snapTarget, setSnapTarget] = useState<{ parentId: string; taskId: string; side: 'left' | 'right' } | null>(null);
  const [, setSnapLeftPct] = useState<number | null>(null);
  const [, setDragOffsetOcc] = useState(0);
  const ganttRef = useRef<HTMLDivElement>(null);

  // Calculate periods, offsets, and total hours for the timeline
  const periods = state.periods?.length ? state.periods : PERIODS_FALLBACK;
  const defaultLen = PERIOD_LEN_FALLBACK;
  const periodLengthTable = (state as any).period_length as Array<{ period: string; length_hrs: number }> | undefined;
  const periodLengths = Array.isArray(periodLengthTable) && periodLengthTable.length
    ? periods.map((name) => {
        const entry = periodLengthTable.find((e) => e && e.period === name);
        const num = Number(entry?.length_hrs);
        return Number.isFinite(num) && num > 0 ? num : defaultLen;
      })
    : periods.map(() => defaultLen);
  let __acc = 0;
  const periodOffsets: number[] = periodLengths.map((len) => { const off = __acc; __acc += len; return off; });
  const totalHours = Math.max(1, periodLengths.reduce((a, b) => a + b, 0));
  state.totalHours = totalHours; // Store in global state for access elsewhere

  // Get all tasks for a given parent/team, sorted by start time
  const getTasksByParent = (parentId: string | null) => {
    return state.tasks
      .filter(task => task.parentId === parentId)
      .sort((a, b) => {
        const diff = occStart(a) - occStart(b);
        if (diff !== 0) return diff;

        // If they start equal, prioritize the currently dragged task
        if (a.id === draggedTask) return -1;
        if (b.id === draggedTask) return 1;

        return 0;
      });
  };

  // Calculate the left position and width of a task block in the timeline
  const calculateTaskPosition = (task: Task) => {
    const left = (Math.max(0, occStart(task)) / totalHours) * 100;
    const width = ((effectiveDuration(task)) / totalHours) * 100;
    return { left: `${left}%`, width: `${width}%` };
  };

  // Find which parent/team row the mouse is currently over
  const getParentFromMousePosition = (mouseY: number): string | null => {
    if (!ganttRef.current) return null;
    const parentRows = ganttRef.current.querySelectorAll('[data-parent-row]');
    for (let i = 0; i < parentRows.length; i++) {
      const rect = (parentRows[i] as HTMLElement).getBoundingClientRect();
      if (mouseY >= rect.top && mouseY <= rect.bottom) {
        const parentId = parentRows[i].getAttribute('data-parent-id');
        return parentId;
      }
    }
    return null;
  };

  // Snap detection: checks if the pointer is near the edge of any task for snapping
  const getSnapAt = (
    clientX: number,
    clientY: number,
    excludeTaskId: string
  ): { parentId: string; taskId: string; side: 'left' | 'right' } | null => {
    const parentId = getParentFromMousePosition(clientY);
    if (!parentId || !ganttRef.current) return null;

    const movingTask = state.tasks.find(x => x.id === excludeTaskId);
    if (movingTask && isDisallowed(movingTask as Task, parentId)) return null;

    const timelineContent = ganttRef.current.querySelector('.timeline-content') as HTMLElement | null;
    const rect = timelineContent?.getBoundingClientRect();
    if (!rect) return null;

    const zoneWidthPx = 16;
    const pointerX = clientX;

    const candidates = state.tasks.filter(t => t.parentId === parentId && t.id !== excludeTaskId);

    for (const t of candidates) {
      const leftEdgePct = (occStart(t) / totalHours) * 100;
      const rightEdgePct = (occEnd(t) / totalHours) * 100;
      const leftPx = rect.left + (leftEdgePct / 100) * rect.width;
      const rightPx = rect.left + (rightEdgePct / 100) * rect.width;

      const inLeftZone = pointerX >= leftPx - zoneWidthPx / 2 && pointerX <= leftPx + zoneWidthPx / 2;
      const inRightZone = pointerX >= rightPx - zoneWidthPx / 2 && pointerX <= rightPx + zoneWidthPx / 2;

      if (inLeftZone) {
        // Check if there is enough space before the target for snapping
        const moving = state.tasks.find(x => x.id === excludeTaskId);
        if (!moving) continue;
        const preds = state.tasks.filter(x => x.parentId === parentId && x.id !== t.id && x.id !== excludeTaskId && occEnd(x) <= occStart(t));
        const predecessor = preds.sort((a,b) => occEnd(b) - occEnd(a))[0];
        const earliestOccStart = predecessor ? occEnd(predecessor) : 0;
        const desiredStart = occStart(t) - effectiveDuration(moving, parentId);
        if ((desiredStart) >= earliestOccStart) return { parentId, taskId: t.id, side: 'left' };
      }
      if (inRightZone) {
        // Check if there is enough space after the target for snapping
        const moving = state.tasks.find(x => x.id === excludeTaskId);
        if (!moving) continue;
        const succs = state.tasks.filter(x => x.parentId === parentId && x.id !== t.id && x.id !== excludeTaskId && occStart(x) >= occEnd(t));
        const successor = succs.sort((a,b) => occStart(a) - occStart(b))[0];
        const desiredStart = occEnd(t);
        const desiredEnd = desiredStart + effectiveDuration(moving, parentId);
        const latestOccEnd = successor ? occStart(successor) : totalHours;
        if (desiredEnd <= latestOccEnd) return { parentId, taskId: t.id, side: 'right' };
      }
    }

    return null;
  };

  // Handles mouse down event for dragging a task block
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

    // Capture pointer offset within the task's occupied span (in hours) to preserve alignment on drop
    const timelineEl = ganttRef.current?.querySelector('.timeline-content') as HTMLElement | null;
    const rect0 = timelineEl?.getBoundingClientRect();
    if (rect0) {
      const pointerHour0 = Math.max(0, Math.min(totalHours, ((e.clientX - rect0.left) / rect0.width) * totalHours));
      const startOcc0 = occStart(originalTask);
      const endOcc0 = occEnd(originalTask);
      const clampedPointer0 = Math.max(startOcc0, Math.min(endOcc0, pointerHour0));
      setDragOffsetOcc(clampedPointer0 - startOcc0);
    } else {
      setDragOffsetOcc(0);
    }

    // Mouse move handler: updates drag position and snap targets
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
          const startPct = (occStart(t) / totalHours) * 100;
          const endPct = (occEnd(t) / totalHours) * 100; // occupied end
          const leftPx = rect.left + (startPct / 100) * rect.width;
          const rightPx = rect.left + (endPct / 100) * rect.width;

          const inLeftZone = pointerX >= leftPx - zoneWidthPx / 2 && pointerX <= leftPx + zoneWidthPx / 2;
          const inRightZone = pointerX >= rightPx - zoneWidthPx / 2 && pointerX <= rightPx + zoneWidthPx / 2;

          if (inLeftZone) {
            match = { taskId: t.id, side: 'left', pct: startPct };
            break;
          }
          if (inRightZone) {
            match = { taskId: t.id, side: 'right', pct: endPct };
            break;
          }
        }

        // Set snap target if a valid match is found
        if (match && draggedTask) {
          const target = state.tasks.find(t => t.id === match.taskId);
          const moving = state.tasks.find(t => t.id === draggedTask);
          if (target && moving) {
            if (match.side === 'left') {
              // Check predecessor for left snap
              const preds = state.tasks.filter(t => t.parentId === targetParentIdForSnap && t.id !== target.id && t.id !== draggedTask && occEnd(t) <= occStart(target));
              const predecessor = preds.sort((a,b) => occEnd(b) - occEnd(a))[0];
              const earliestOccStart = predecessor ? occEnd(predecessor) : 0;
              const desiredStart = occStart(target) - effectiveDuration(moving, targetParentIdForSnap);
              if ((desiredStart) >= earliestOccStart) {
                setSnapTarget({ parentId: targetParentIdForSnap, taskId: match.taskId, side: match.side });
                setSnapLeftPct(match.pct);
              }
            } else {
            // Check successor for right snap
              const succs = state.tasks.filter(t => t.parentId === targetParentIdForSnap && t.id !== target.id && t.id !== draggedTask && occStart(t) >= occEnd(target));
              const successor = succs.sort((a,b) => occStart(a) - occStart(b))[0];
              const desiredStart = occEnd(target);
              const desiredEnd = desiredStart + effectiveDuration(moving, targetParentIdForSnap);
              const latestOccEnd = successor ? occStart(successor) : totalHours;
              if (desiredEnd <= latestOccEnd) {
                setSnapTarget({ parentId: targetParentIdForSnap, taskId: match.taskId, side: match.side });
                setSnapLeftPct(match.pct);
              }
            }
          }
        }
      }

      // Highlight drop zone if dragging vertically to a new parent/team
      const targetParentId = getParentFromMousePosition(evt.clientY);
      if (targetParentId && targetParentId !== originalTask.parentId) {
        setDropZone({ parentId: targetParentId });
      } else {
        setDropZone(null);
      }
    };

    // Mouse up handler: handles drop logic, updates state, and cleans up
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
            const desiredStart = snapNow.side === 'left'
              ? occStart(target) - effectiveDuration(currentTask, snapNow.parentId)
              : occEnd(target);
            const desiredEnd = desiredStart + effectiveDuration(currentTask, snapNow.parentId);

            // Prevent drop in invalid period
            if (isInInvalidPeriod(currentTask, desiredStart, desiredEnd, periods, periodOffsets, periodLengths)) {
              alert('Cannot place task in an invalid period.');
              setDraggedTask(null);
              setDropZone(null);
              setDragPosition({ x: 0, y: 0 });
              setSnapTarget(null);
              setSnapLeftPct(null);
              setDragOffsetOcc(0);
              document.removeEventListener('mousemove', handleMouseMove);
              document.removeEventListener('mouseup', handleMouseUp);
              return;
            }

            if (snapNow.parentId === currentTask.parentId) {
              const siblings = state.tasks.filter(t => t.parentId === currentTask.parentId);
              const plan = planSequentialLayoutHours(
                siblings,
                currentTask.id,
                desiredStart,
                totalHours
              );
              for (const u of plan) {
                const orig = state.tasks.find(t => t.id === u.id);
                if (!orig) continue;
                if (orig.startHour !== u.startHour || orig.durationHours !== u.durationHours) {
                  dispatch({
                    type: 'UPDATE_TASK_HOURS',
                    taskId: u.id,
                    startHour: u.startHour,
                    durationHours: u.durationHours
                  });
                }
              }
              taskUpdated = true;
            } else {
              // Move to new parent and reflow with desiredStart
              dispatch({ type: 'UPDATE_TASK_PARENT', taskId, newParentId: snapNow.parentId });

              const newParentSiblings = state.tasks
                .filter(t => t.parentId === snapNow.parentId || t.id === taskId)
                .map(t => (t.id === taskId ? { ...t, parentId: snapNow.parentId } : t));

              const plan = planSequentialLayoutHours(
                newParentSiblings as Task[],
                taskId,
                desiredStart,
                totalHours
              );
              for (const u of plan) {
                const orig = state.tasks.find(t => t.id === u.id);
                if (!orig) continue;
                if (orig.startHour !== u.startHour || orig.durationHours !== u.durationHours) {
                  dispatch({
                    type: 'UPDATE_TASK_HOURS',
                    taskId: u.id,
                    startHour: u.startHour,
                    durationHours: u.durationHours
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
          // 2) Direct drop onto task body
          {
            const targetParentId = getParentFromMousePosition(evt.clientY);
            const timeline = ganttRef.current?.querySelector('.timeline-content') as HTMLElement | null;
            const rect = timeline?.getBoundingClientRect();
            if (rect && targetParentId) {
              const pointerX = evt.clientX;
              const siblings = state.tasks.filter(t => t.parentId === targetParentId && t.id !== currentTask.id);
              let bodyMatch: { taskId: string; side: 'left'|'right' } | null = null;
              for (const t of siblings) {
                const leftPx = rect.left + ((occStart(t) / totalHours) * rect.width);
                const rightPx = rect.left + ((occEnd(t) / totalHours) * rect.width);
                if (pointerX > leftPx && pointerX < rightPx) {
                  const side: 'left' | 'right' = pointerX <= (leftPx + rightPx) / 2 ? 'left' : 'right';
                  bodyMatch = { taskId: t.id, side };
                  break;
                }
              }
              if (bodyMatch) {
                const target = state.tasks.find(t => t.id === bodyMatch.taskId);
                if (target && currentTask) {
                  // Place moving at visual drop position
                  const hasHoriz = !!rect && Math.abs(finalOffset.x) > 5;
                  const hoursDelta = hasHoriz && rect ? (finalOffset.x / rect.width) * totalHours : 0;
                  const desiredStart = currentTask.startHour + (hoursDelta || 0);
                  const desiredEnd = desiredStart + effectiveDuration(currentTask);
                  
                  if (isInInvalidPeriod(currentTask, desiredStart, desiredEnd, periods, periodOffsets, periodLengths)) {
                    alert('Cannot place task in an invalid period.');
                    setDraggedTask(null);
                    setDropZone(null);
                    setDragPosition({ x: 0, y: 0 });
                    setSnapTarget(null);
                    setSnapLeftPct(null);
                    setDragOffsetOcc(0);
                    document.removeEventListener('mousemove', handleMouseMove);
                    document.removeEventListener('mouseup', handleMouseUp);
                    return;
                  }

                  // Compute target's new start to be on the chosen side of moved block
                  const targetNewStart =
                    bodyMatch.side === 'left'
                      ? (desiredStart + effectiveDuration(currentTask, targetParentId))
                      : (desiredStart - effectiveDuration(target, targetParentId));

                  if (targetParentId === currentTask.parentId) {
                    const sibs = state.tasks.filter(t => t.parentId === currentTask.parentId);
                    const sibsAdj = sibs.map(t => t.id === target.id ? { ...t, startHour: targetNewStart } : t);
                    const plan = planSequentialLayoutHours(
                      sibsAdj as Task[], 
                      currentTask.id, 
                      desiredStart, 
                      totalHours
                    );
                    for (const u of plan) {
                      const orig = state.tasks.find(t => t.id === u.id);
                      if (!orig) continue;
                      if (orig.startHour !== u.startHour || orig.durationHours !== u.durationHours) {
                        dispatch({ type: 'UPDATE_TASK_HOURS', taskId: u.id, startHour: u.startHour, durationHours: u.durationHours });
                      }
                    }
                    taskUpdated = true;
                  } else {
                    if (isInInvalidPeriod(currentTask, desiredStart, desiredEnd, periods, periodOffsets, periodLengths)) {
                      alert('Cannot place task in an invalid period.');
                      setDraggedTask(null);
                      setDropZone(null);
                      setDragPosition({ x: 0, y: 0 });
                      setSnapTarget(null);
                      setSnapLeftPct(null);
                      setDragOffsetOcc(0);
                      document.removeEventListener('mousemove', handleMouseMove);
                      document.removeEventListener('mouseup', handleMouseUp);
                      return;
                    }

                    if (isDisallowed(currentTask, targetParentId)) {
                      // skip disallowed assignment
                      taskUpdated = true;
                    } else {
                      dispatch({ type: 'UPDATE_TASK_PARENT', taskId, newParentId: targetParentId });
                      const newParentSibs = state.tasks
                        .filter(t => t.parentId === targetParentId || t.id === taskId)
                        .map(t => {
                          if (t.id === taskId) return { ...t, parentId: targetParentId };
                          if (t.id === target.id) return { ...t, startHour: targetNewStart };
                          return t;
                        });
                      const plan = planSequentialLayoutHours(newParentSibs as Task[], taskId, desiredStart, totalHours);
                      for (const u of plan) {
                        const orig = state.tasks.find(t => t.id === u.id);
                        if (!orig) continue;
                        if (orig.startHour !== u.startHour || orig.durationHours !== u.durationHours) {
                          dispatch({ type: 'UPDATE_TASK_HOURS', taskId: u.id, startHour: u.startHour, durationHours: u.durationHours });
                        }
                      }
                      taskUpdated = true;
                    }
                  }
                }
              }
            }
          }

          // 3) Snap to neighbor edges (deferred)
          if (snapTarget && !taskUpdated) {
            const target = state.tasks.find(t => t.id === snapTarget.taskId);
            if (isDisallowed(currentTask, snapTarget.parentId)) {
              // skip disallowed parent assignment
            } else if (target) {
              const desiredStart = snapTarget.side === 'left'
                ? occStart(target) - effectiveDuration(currentTask, snapTarget.parentId)
                : occEnd(target);

              if (snapTarget.parentId === currentTask.parentId) {
                const siblings = state.tasks.filter(t => t.parentId === currentTask.parentId);
                const plan = planSequentialLayoutHours(
                  siblings,
                  currentTask.id,
                  desiredStart,
                  totalHours
                );
                for (const u of plan) {
                  const orig = state.tasks.find(t => t.id === u.id);
                  if (!orig) continue;
                  if (orig.startHour !== u.startHour || orig.durationHours !== u.durationHours) {
                    dispatch({
                      type: 'UPDATE_TASK_HOURS',
                      taskId: u.id,
                      startHour: u.startHour,
                      durationHours: u.durationHours
                    });
                  }
                }
                taskUpdated = true;
              } else {
                // Move to new parent and reflow with desiredStart
                dispatch({ type: 'UPDATE_TASK_PARENT', taskId, newParentId: snapTarget.parentId });

                const newParentSiblings = state.tasks
                  .filter(t => t.parentId === snapTarget.parentId || t.id === taskId)
                  .map(t => (t.id === taskId ? { ...t, parentId: snapTarget.parentId } : t));

                const plan = planSequentialLayoutHours(
                  newParentSiblings as Task[],
                  taskId,
                  desiredStart,
                  totalHours
                );
                for (const u of plan) {
                  const orig = state.tasks.find(t => t.id === u.id);
                  if (!orig) continue;
                  if (orig.startHour !== u.startHour || orig.durationHours !== u.durationHours) {
                    dispatch({
                      type: 'UPDATE_TASK_HOURS',
                      taskId: u.id,
                      startHour: u.startHour,
                      durationHours: u.durationHours
                    });
                  }
                }
                taskUpdated = true;
              }
            }
          }

          // 3) Combined horizontal/vertical shift
          if (!taskUpdated) {
            const timelineContent = ganttRef.current?.querySelector('.timeline-content');
            const rect = timelineContent?.getBoundingClientRect();
            const hasHoriz = !!rect && Math.abs(finalOffset.x) > 5;
            const hoursDelta = hasHoriz && rect ? (finalOffset.x / rect.width) * totalHours : 0;
            const proposedStart = currentTask.startHour + (hoursDelta || 0);
            const proposedEnd = proposedStart + effectiveDuration(currentTask);

            const targetParentId = getParentFromMousePosition(evt.clientY);
            const isParentChange = !!targetParentId && targetParentId !== currentTask.parentId;

            // Prevent drop in invalid period for horizontal/vertical moves
            if (isInInvalidPeriod(currentTask, proposedStart, proposedEnd, periods, periodOffsets, periodLengths)) {
              alert('Cannot place task in an invalid period.');
              setDraggedTask(null);
              setDropZone(null);
              setDragPosition({ x: 0, y: 0 });
              setSnapTarget(null);
              setSnapLeftPct(null);
              setDragOffsetOcc(0);
              document.removeEventListener('mousemove', handleMouseMove);
              document.removeEventListener('mouseup', handleMouseUp);
              return;
            }

            if (isParentChange && targetParentId && !isDisallowed(currentTask, targetParentId)) {
              // Move to new parent and reflow at proposedStart
              dispatch({ type: 'UPDATE_TASK_PARENT', taskId, newParentId: targetParentId });

              const newParentSiblings = state.tasks
                .filter(t => t.parentId === targetParentId || t.id === taskId)
                .map(t => (t.id === taskId ? { ...t, parentId: targetParentId } : t));

              const plan = planSequentialLayoutHours(
                newParentSiblings as Task[],
                taskId,
                proposedStart,
                totalHours
              );

              for (const u of plan) {
                const orig = state.tasks.find(t => t.id === u.id);
                if (!orig) continue;
                if (orig.startHour !== u.startHour || orig.durationHours !== u.durationHours) {
                  dispatch({
                    type: 'UPDATE_TASK_HOURS',
                    taskId: u.id,
                    startHour: u.startHour,
                    durationHours: u.durationHours
                  });
                }
              }
              taskUpdated = true;
            } else if (hasHoriz && ganttRef.current) {
              // Horizontal only in same parent
              const siblings = state.tasks.filter(t => t.parentId === currentTask.parentId);

              const plan = planSequentialLayoutHours(
                siblings,
                currentTask.id,
                proposedStart,
                totalHours
              );

              for (const u of plan) {
                const orig = state.tasks.find(t => t.id === u.id);
                if (!orig) continue;
                if (orig.startHour !== u.startHour || orig.durationHours !== u.durationHours) {
                  dispatch({
                    type: 'UPDATE_TASK_HOURS',
                    taskId: u.id,
                    startHour: u.startHour,
                    durationHours: u.durationHours
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

      // Cleanup drag state and listeners
      setDraggedTask(null);
      setDropZone(null);
      setDragPosition({ x: 0, y: 0 });
      setSnapTarget(null);
      setSnapLeftPct(null);
      setDragOffsetOcc(0);

      document.removeEventListener('mousemove', handleMouseMove);
      document.removeEventListener('mouseup', handleMouseUp);
    };

    // Add global mouse event listeners for drag
    document.addEventListener('mousemove', handleMouseMove);
    document.addEventListener('mouseup', handleMouseUp);
  };

  // ----------------------
  // Render Gantt Chart UI
  // ----------------------
  return (
    <div ref={ganttRef} className="gantt-chart-container relative bg-white rounded-lg shadow-lg p-6 h-full overflow-hidden">
      {/* Header: Title and Import Button */}
      <div className="flex items-center gap-2 mb-4">
        <Calendar className="text-green-600" size={24}/>
        <h2 className="text-xl font-semibold text-gray-800">Task Timeline</h2>
        {/* Import tasks button */}
        <div className="ml-auto flex items-center gap-4">
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
                  const importedTasks = await importTasksFromFile(file, state.tasks.length); 
                  const { tasksToAdd, parentsToCreate, conflictedTasks } = processImportedTasks(
                    importedTasks,
                    state.tasks,
                    state.parents
                  );

                  dispatch({
                    type: 'IMPORT_TASKS_WITH_CONFLICTS',
                    tasks: tasksToAdd,
                    conflictedTasks: conflictedTasks,
                    newParents: parentsToCreate
                  });

                  const totalImported = tasksToAdd.length + conflictedTasks.length;
                  const newParentsCount = parentsToCreate.length;
                  const conflictsCount = conflictedTasks.length;

                  let message = `Successfully imported ${totalImported} tasks`;
                  if (newParentsCount > 0) message += `, created ${newParentsCount} new team${newParentsCount > 1 ? 's' : ''}`;
                  if (conflictsCount > 0) message += `, ${conflictsCount} task${conflictsCount > 1 ? 's' : ''} moved to unassigned due to conflicts}`;

                  alert(message);
                } catch (error) {
                  console.error('Import error:', error);
                  alert('Error importing tasks. Please check the file format.');
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
      
      {/* Instructions */}
      <div className="mb-4 text-xs text-gray-500 text-center">
        Drag tasks horizontally to adjust timing, vertically to change teams
      </div>

      <>
        <div className="flex h-full">
          {/* Left: Teams List */}
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
              {/* Timeline header: periods */}
              <div className="h-12 border-b border-gray-200 relative">
                {periods.map((p, idx) => (
                  <div
                    key={p}
                    className="absolute top-0 h-full flex items-center justify-center text-xs text-gray-600 border-r border-gray-100"
                    style={{
                      left: `${(periodOffsets[idx] / totalHours) * 100}%`,
                      width: `${(periodLengths[idx] / totalHours) * 100}%`
                    }}
                  >
                    {p}
                  </div>
                ))}
              </div>

              {/* Team rows and tasks */}
              {state.parents.map(parent => (
                <div
                  key={parent.id}
                  className={`h-16 border-b border-gray-100 relative transition-all ${
                    dropZone?.parentId === parent.id ? 'bg-blue-50' : ''
                  }`}
                  data-parent-row="true"
                  data-parent-id={parent.id}
                >
                  {/* Grid lines at period boundaries */}
                  {periods.map((p, idx) => (
                    <div
                      key={`${parent.id}-${p}`}
                      className="absolute top-0 bottom-0 border-r border-gray-50"
                      style={{ left: `${(((periodOffsets[idx] + periodLengths[idx]) / totalHours) * 100)}%` }}
                    />
                  ))}

                  {/* Invalid period overlays when task is selected or being dragged */}
                  {(state.selectedTaskId || draggedTask) && (() => {
                    const relevantTask = state.selectedTaskId
                    ? state.tasks.find(t => t.id === state.selectedTaskId)
                    : draggedTask
                      ? state.tasks.find(t => t.id === draggedTask)
                      : null;

                    if (!relevantTask?.invalidPeriods?.length) return null;

                    return relevantTask.invalidPeriods.map(invalidPeriod => {
                      const periodIdx = periods.indexOf(invalidPeriod);
                      if (periodIdx === -1) return null;

                      const startPct = (periodOffsets[periodIdx] / totalHours) * 100;
                      const widthPct = (periodLengths[periodIdx] / totalHours) * 100;

                      return (
                        <div
                          key={`${parent.id}-invalid-${invalidPeriod}`}
                          className="absolute top-0 bottom-0 pointer-events-none z-10"
                          style={{
                            left: `${startPct}%`,
                            width: `${widthPct}%`,
                            background: 'repeating-linear-gradient(45deg, rgba(239, 68, 68, 0.2) 0px, rgba(239, 68, 68, 0.2) 8px, rgba(239, 68, 68, 0.1) 8px, rgba(239, 68, 68, 0.1) 16px)',
                            border: '1px dashed rgba(239, 68, 68, 0.6)',
                            borderTop: 'none',
                            borderBottom: 'none'
                          }}
                        >
                        </div>
                      );
                    });
                  })()}

                  {/* Edge guides on all tasks (wider, animated, labeled) */}
                  {(draggedTask) && getTasksByParent(parent.id).map(t => {
                    if (t.id !== state.draggingTaskId_gantt) {
                      const startPct = (occStart(t) / totalHours) * 100;
                      const endPct = (occEnd(t) / totalHours) * 100;
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
                      )};
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
                      
                    const effDur = effectiveDuration(task);
                    const disallowed = isDisallowed(task);

                    return (
                      <div
                        key={task.id}
                        className={`absolute top-2 bottom-2 rounded px-2 py-1 text-xs font-medium cursor-move transition-all select-none 
                          ${isSelected ? 'ring-4 ring-yellow-400 ring-opacity-100 scale-105' : ''} 
                          ${isBeingDragged ? 'opacity-80 shadow-xl' : 'hover:shadow-md'}
                          text-white`}
                        style={{ backgroundColor: parent.color, ...position, ...dragStyle, overflow: 'hidden' } as CSSProperties }
                        onMouseDown={(e) => handleTaskMouseDown(e, task.id)}
                      >
                        {(task.setup ?? 0) > 0 && (
                          <div
                            className="absolute inset-y-0 left-0 pointer-events-none flex items-center justify-center"
                            title={`Setup: ${task.setup}h`}
                            style={{
                              width: `${((task.setup ?? 0) / effDur) * 100}%`,
                              backgroundImage: 'linear-gradient(45deg, rgba(255,255,255,0.35) 25%, transparent 25%), linear-gradient(-45deg, rgba(255,255,255,0.35) 25%, transparent 25%), linear-gradient(45deg, transparent 75%, rgba(255,255,255,0.35) 75%), linear-gradient(-45deg, transparent 75%, rgba(255,255,255,0.35) 75%)',
                              backgroundSize: '8px 8px',
                              backgroundPosition: '0 0, 0 4px, 4px -4px, -4px 0px',
                              borderRight: '1px dashed rgba(255,255,255,0.8)'
                            }}
                          >
                            <span className="text-[10px] font-semibold uppercase tracking-wide text-white/90 select-none">setup</span>
                          </div>
                        )}
                        <div
                          className="flex items-center justify-center h-full relative"
                          style={{
                            marginLeft: `${(((task.setup ?? 0) / effDur) * 100)}%`,
                            width: `${100 - (((task.setup ?? 0) / effDur) * 100)}%`
                          }}
                        >
                          <span className="truncate w-full text-center">{task.name}</span>
                        </div>
                        {disallowed && (
                          <div className="absolute inset-0 bg-red-600/30 flex items-center justify-center pointer-events-none">
                            <span className="text-white font-semibold text-xs drop-shadow">Not allowed</span>
                          </div>
                        )}
                      </div>
                    );
                  })}

                  {/* Visual drop hint */}
                  {dropZone?.parentId === parent.id && (() => {
                    const moving = draggedTask ? state.tasks.find(t => t.id === draggedTask) : null;
                    const dis = moving ? isDisallowed(moving as Task, parent.id) : false;
                    let invalidPeriod = false;
                    if (moving && !dis) {
                      // Predict drop position (use startHour or mouse position if available)
                      const predictedStart = moving.startHour;
                      const predictedEnd = predictedStart + effectiveDuration(moving, parent.id);
                      invalidPeriod = isInInvalidPeriod(moving, predictedStart, predictedEnd, periods, periodOffsets, periodLengths);
                    }
                    return (
                      <div className={`absolute inset-0 ${dis || invalidPeriod ? 'bg-red-200 bg-opacity-40 border-red-400' : 'bg-blue-200 bg-opacity-30 border-blue-400'} border-2 border-dashed rounded flex items-center justify-center pointer-events-none`}>
                        <span className={`${dis || invalidPeriod ? 'text-red-700' : 'text-blue-700'} font-medium text-sm`}>
                          {dis ? 'Not allowed in this team' : invalidPeriod ? 'Not allowed in this period' : 'Drop here to assign'}
                        </span>
                      </div>
                    );
                  })()}
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