import { useState, useRef } from 'react';
import type { CSSProperties } from 'react';
import { Calendar, Upload } from 'lucide-react';
import { useApp } from '../context/AppContext';
import { Task, Parent, Period } from '../types';
import { importProjectFromFile } from '../helper/fileReader'
import { getPeriodData } from '../helper/periodUtils';
import { effectiveDuration, isDisallowed, clamp, endHour } from '../helper/taskUtils';
import { isInValidPeriod } from '../helper/taskUtils';

// ----------------------
// Period Configuration
// ----------------------
// Default periods and their lengths used for fallback and initial state.
const PERIOD_FALLBACK: Period = {id: "P0", name: "n/a", length_hrs: 1};

// ----------------------
// Invalid Period Helpers
// ----------------------
// Checks if a task's scheduled time overlaps with any invalid period.
function isInInvalidPeriod(task: Task, startHour: number, endHour: number, periods: Period[], periodOffsets: number[]): boolean {
  if (!task.invalidPeriods || !task.invalidPeriods.length) return false;

  for (const invalidPeriod of task.invalidPeriods) {
    const idx = periods.findIndex(p => p.id === invalidPeriod)
    if (idx === -1) continue;
    const periodStart = periodOffsets[idx];
    const periodEnd = periodStart + periods[idx].length_hrs;
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
// Returns planned (startHour, defaultDuration) for each task so none overlap, after a move.
// Also returns tasks that should be unassigned (pushed beyond maxHour).
function planSequentialLayoutHours(
  siblings: Task[],
  movedTaskId: string,
  movedNewStartHour: number,
  maxHour: number
): { updates: Array<{ id: string; startHour: number; defaultDuration: number }>; unassign: string[] } {
  // Local copy of siblings
  const local = siblings.map(t => ({ ...t }));

  // Apply moved task's new start locally first (no snapping)
  const moved = local.find(t => t.id === movedTaskId);
  if (!moved) return { updates: [], unassign: [] };
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
  const updates: Array<{ id: string; startHour: number; defaultDuration: number }> = [];
  const unassign: string[] = [];
  
  // Create working array with current positions
  const working = orderedTasks.map(t => ({
    task: t,
    occStart: occStart(t),
    occEnd: occEnd(t),
    duration: effectiveDuration(t, t.parentId),
  }));

  // Resolve overlaps by pushing tasks to the right from the insertion point
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

        // Check if this would push the task beyond the boundary
        if (newStart + curr.duration > maxHour) {
          // Mark for unassignment
          unassign.push(curr.task.id);
          // Remove from working array to prevent further processing
          working.splice(i, 1);
          i--; // Adjust index after removal
          changed = true;
          continue;
        }

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

  // Generate updates for all tasks that weren't unassigned
  for (const item of working) {
    updates.push({
      id: item.task.id,
      startHour: item.task.startHour,
      defaultDuration: item.task.defaultDuration
    });
  }

  return { updates, unassign };
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
  const periods = state.periods?.length ? state.periods : [PERIOD_FALLBACK];
  const { periodOffsets, totalHours } = getPeriodData(periods, PERIOD_FALLBACK.length_hrs);
  
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
    dispatch({ type: 'SET_DRAGGING_FROM_GANTT', taskId: taskId });

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
      function cancelDrag() {
        setDraggedTask(null);
        setDropZone(null);
        setDragPosition({ x: 0, y: 0 });
        setSnapTarget(null);
        setSnapLeftPct(null);
        setDragOffsetOcc(0);

        document.removeEventListener('mousemove', handleMouseMove);
        document.removeEventListener('mouseup', handleMouseUp);
      }

      const finalOffset = { x: evt.clientX - offset.x, y: evt.clientY - offset.y };
      dispatch({ type: 'SET_DRAGGING_FROM_GANTT', taskId: null });

      // Snapshot current task (don’t trust stale closure vars)
      const currentTask = state.tasks.find(t => t.id === taskId);
      if (!currentTask) return;

      let taskUpdated = false;
      const moveDistance = Math.sqrt(finalOffset.x ** 2 + finalOffset.y ** 2);

      if (moveDistance > 5) {
        // 1) Snap to neighbor edges (priority at drop)
        const snapNow = getSnapAt(evt.clientX, evt.clientY, taskId);
        if (snapNow) {
          console.log("Attempting to snap to neighbour edges");
          const target = state.tasks.find(t => t.id === snapNow.taskId);
          if (target) {
            const desiredStart = snapNow.side === 'left'
              ? occStart(target) - effectiveDuration(currentTask, snapNow.parentId)
              : occEnd(target);
            const desiredEnd = desiredStart + effectiveDuration(currentTask, snapNow.parentId);

            // Prevent drop in invalid period
            if (isInInvalidPeriod(currentTask, desiredStart, desiredEnd, periods, periodOffsets)) {
              cancelDrag();
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
              for (const u of plan['updates']) {
                const orig = state.tasks.find(t => t.id === u.id);
                if (!orig) continue;
                if (orig.startHour !== u.startHour || orig.defaultDuration !== u.defaultDuration) {
                  dispatch({
                    type: 'UPDATE_TASK_HOURS',
                    taskId: u.id,
                    startHour: u.startHour,
                    defaultDuration: u.defaultDuration
                  });
                  console.log("Success");
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
              for (const u of plan['updates']) {
                const orig = state.tasks.find(t => t.id === u.id);
                if (!orig) continue;
                if (orig.startHour !== u.startHour || orig.defaultDuration !== u.defaultDuration) {
                  dispatch({
                    type: 'UPDATE_TASK_HOURS',
                    taskId: u.id,
                    startHour: u.startHour,
                    defaultDuration: u.defaultDuration
                  });
                  console.log("Success");
                }
              }
              taskUpdated = true;
            }
          }
        }

        // 2) Unassign the task
        if (!taskUpdated) {
          const unassignedMenu = document.querySelector('.unassigned-tasks-container');
          const worldmap = document.querySelector('.world-map-container');
          
          if (unassignedMenu) {
            console.log("Attempting to move task to unassignedMenu");
            const r = unassignedMenu.getBoundingClientRect();
            if (evt.clientX >= r.left && evt.clientX <= r.right && evt.clientY >= r.top && evt.clientY <= r.bottom) {
              console.log("Success")
              dispatch({ type: 'UPDATE_TASK_PARENT', taskId, newParentId: null });
              taskUpdated = true;
            } 
          }

          if (!taskUpdated && worldmap) {
            console.log("Attempting to move task to worldmap");
            const r = worldmap.getBoundingClientRect();
            if (evt.clientX >= r.left && evt.clientX <= r.right && evt.clientY >= r.top && evt.clientY <= r.bottom) {
              console.log("Success")
              dispatch({ type: 'UPDATE_TASK_PARENT', taskId, newParentId: null });
              taskUpdated = true;
            } 
          }
        }

        if (!taskUpdated) {
          // 3) Direct drop onto task body
          {
            console.log("Attempting to drop task onto other task body");
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
                  
                  if (isInInvalidPeriod(currentTask, desiredStart, desiredEnd, periods, periodOffsets)) {
                    cancelDrag();
                    return;
                  }

                  // Compute target's new start to be on the chosen side of moved block
                  const targetNewStart =
                    bodyMatch.side === 'left'
                      ? (desiredStart + effectiveDuration(currentTask, targetParentId)) // move after
                      : target.startHour; // stay
                  
                  const currentNewStart = 
                    bodyMatch.side === 'left'
                      ? desiredStart // stay
                      : target.startHour + effectiveDuration(target, targetParentId); // move after

                  if (targetParentId === currentTask.parentId) {
                    const sibs = state.tasks.filter(t => t.parentId === currentTask.parentId);
                    const sibsAdj = sibs.map(t => t.id === target.id ? { ...t, startHour: targetNewStart } : t);
                    const plan = planSequentialLayoutHours(
                      sibsAdj as Task[], 
                      currentTask.id, 
                      currentNewStart, 
                      totalHours
                    );
                    for (const u of plan['updates']) {
                      const orig = state.tasks.find(t => t.id === u.id);
                      if (!orig) continue;
                      if (orig.startHour !== u.startHour || orig.defaultDuration !== u.defaultDuration) {
                        dispatch({ 
                          type: 'UPDATE_TASK_HOURS', 
                          taskId: u.id, 
                          startHour: u.startHour, 
                          defaultDuration: u.defaultDuration 
                        });
                        console.log("Success");
                      }
                    }
                    taskUpdated = true;
                  } else {
                    if (isInInvalidPeriod(currentTask, desiredStart, desiredEnd, periods, periodOffsets)) {
                      cancelDrag();
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
                      for (const u of plan['updates']) {
                        const orig = state.tasks.find(t => t.id === u.id);
                        if (!orig) continue;
                        if (orig.startHour !== u.startHour || orig.defaultDuration !== u.defaultDuration) {
                          dispatch({ 
                            type: 'UPDATE_TASK_HOURS', 
                            taskId: u.id,
                            startHour: u.startHour, 
                            defaultDuration: u.defaultDuration 
                          });
                          console.log("Success");
                        }
                      }
                      taskUpdated = true;
                    }
                  }
                }
              }
            }
          }

          // 4) Snap to neighbor edges (deferred)
          if (snapTarget && !taskUpdated) {
            console.log("Attempting deffered snap to neightbor edges");
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
                for (const u of plan['updates']) {
                  const orig = state.tasks.find(t => t.id === u.id);
                  if (!orig) continue;
                  if (orig.startHour !== u.startHour || orig.defaultDuration !== u.defaultDuration) {
                    dispatch({
                      type: 'UPDATE_TASK_HOURS',
                      taskId: u.id,
                      startHour: u.startHour,
                      defaultDuration: u.defaultDuration
                    });
                    console.log("Success");
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
                for (const u of plan['updates']) {
                  const orig = state.tasks.find(t => t.id === u.id);
                  if (!orig) continue;
                  if (orig.startHour !== u.startHour || orig.defaultDuration !== u.defaultDuration) {
                    dispatch({
                      type: 'UPDATE_TASK_HOURS',
                      taskId: u.id,
                      startHour: u.startHour,
                      defaultDuration: u.defaultDuration
                    });
                    console.log("Success");
                  }
                }
                taskUpdated = true;
              }
            }
          }

          // 5) Combined horizontal/vertical shift
          if (!taskUpdated) {
            console.log("Attempting to combine horizontal and vertical shift");
            const timelineContent = ganttRef.current?.querySelector('.timeline-content');
            const rect = timelineContent?.getBoundingClientRect();
            const hasHoriz = !!rect && Math.abs(finalOffset.x) > 5;
            const hoursDelta = hasHoriz && rect ? (finalOffset.x / rect.width) * totalHours : 0;
            const proposedStart = currentTask.startHour + (hoursDelta || 0); // Calculates start hour
            const proposedEnd = proposedStart + effectiveDuration(currentTask);

            const targetParentId = getParentFromMousePosition(evt.clientY);
            const isParentChange = !!targetParentId && targetParentId !== currentTask.parentId;

            // Prevent drop in invalid period for horizontal/vertical moves
            if (isInInvalidPeriod(currentTask, proposedStart, proposedEnd, periods, periodOffsets)) {
              console.log("Invalid Period");
              cancelDrag();
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

              for (const u of plan['updates']) {
                const orig = state.tasks.find(t => t.id === u.id);
                if (!orig) continue;
                if (orig.startHour !== u.startHour || orig.defaultDuration !== u.defaultDuration) {
                  dispatch({
                    type: 'UPDATE_TASK_HOURS',
                    taskId: u.id,
                    startHour: u.startHour,
                    defaultDuration: u.defaultDuration
                  });
                }
              }

              for (const id of plan['unassign']) {
                dispatch({
                  type: 'UPDATE_TASK_PARENT',
                  taskId: id,
                  newParentId: null
                });
              }
              console.log("Success");
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

              for (const u of plan['updates']) {
                const orig = state.tasks.find(t => t.id === u.id);
                if (!orig) continue;
                if (orig.startHour !== u.startHour || orig.defaultDuration !== u.defaultDuration) {
                  dispatch({
                    type: 'UPDATE_TASK_HOURS',
                    taskId: u.id,
                    startHour: u.startHour,
                    defaultDuration: u.defaultDuration
                  });
                }
              }

              for (const id of plan['unassign']) {
                dispatch({
                  type: 'UPDATE_TASK_PARENT',
                  taskId: id,
                  newParentId: null
                });
              }
              console.log("Success");
              taskUpdated = true;
            }
          }
        }
      } else {
        // Click (no real drag)
        dispatch({ type: 'SET_SELECTED_TASK', taskId, toggle_parent: 'any' });
      }

      // Cleanup drag state and listeners
      cancelDrag();
    };

    // Add global mouse event listeners for drag
    document.addEventListener('mousemove', handleMouseMove);
    document.addEventListener('mouseup', handleMouseUp);
  };

  // Handler for importing everything from one file
  const handleImportProject = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const result = await importProjectFromFile(file);
    if (!result) return;

    // Import periods
    let _totalHours: number = 0
    let _formattedPeriods: Period[] | null = null;
    if (result.periods && Array.isArray(result.periods)) {
      const formattedPeriods = result.periods.map((p: any) => {
        // Get length from period_lengths
        const periodLength = result.period_lengths?.find((pl: any) => pl.id === p.id);
        const lengthHrs = periodLength?.length_hrs ?? PERIOD_FALLBACK.length_hrs;
        console.log(`id ${p.id} length ${lengthHrs}`)

        _totalHours += lengthHrs;

        return {
          id: p.id,
          name: p.name,
          length_hrs: lengthHrs
        };
      });

      dispatch({
        type: 'SET_PERIODS',
        periods: formattedPeriods
      });
      _formattedPeriods = formattedPeriods;
      console.log("Imported Periods: ", formattedPeriods);
      console.log("Total hours: ", _totalHours);
    } 

    if (_formattedPeriods === null) {
      // Fallback if no periods exist
      _formattedPeriods = [PERIOD_FALLBACK];
      _totalHours = _formattedPeriods[0].length_hrs;
      dispatch({
        type: 'SET_PERIODS',
        periods: [PERIOD_FALLBACK]
      });
    }

    dispatch({
      type: 'SET_TOTAL_HOURS',
      totalHours: _totalHours
    });

    // Import parents with dynamic IDs
    let formattedParents: Parent[] = []
    if (result.parents && Array.isArray(result.parents)) {
      const existingParentCount = state.parents.length;
      formattedParents = result.parents.map((p: any, idx: number) => {
        const index = existingParentCount + idx + 1;

        const id = index < 10 ? `R0${index}` : `R${index}`;
        const name = p.name || p['Name'] || id;
        const color = p.color || p['Color'] || '#888';

        const importedParents: Parent = {
          id,
          name,
          color
        }

        return { ...importedParents }
      });
      dispatch({ type: 'ADD_PARENTS', parents: formattedParents });
      console.log("Imported Parents: ", formattedParents);
    }

    // Import tasks with dynamic IDs and overlay resolution
    if (result.tasks && Array.isArray(result.tasks)) {
      const existingTaskCount = state.tasks.length;
      const formattedTasks = result.tasks.map((t: any, idx: number) => { 
        const id = `T${existingTaskCount + idx + 1}`;
        const name = t.name || t['Name'] || id;
        const parentId = t.parentId || t['Parent ID'] || null;
        const startHour = t.startHour ?? t['Start Hour'] ?? 0;
        const defaultDuration = t.defaultDuration ?? t['Default Duration (hrs)'] ?? 40;
        const defaultSetup = t.defaultSetup ?? t['Default Setup (hrs)'] ?? 0;
        const specialTeams = t.specialTeams || t['Special Teams'] || {};
        const location = t.location || t['Location'] || { lat: 0, lon: 0 };
        const invalidPeriods = t.invalidPeriods || t['Invalid Periods'] || [];

        // Calculate effective duration for the imported task
        const importedTask: Task = {
          id,
          name,
          parentId,
          startHour,
          defaultDuration,
          defaultSetup,
          location,
          specialTeams,
          invalidPeriods
        };

        return {
          ...importedTask
        };
      });

      dispatch({ type: 'ADD_TASKS', tasks: formattedTasks });
      console.log("Imported Tasks: ", formattedTasks);

      // Resolve overlaps
      const totalTasks: Task[] = [ ...state.tasks, ...formattedTasks ];
      const totalParents: Parent[] = [ ...state.parents, ...formattedParents ]; 

      console.log("Resolving overlaps");

      for (const p of totalParents) {
        const parentSiblings = totalTasks
          .filter(t => t.parentId === p.id)
          .sort((a, b) => occStart(a) - occStart(b));

        for (let i = 1; i < parentSiblings.length; i++) {
          const prev = parentSiblings[i - 1];
          const curr = parentSiblings[i];

          console.log(`Prev: [${prev.startHour}->${endHour(prev)}]`);
          console.log(`Curr: [${curr.startHour}->${endHour(curr)}]`);

          // If the current start before prev ends -> overlap
          if (curr.startHour < endHour(prev)) {
            let newStart = endHour(prev);
            console.log(`Overlap detected. Initial newStart: ${newStart}`);

            // Check if newStart is in a valid period for curr
            while (newStart + effectiveDuration(curr) <= _totalHours) {
              if (isInValidPeriod(curr, newStart, effectiveDuration(curr), _formattedPeriods)) {
                // Found a valid position
                break;
              }

              // Find the next period boundary after an invalid period
              let cumulativeHour = 0;
              let foundNextValid = false;

              for (const { id, length_hrs } of _formattedPeriods) {
                const periodEnd = cumulativeHour + length_hrs;

                // If newStart is in or before this invalid period, try the next period
                if (curr.invalidPeriods?.includes(id) && newStart < periodEnd) {
                  newStart = periodEnd; // Move to start of next period
                  foundNextValid = true;
                  break;
                }

                cumulativeHour += length_hrs;
              }

              if (!foundNextValid) {
                // Couldnt find a valid period
                break;
              }
            }

            // If the end is out of range or couldnt find valid period
            if (newStart + effectiveDuration(curr) > _totalHours || 
                !isInValidPeriod(curr, newStart, effectiveDuration(curr), _formattedPeriods)) {
              console.log(`${newStart} is out of range or in invalid period for ${_totalHours}`);
              dispatch({
                type: 'UPDATE_TASK_PARENT',
                taskId: curr.id,
                newParentId: null
              });

              // Remove from local array 
              parentSiblings.splice(i, 1);
              i--; 
            } 
            else {
              console.log(`Moving curr to ${newStart}`);
              dispatch({
                type: 'UPDATE_TASK_HOURS',
                taskId: curr.id,
                startHour: newStart,
                defaultDuration: curr.defaultDuration
              });

              // Update local object
              curr.startHour = newStart;
            }
          }
        }
      }
    }
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
          <label className="flex items-center gap-2 px-3 py-1 rounded text-xs font-medium bg-green-600 text-white hover:bg-green-700">
            <Upload size={18} /> Import
            <input
              type="file"
              accept=".json"
              style={{ display: 'none' }}
              onChange={handleImportProject}
            />
          </label>
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
            <div className={`h-10 flex items-center font-medium text-gray-700 border-b border-gray-200`}>
              Teams
            </div>
            {state.parents.map(parent => (
              <div
                key={parent.id} 
                className={`h-12 flex items-center border-b border-gray-100 px-2 transition-all ${
                  dropZone?.parentId === parent.id ? 'bg-blue-50 border-blue-300 border-l-4 border-l-blue-500' : ''
                }`}
                data-parent-row="true"
                data-parent-id={parent.id}
                onClick={() => dispatch({ type: 'SET_SELECTED_PARENT', parentId: parent.id })}
              >
                <div className="flex items-center gap-2">
                  <div className="w-3 h-6 rounded-full" style={{ backgroundColor: parent.color }} />
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
              <div className="h-10 border-b border-gray-200 relative">
                {periods.map((p, idx) => (
                  <div
                    key={p.id}
                    className="absolute top-0 h-full flex items-center justify-center text-xs text-gray-600 border-r border-gray-100"
                    style={{
                      left: `${(periodOffsets[idx] / totalHours) * 100}%`,
                      width: `${(periods[idx].length_hrs / totalHours) * 100}%`
                    }}
                  >
                    {p.name}
                  </div>
                ))}
              </div>

              {/* Team rows and tasks */}
              {state.parents.map(parent => (
                <div
                  key={parent.id} // height
                  className={`h-12 border-b border-gray-100 relative transition-all ${
                    dropZone?.parentId === parent.id ? 'bg-blue-50' : ''
                  }`}
                  data-parent-row="true"
                  data-parent-id={parent.id}
                >
                  {/* Grid lines at period boundaries */}
                  {periods.map((p, idx) => (
                    <div
                      key={`${parent.id}-grid-${p.id}`}
                      className="absolute top-0 bottom-0 border-r border-gray-50"
                      style={{ left: `${(((periodOffsets[idx] + periods[idx].length_hrs) / totalHours) * 100)}%` }}
                    />
                  ))}

                  {/* Invalid period overlays when task is selected or being dragged */}
                  {(state.dragging_to_gantt || state.selectedTaskId || draggedTask) && (() => {
                    const relevantTask = state.dragging_to_gantt
                    ? state.tasks.find(t => t.id === state.dragging_to_gantt)
                    : state.selectedTaskId
                      ? state.tasks.find(t => t.id === state.selectedTaskId)
                      : draggedTask
                        ? state.tasks.find(t => t.id === draggedTask)
                        : null

                    if (!relevantTask?.invalidPeriods?.length) return null;

                    return relevantTask.invalidPeriods.map(invalidPeriod => {
                      const periodIdx = periods.findIndex(p => p.id === invalidPeriod);
                      if (periodIdx === -1) return null;

                      const startPct = (periodOffsets[periodIdx] / totalHours) * 100;
                      const widthPct = (periods[periodIdx].length_hrs / totalHours) * 100;

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
                    if (t.id !== state.dragging_from_gantt) {
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
                        {(task.defaultSetup ?? 0) > 0 && (
                          <div
                            className="absolute inset-y-0 left-0 pointer-events-none flex items-center justify-center"
                            title={`Setup: ${task.defaultSetup}h`}
                            style={{
                              width: `${((task.defaultSetup ?? 0) / effDur) * 100}%`,
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
                            marginLeft: `${(((task.defaultSetup ?? 0) / effDur) * 100)}%`,
                            width: `${100 - (((task.defaultSetup ?? 0) / effDur) * 100)}%`
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
                      invalidPeriod = isInInvalidPeriod(moving, predictedStart, predictedEnd, periods, periodOffsets);
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
              {state.toggledDrop && (
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