import { useState, useRef } from 'react';
import type { CSSProperties } from 'react';
import { Calendar, Upload } from 'lucide-react';
import { useApp } from '../context/AppContext';
import { Task, Team, Period } from '../types';
import { importDataFromFile, importSolutionFromFile } from '../helper/fileReader'
import { getPeriodData } from '../helper/periodUtils';
import { effectiveDuration, isDisallowed, clamp, endHour } from '../helper/taskUtils';
import { isInValidPeriod } from '../helper/taskUtils';

// ----------------------
// Period Configuration
// ----------------------
// Default periods and their lengths used for fallback and initial state.
const PERIOD_FALLBACK: Period = {id: "P0", name: "n/a", length_h: 1};

// ----------------------
// Invalid Period Helpers
// ----------------------
// Checks if a task's scheduled time overlaps with any invalid period.
function isInInvalidPeriod(task: Task, startHour: number, endHour: number, periods: Period[], periodOffsets: number[]): boolean {
  if (!task.duration.invalidPeriods || !task.duration.invalidPeriods.length) return false;

  for (const invalidPeriod of task.duration.invalidPeriods) {
    const idx = periods.findIndex(p => p.id === invalidPeriod)
    if (idx === -1) continue;
    const periodStart = periodOffsets[idx];
    const periodEnd = periodStart + periods[idx].length_h;
    // If any overlap
    if (startHour < periodEnd && endHour > periodStart) return true;
  }
  return false;
}

// ----------------------
// Task Color Mapping
// ----------------------
// Returns a color based on the task's avvForm value
function getTaskColor(avvForm: string, teamColor: string): string {
  const colorMap: Record<string, string> = {
    'GA': '#ef4444', // red-500
    'SA': '#f59e0b', // amber-500
    'n/a': teamColor, // fallback to team color
  };
  
  return colorMap[avvForm] || teamColor;
}

const occStart = (t: Task) => t.duration.startHour;
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
  const moved = local.find(t => t.task.id === movedTaskId);
  if (!moved) return { updates: [], unassign: [] };
  const movedDur = effectiveDuration(moved, moved.duration.teamId);
  moved.duration.startHour = clamp(movedNewStartHour, 0, Math.max(0, maxHour - movedDur));

  // Sort other tasks by their current occupied start positions
  const others = local.filter(t => t.task.id !== movedTaskId)
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
    duration: effectiveDuration(t, t.duration.teamId),
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
          unassign.push(curr.task.task.id);
          // Remove from working array to prevent further processing
          working.splice(i, 1);
          i--; // Adjust index after removal
          changed = true;
          continue;
        }

        const clampedStart = clamp(newStart, 0, Math.max(0, maxHour - curr.duration));
        
        if (clampedStart !== curr.task.duration.startHour) {
          curr.task.duration.startHour = clampedStart;
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
      id: item.task.task.id,
      startHour: item.task.duration.startHour,
      defaultDuration: item.task.duration.defaultDuration
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
  const [dropZone, setDropZone] = useState<{ teamId: string } | null>(null);
  const [dragPosition, setDragPosition] = useState({ x: 0, y: 0 });
  const [snapTarget, setSnapTarget] = useState<{ teamId: string; taskId: string; side: 'left' | 'right' } | null>(null);
  const [, setSnapLeftPct] = useState<number | null>(null);
  const [, setDragOffsetOcc] = useState(0);
  const ganttRef = useRef<HTMLDivElement>(null);

  // Calculate periods, offsets, and total hours for the timeline
  const periods = state.periods?.length ? state.periods : [PERIOD_FALLBACK];
  const { periodOffsets, totalHours } = getPeriodData(periods, PERIOD_FALLBACK.length_h);
  
  // Get all tasks for a given team/team, sorted by start time
  const getTasksByTeam = (teamId: string | null) => {
    return state.tasks
      .filter(task => task.duration.teamId === teamId)
      .sort((a, b) => {
        const diff = occStart(a) - occStart(b);
        if (diff !== 0) return diff;

        // If they start equal, prioritize the currently dragged task
        if (a.task.id === draggedTask) return -1;
        if (b.task.id === draggedTask) return 1;

        return 0;
      });
  };

  // Calculate the left position and width of a task block in the timeline
  const calculateTaskPosition = (task: Task) => {
    const left = (Math.max(0, occStart(task)) / totalHours) * 100;
    const width = ((effectiveDuration(task, task.duration.teamId)) / totalHours) * 100;
    return { left: `${left}%`, width: `${width}%` };
  };

  // Find which team/team row the mouse is currently over
  const getTeamFromMousePosition = (mouseY: number): string | null => {
    if (!ganttRef.current) return null;
    const teamRows = ganttRef.current.querySelectorAll('[data-team-row]');
    for (let i = 0; i < teamRows.length; i++) {
      const rect = (teamRows[i] as HTMLElement).getBoundingClientRect();
      if (mouseY >= rect.top && mouseY <= rect.bottom) {
        const teamId = teamRows[i].getAttribute('data-team-id');
        return teamId;
      }
    }
    return null;
  };

  // Snap detection: checks if the pointer is near the edge of any task for snapping
  const getSnapAt = (
    clientX: number,
    clientY: number,
    excludeTaskId: string
  ): { teamId: string; taskId: string; side: 'left' | 'right' } | null => {
    const teamId = getTeamFromMousePosition(clientY);
    if (!teamId || !ganttRef.current) return null;

    const movingTask = state.tasks.find(x => x.task.id === excludeTaskId);
    if (movingTask && isDisallowed(movingTask as Task, teamId)) return null;

    const timelineContent = ganttRef.current.querySelector('.timeline-content') as HTMLElement | null;
    const rect = timelineContent?.getBoundingClientRect();
    if (!rect) return null;

    const zoneWidthPx = 8;
    const pointerX = clientX;

    const candidates = state.tasks.filter(t => t.duration.teamId === teamId && t.task.id !== excludeTaskId);

    for (const t of candidates) {
      const leftEdgePct = (occStart(t) / totalHours) * 100;
      const rightEdgePct = (occEnd(t) / totalHours) * 100;
      const leftPx = rect.left + (leftEdgePct / 100) * rect.width;
      const rightPx = rect.left + (rightEdgePct / 100) * rect.width;

      const inLeftZone = pointerX >= leftPx - zoneWidthPx / 2 && pointerX <= leftPx + zoneWidthPx / 2;
      const inRightZone = pointerX >= rightPx - zoneWidthPx / 2 && pointerX <= rightPx + zoneWidthPx / 2;

      if (inLeftZone) {
        // Check if there is enough space before the target for snapping
        const moving = state.tasks.find(x => x.task.id === excludeTaskId);
        if (!moving) continue;
        const preds = state.tasks.filter(x => x.duration.teamId === teamId && x.task.id !== t.task.id && x.task.id !== excludeTaskId && occEnd(x) <= occStart(t));
        const predecessor = preds.sort((a,b) => occEnd(b) - occEnd(a))[0];
        const earliestOccStart = predecessor ? occEnd(predecessor) : 0;
        const desiredStart = occStart(t) - effectiveDuration(moving, teamId);
        if ((desiredStart) >= earliestOccStart) return { teamId, taskId: t.task.id, side: 'left' };
      }
      if (inRightZone) {
        // Check if there is enough space after the target for snapping
        const moving = state.tasks.find(x => x.task.id === excludeTaskId);
        if (!moving) continue;
        const succs = state.tasks.filter(x => x.duration.teamId === teamId && x.task.id !== t.task.id && x.task.id !== excludeTaskId && occStart(x) >= occEnd(t));
        const successor = succs.sort((a,b) => occStart(a) - occStart(b))[0];
        const desiredStart = occEnd(t);
        const desiredEnd = desiredStart + effectiveDuration(moving, teamId);
        const latestOccEnd = successor ? occStart(successor) : totalHours;
        if (desiredEnd <= latestOccEnd) return { teamId, taskId: t.task.id, side: 'right' };
      }
    }

    return null;
  };

  // Handles mouse down event for dragging a task block
  const handleTaskMouseDown = (e: React.MouseEvent, taskId: string) => {
    e.preventDefault();
    e.stopPropagation();
    dispatch({ type: 'SET_SELECTED_TASK', taskId: null, toggle_team: state.selectedTeamId });

    const originalTask = state.tasks.find(t => t.task.id === taskId);
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
      const targetTeamIdForSnap = getTeamFromMousePosition(evt.clientY);
      const timelineContent = ganttRef.current?.querySelector('.timeline-content') as HTMLElement | null;
      const rect = timelineContent?.getBoundingClientRect();
      if (rect && targetTeamIdForSnap) {
        const pointerX = evt.clientX;
        const candidates = state.tasks.filter(t => t.duration.teamId === targetTeamIdForSnap && t.task.id !== (draggedTask ?? ''));
        const zoneWidthPx = 8; // visual snap zone width
        let match: { taskId: string; side: 'left'|'right'; pct: number } | null = null;

        for (const t of candidates) {
          const startPct = (occStart(t) / totalHours) * 100;
          const endPct = (occEnd(t) / totalHours) * 100; // occupied end
          const leftPx = rect.left + (startPct / 100) * rect.width;
          const rightPx = rect.left + (endPct / 100) * rect.width;

          const inLeftZone = pointerX >= leftPx - zoneWidthPx / 2 && pointerX <= leftPx + zoneWidthPx / 2;
          const inRightZone = pointerX >= rightPx - zoneWidthPx / 2 && pointerX <= rightPx + zoneWidthPx / 2;

          if (inLeftZone) {
            match = { taskId: t.task.id, side: 'left', pct: startPct };
            break;
          }
          if (inRightZone) {
            match = { taskId: t.task.id, side: 'right', pct: endPct };
            break;
          }
        }

        // Set snap target if a valid match is found
        if (match && draggedTask) {
          const target = state.tasks.find(t => t.task.id === match.taskId);
          const moving = state.tasks.find(t => t.task.id === draggedTask);
          if (target && moving) {
            if (match.side === 'left') {
              // Check predecessor for left snap
              const preds = state.tasks.filter(t => t.duration.teamId === targetTeamIdForSnap && t.task.id !== target.task.id && t.task.id !== draggedTask && occEnd(t) <= occStart(target));
              const predecessor = preds.sort((a,b) => occEnd(b) - occEnd(a))[0];
              const earliestOccStart = predecessor ? occEnd(predecessor) : 0;
              const desiredStart = occStart(target) - effectiveDuration(moving, targetTeamIdForSnap);
              if ((desiredStart) >= earliestOccStart) {
                setSnapTarget({ teamId: targetTeamIdForSnap, taskId: match.taskId, side: match.side });
                setSnapLeftPct(match.pct);
              }
            } else {
            // Check successor for right snap
              const succs = state.tasks.filter(t => t.duration.teamId === targetTeamIdForSnap && t.task.id !== target.task.id && t.task.id !== draggedTask && occStart(t) >= occEnd(target));
              const successor = succs.sort((a,b) => occStart(a) - occStart(b))[0];
              const desiredStart = occEnd(target);
              const desiredEnd = desiredStart + effectiveDuration(moving, targetTeamIdForSnap);
              const latestOccEnd = successor ? occStart(successor) : totalHours;
              if (desiredEnd <= latestOccEnd) {
                setSnapTarget({ teamId: targetTeamIdForSnap, taskId: match.taskId, side: match.side });
                setSnapLeftPct(match.pct);
              }
            }
          }
        }
      }

      // Highlight drop zone if dragging vertically to a new team/team
      const targetTeamId = getTeamFromMousePosition(evt.clientY);
      if (targetTeamId && targetTeamId !== originalTask.duration.teamId) {
        setDropZone({ teamId: targetTeamId });
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
      const currentTask = state.tasks.find(t => t.task.id === taskId);
      if (!currentTask) return;

      let taskUpdated = false;
      const moveDistance = Math.sqrt(finalOffset.x ** 2 + finalOffset.y ** 2);

      if (moveDistance > 5) {
        // 1) Snap to neighbor edges (priority at drop)
        const snapNow = getSnapAt(evt.clientX, evt.clientY, taskId);
        if (snapNow) {
          console.log("Attempting to snap to neighbour edges");
          const target = state.tasks.find(t => t.task.id === snapNow.taskId);
          if (target) {
            const desiredStart = snapNow.side === 'left'
              ? occStart(target) - effectiveDuration(currentTask, snapNow.teamId)
              : occEnd(target);
            const desiredEnd = desiredStart + effectiveDuration(currentTask, snapNow.teamId);

            // Prevent drop in invalid period
            if (isInInvalidPeriod(currentTask, desiredStart, desiredEnd, periods, periodOffsets)) {
              cancelDrag();
              return;
            }

            if (snapNow.teamId === currentTask.duration.teamId) {
              const siblings = state.tasks.filter(t => t.duration.teamId === currentTask.duration.teamId);
              const plan = planSequentialLayoutHours(
                siblings,
                currentTask.task.id,
                desiredStart,
                totalHours
              );
              for (const u of plan['updates']) {
                const orig = state.tasks.find(t => t.task.id === u.id);
                if (!orig) continue;
                if (orig.duration.startHour !== u.startHour || orig.duration.defaultDuration !== u.defaultDuration) {
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
              // Move to new team and reflow with desiredStart
              dispatch({ type: 'UPDATE_TASK_TEAM', taskId, newTeamId: snapNow.teamId });

              const newTeamSiblings = state.tasks
                .filter(t => t.duration.teamId === snapNow.teamId || t.task.id === taskId)
                .map(t => (t.task.id === taskId ? { ...t, duration: { ...t.duration, teamId: snapNow.teamId } } : t));

              const plan = planSequentialLayoutHours(
                newTeamSiblings as Task[],
                taskId,
                desiredStart,
                totalHours
              );
              for (const u of plan['updates']) {
                const orig = state.tasks.find(t => t.task.id === u.id);
                if (!orig) continue;
                if (orig.duration.startHour !== u.startHour || orig.duration.defaultDuration !== u.defaultDuration) {
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
              dispatch({ type: 'UPDATE_TASK_TEAM', taskId, newTeamId: null });
              taskUpdated = true;
            } 
          }

          if (!taskUpdated && worldmap) {
            console.log("Attempting to move task to worldmap");
            const r = worldmap.getBoundingClientRect();
            if (evt.clientX >= r.left && evt.clientX <= r.right && evt.clientY >= r.top && evt.clientY <= r.bottom) {
              console.log("Success")
              dispatch({ type: 'UPDATE_TASK_TEAM', taskId, newTeamId: null });
              taskUpdated = true;
            } 
          }
        }

        if (!taskUpdated) {
          // 3) Direct drop onto task body
          {
            console.log("Attempting to drop task onto other task body");
            const targetTeamId = getTeamFromMousePosition(evt.clientY);
            const timeline = ganttRef.current?.querySelector('.timeline-content') as HTMLElement | null;
            const rect = timeline?.getBoundingClientRect();
            if (rect && targetTeamId) {
              const pointerX = evt.clientX;
              const siblings = state.tasks.filter(t => t.duration.teamId === targetTeamId && t.task.id !== currentTask.task.id);
              let bodyMatch: { taskId: string; side: 'left'|'right' } | null = null;
              for (const t of siblings) {
                const leftPx = rect.left + ((occStart(t) / totalHours) * rect.width);
                const rightPx = rect.left + ((occEnd(t) / totalHours) * rect.width);
                if (pointerX > leftPx && pointerX < rightPx) {
                  const side: 'left' | 'right' = pointerX <= (leftPx + rightPx) / 2 ? 'left' : 'right';
                  bodyMatch = { taskId: t.task.id, side };
                  break;
                }
              }
              if (bodyMatch) {
                const target = state.tasks.find(t => t.task.id === bodyMatch.taskId);
                if (target && currentTask) {
                  // Place moving at visual drop position
                  const hasHoriz = !!rect && Math.abs(finalOffset.x) > 5;
                  const hoursDelta = hasHoriz && rect ? (finalOffset.x / rect.width) * totalHours : 0;
                  const desiredStart = currentTask.duration.startHour + (hoursDelta || 0);
                  const desiredEnd = desiredStart + effectiveDuration(currentTask, targetTeamId);
                  
                  if (isInInvalidPeriod(currentTask, desiredStart, desiredEnd, periods, periodOffsets)) {
                    cancelDrag();
                    return;
                  }

                  // Compute target's new start to be on the chosen side of moved block
                  const targetNewStart =
                    bodyMatch.side === 'left'
                      ? (desiredStart + effectiveDuration(currentTask, targetTeamId)) // move after
                      : target.duration.startHour; // stay
                  
                  const currentNewStart = 
                    bodyMatch.side === 'left'
                      ? desiredStart // stay
                      : target.duration.startHour + effectiveDuration(target, targetTeamId); // move after

                  if (targetTeamId === currentTask.duration.teamId) {
                    const sibs = state.tasks.filter(t => t.duration.teamId === currentTask.duration.teamId);
                    const sibsAdj = sibs.map(t => t.task.id === target.task.id ? { ...t, duration: { ...t.duration, startHour: targetNewStart } } : t);
                    const plan = planSequentialLayoutHours(
                      sibsAdj as Task[], 
                      currentTask.task.id, 
                      currentNewStart, 
                      totalHours
                    );
                    for (const u of plan['updates']) {
                      const orig = state.tasks.find(t => t.task.id === u.id);
                      if (!orig) continue;
                      if (orig.duration.startHour !== u.startHour || orig.duration.defaultDuration !== u.defaultDuration) {
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

                    if (isDisallowed(currentTask, targetTeamId)) {
                      // skip disallowed assignment
                      taskUpdated = true;
                    } else {
                      dispatch({ type: 'UPDATE_TASK_TEAM', taskId, newTeamId: targetTeamId });
                      const newTeamSibs = state.tasks
                        .filter(t => t.duration.teamId === targetTeamId || t.task.id === taskId)
                        .map(t => {
                          if (t.task.id === taskId) return { ...t, duration: { ...t.duration, teamId: targetTeamId } };
                          if (t.task.id === target.task.id) return { ...t, duration: { ...t.duration, startHour: targetNewStart } };
                          return t;
                        });
                      const plan = planSequentialLayoutHours(newTeamSibs as Task[], taskId, desiredStart, totalHours);
                      for (const u of plan['updates']) {
                        const orig = state.tasks.find(t => t.task.id === u.id);
                        if (!orig) continue;
                        if (orig.duration.startHour !== u.startHour || orig.duration.defaultDuration !== u.defaultDuration) {
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
            const target = state.tasks.find(t => t.task.id === snapTarget.taskId);
            if (isDisallowed(currentTask, snapTarget.teamId)) {
              // skip disallowed team assignment
            } else if (target) {
              const desiredStart = snapTarget.side === 'left'
                ? occStart(target) - effectiveDuration(currentTask, snapTarget.teamId)
                : occEnd(target);

              if (snapTarget.teamId === currentTask.duration.teamId) {
                const siblings = state.tasks.filter(t => t.duration.teamId === currentTask.duration.teamId);
                const plan = planSequentialLayoutHours(
                  siblings,
                  currentTask.task.id,
                  desiredStart,
                  totalHours
                );
                for (const u of plan['updates']) {
                  const orig = state.tasks.find(t => t.task.id === u.id);
                  if (!orig) continue;
                  if (orig.duration.startHour !== u.startHour || orig.duration.defaultDuration !== u.defaultDuration) {
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
                // Move to new team and reflow with desiredStart
                dispatch({ type: 'UPDATE_TASK_TEAM', taskId, newTeamId: snapTarget.teamId });

                const newTeamSiblings = state.tasks
                  .filter(t => t.duration.teamId === snapTarget.teamId || t.task.id === taskId)
                  .map(t => (t.task.id === taskId ? { ...t, duration: { ...t.duration, teamId: snapTarget.teamId } } : t));

                const plan = planSequentialLayoutHours(
                  newTeamSiblings as Task[],
                  taskId,
                  desiredStart,
                  totalHours
                );
                for (const u of plan['updates']) {
                  const orig = state.tasks.find(t => t.task.id === u.id);
                  if (!orig) continue;
                  if (orig.duration.startHour !== u.startHour || orig.duration.defaultDuration !== u.defaultDuration) {
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
            const proposedStart = currentTask.duration.startHour + (hoursDelta || 0); // Calculates start hour
            const targetTeamId = getTeamFromMousePosition(evt.clientY);
            const isTeamChange = !!targetTeamId && targetTeamId !== currentTask.duration.teamId;
            const effTeamForDrop = (isTeamChange && targetTeamId) ? targetTeamId : currentTask.duration.teamId;
            const proposedEnd = proposedStart + effectiveDuration(currentTask, effTeamForDrop);

            // Prevent drop in invalid period for horizontal/vertical moves
            if (isInInvalidPeriod(currentTask, proposedStart, proposedEnd, periods, periodOffsets)) {
              console.log("Invalid Period");
              cancelDrag();
              return;
            }

            if (isTeamChange && targetTeamId && !isDisallowed(currentTask, targetTeamId)) {
              // Move to new team and reflow at proposedStart
              dispatch({ type: 'UPDATE_TASK_TEAM', taskId, newTeamId: targetTeamId });

              const newTeamSiblings = state.tasks
                .filter(t => t.duration.teamId === targetTeamId || t.task.id === taskId)
                .map(t => (t.task.id === taskId ? { ...t, duration: { ...t.duration, teamId: targetTeamId } } : t));

              const plan = planSequentialLayoutHours(
                newTeamSiblings as Task[],
                taskId,
                proposedStart,
                totalHours
              );

              for (const u of plan['updates']) {
                const orig = state.tasks.find(t => t.task.id === u.id);
                if (!orig) continue;
                if (orig.duration.startHour !== u.startHour || orig.duration.defaultDuration !== u.defaultDuration) {
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
                  type: 'UPDATE_TASK_TEAM',
                  taskId: id,
                  newTeamId: null
                });
              }
              console.log("Success");
              taskUpdated = true;

            } else if (hasHoriz && ganttRef.current) {
              // Horizontal only in same team
              const siblings = state.tasks.filter(t => t.duration.teamId === currentTask.duration.teamId);

              const plan = planSequentialLayoutHours(
                siblings,
                currentTask.task.id,
                proposedStart,
                totalHours
              );

              for (const u of plan['updates']) {
                const orig = state.tasks.find(t => t.task.id === u.id);
                if (!orig) continue;
                if (orig.duration.startHour !== u.startHour || orig.duration.defaultDuration !== u.defaultDuration) {
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
                  type: 'UPDATE_TASK_TEAM',
                  taskId: id,
                  newTeamId: null
                });
              }
              console.log("Success");
              taskUpdated = true;
            }
          }
        }
      } else {
        // Click (no real drag)
        const teamId = state.tasks.find(t => t.task.id === taskId)?.duration.teamId ?? 'all';

        dispatch({ type: 'SET_SELECTED_TASK', taskId, toggle_team: teamId });
        console.log("Clicked on task", taskId);
      }

      // Cleanup drag state and listeners
      cancelDrag();
    };

    // Add global mouse event listeners for drag
    document.addEventListener('mousemove', handleMouseMove);
    document.addEventListener('mouseup', handleMouseUp);
  };

  // Handler for importing everything from one file
  const handleImportData = async (e: React.ChangeEvent<HTMLInputElement>) => {
    dispatch({ type: 'RESET_STATE' });
    console.log("Reset state: ", state.tasks, state.teams, state.periods);

    const file = e.target.files?.[0];
    if (!file) return;

    const result = await importDataFromFile(file);
    if (!result) return;

    // Import periods && period_length
    let _totalHours: number = 0
    let _formattedPeriods: Period[] | null = null;
    if (result.periods && Array.isArray(result.periods)) {
      const formattedPeriods = result.periods.map((id: string) => {
        // Get { name, length } from period_length
        const periodLength = result.period_length.find((p: Period) => p.id === id);
        const name = periodLength?.name ?? PERIOD_FALLBACK.name;
        const length_h = periodLength?.length_h ?? PERIOD_FALLBACK.length_h;

        _totalHours += length_h;

        return {
          id: id,
          name: name,
          length_h: length_h
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
      _totalHours = _formattedPeriods[0].length_h;
      dispatch({
        type: 'SET_PERIODS',
        periods: [PERIOD_FALLBACK]
      });
    }

    dispatch({
      type: 'SET_TOTAL_HOURS',
      totalHours: _totalHours
    });

    // Import months
    if (result.months && Array.isArray(result.months)) {
      const formattedMonths = result.months;
      dispatch({ type: 'SET_MONTHS', months: formattedMonths });
      console.log("Imported months: ", formattedMonths);
    }

    // Import teams 
    if (result.teams && Array.isArray(result.teams)) {
      const formattedTeams = result.teams;
      dispatch({ type: 'ADD_TEAMS', teams: formattedTeams });
      console.log("Imported Teams: ", formattedTeams);
    }

    // Import tasks
    if (
      (result.tasks && Array.isArray(result.tasks)) && 
      (result.durations && Array.isArray(result.durations)) && 
      (result.harvestCosts && Array.isArray(result.harvestCosts)) && 
      (result.production && Array.isArray(result.production)) && 
      (result.productivity && Array.isArray(result.productivity))
    ) { 
      console.log(result.harvestCosts);
      console.log(result.production);
      console.log(result.productivity);

      const formattedTasks = result.durations.map((t: any) => { 
        const id = t['Activity'];

        // Extract duration properties
        const fixedCost = t['Fixed cost'];
        const costPerHrs = t['Cost/hrs'];
        const defaultSetup = t['Default Setup (hrs)'];
        const defaultDuration = t['Default Duration (hrs)'];
        const specialTeams = t['Special Teams'];

        // Initialize with no value (is populated when solution is loaded)
        const teamId = null;
        const startHour = 0;

        // Find matching details
        const _details = result.tasks.find((d: any) => d.id === id);
        if (!_details) {
          console.warn(`No task details found for id: ${id}`);
        }

        const _harvestCosts = result.harvestCosts.find((h: any) => h['Activity'] === id)?.costs;
        if (!_harvestCosts) {
          console.warn(`No task harvesting costs found for id: ${id}`);
        }

        const _production = result.production.find((p: any) => p['Activity'] === id);
        if (!_production) {
          console.warn(`No task production found for id: ${id}`);
        }

        const _productivity = result.productivity.find((p: any) => p['Activity'] === id);
        if (!_productivity) {
          console.warn(`No task productivity found for id: ${id}`);
        }

        return {
          task: {
            id,
            lat: _details ? _details['lat'] : 0,
            lon: _details ? _details['lon'] : 0,
            avvForm: _details ? _details['avvForm'] : 'n/a',
            barighet: _details ? _details['barighet'] : 'n/a',
          },
          duration: {
            teamId,
            startHour,
            defaultSetup,
            defaultDuration,
            specialTeams,
            fixedCost,
            costPerHrs
          },
          harvestCosts: _harvestCosts ? _harvestCosts : [{Team: "", harvesterCost: 0, forwarderCost: 0, travelingCost: 0}]
          ,
          production: {
            gtk: _production ? _production['GTK'] : -1,
            gtn: _production ? _production['GTN'] : -1,
            ttk: _production ? _production['TTK'] : -1,
            ttn: _production ? _production['TTN'] : -1,
            asp: _production ? _production['ASP'] : -1,
            bmb: _production ? _production['BMB'] : -1,
            brv: _production ? _production['BRV'] : -1,
            gm: _production ? _production['GM'] : -1,
            grot: _production ? _production['GROT'] : -1,
            lm: _production ? _production['LM'] : -1,
            lt: _production ? _production['LT'] : -1
          },
          productivity: {
            p1: _productivity ? _productivity['P1'] : 'n/a',
            p2: _productivity ? _productivity['P2'] : 'n/a',
            p3: _productivity ? _productivity['P3'] : 'n/a',
            p4: _productivity ? _productivity['P4'] : 'n/a',
            p5: _productivity ? _productivity['P5'] : 'n/a',
            p6: _productivity ? _productivity['P6'] : 'n/a',
            p7: _productivity ? _productivity['P7'] : 'n/a',
            p8: _productivity ? _productivity['P8'] : 'n/a',
            p9: _productivity ? _productivity['P9'] : 'n/a',
            p10: _productivity ? _productivity['P10'] : 'n/a',
            p11: _productivity ? _productivity['P11'] : 'n/a',
            p12: _productivity ? _productivity['P12'] : 'n/a',
            p13: _productivity ? _productivity['P13'] : 'n/a',
            p14: _productivity ? _productivity['P14'] : 'n/a',
            p15: _productivity ? _productivity['P15'] : 'n/a',
            p16: _productivity ? _productivity['P16'] : 'n/a'
          }
        };
      });

      dispatch({ type: 'ADD_TASKS', tasks: formattedTasks });
      console.log("Imported Tasks: ", formattedTasks);
    }
  };

  const handleImportSolution = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const result = await importSolutionFromFile(file);
    if (!result) return;

    let _tasks = state.tasks; // Store local copy of state.tasks

    // Reset the teams of all tasks
    for (const task of _tasks) {
      dispatch({
        type: 'UPDATE_TASK_TEAM',
        taskId: task.task.id,
        newTeamId: null
      })
    }

    console.log("Reset all teams");

    if (result.solution && Array.isArray(result.solution)) {
      for (const {team, tasks} of result.solution) {
        for (const {task, start} of tasks) {
          if (state.teams.some(item => item.id === team)) {
            dispatch({
              type: 'UPDATE_TASK_TEAM',
              taskId: task,
              newTeamId: team
            });
          } 
          else {
            console.log("Failed to assign task to team. Team does not exist in current list", team, state.teams, state.teams.some(item => item.id === team));
          }

          // Update local copy after dispatch
          _tasks = _tasks.map(t => 
            t.task.id === task ? { ...t, duration: { ...t.duration, teamId: team } } : t
          );

          const foundTask = _tasks.find(t => t.task.id === task);
          if (foundTask) {
            const effDur = effectiveDuration(foundTask as Task, team);
            const clampedStart = clamp(start, 0, Math.max(0, totalHours - effDur));

            dispatch({
              type: 'UPDATE_TASK_HOURS',
              taskId: task,
              startHour: clampedStart,
              defaultDuration: foundTask.duration.defaultDuration
            }) 

            // Update local copy after dispatch
            _tasks = _tasks.map(t => 
              t.task.id === task ? { ...t, duration: { ...t.duration, startHour: clampedStart } } : t
            );
          }
        }
      }
    }

    console.log("Updated tasks");

    // Resolve overlaps
    const totalTasks: Task[] = _tasks;
    const totalTeams: Team[] = state.teams; 

    console.log("Resolving overlaps...");
    console.log("Total teams: ", totalTeams.length);

    for (const p of totalTeams) {
      const teamSiblings = totalTasks
        .filter(t => t.duration.teamId === p.id)
        .sort((a, b) => occStart(a) - occStart(b));

      console.log("Siblings: ", teamSiblings, teamSiblings.length);

      for (let i = 1; i < teamSiblings.length; i++) {
        const prev = teamSiblings[i - 1];
        const curr = teamSiblings[i];

        console.log('');
        console.log(`Prev: [${prev.duration.startHour}->${endHour(prev)}]`);
        console.log(`Curr: [${curr.duration.startHour}->${endHour(curr)}]`);

        // If the current start before prev ends -> overlap
        if (curr.duration.startHour < endHour(prev)) {
          let newStart = endHour(prev);
          console.log(`Overlap detected. Initial newStart: ${newStart}`);

          // Check if newStart is in a valid period for curr
          while (newStart + effectiveDuration(curr) <= totalHours) {
            if (isInValidPeriod(curr, newStart, effectiveDuration(curr), state.periods)) {
              // Found a valid position
              break;
            }

            // Find the next period boundary after an invalid period
            let cumulativeHour = 0;
            let foundNextValid = false;

            for (const { id, length_h } of state.periods) {
              const periodEnd = cumulativeHour + length_h;

              // If newStart is in or before this invalid period, try the next period
              if (curr.duration.invalidPeriods?.includes(id) && newStart < periodEnd) {
                newStart = periodEnd; // Move to start of next period
                foundNextValid = true;
                break;
              }

              cumulativeHour += length_h;
            }

            if (!foundNextValid) {
              // Couldnt find a valid period
              break;
            }
          }

          // If the end is out of range or couldnt find valid period
          if (newStart + effectiveDuration(curr) > totalHours || 
              !isInValidPeriod(curr, newStart, effectiveDuration(curr), state.periods)) {
            console.log(`${newStart} will be out of range or in invalid period for ${totalHours}`);
            dispatch({
              type: 'UPDATE_TASK_TEAM',
              taskId: curr.task.id,
              newTeamId: null
            });

            // Remove from local array 
            teamSiblings.splice(i, 1);
            i--; 
          } 
          else {
            console.log(`Moving curr to ${newStart}`);
            dispatch({
              type: 'UPDATE_TASK_HOURS',
              taskId: curr.task.id,
              startHour: newStart,
              defaultDuration: curr.duration.defaultDuration
            });

            // Update local object
            curr.duration.startHour = newStart;
          }
        } else {
          // Ensure it doesn't overflow
          if (curr.duration.startHour + effectiveDuration(curr) > totalHours) {
            console.log(`Curr is overflowing. Curr ends at ${curr.duration.startHour + effectiveDuration(curr)} but totalHours is only ${totalHours}`);
            dispatch({
              type: 'UPDATE_TASK_TEAM',
              taskId: curr.task.id,
              newTeamId: null
            });
          }
        }
      }
    }
  }  

  // ----------------------
  // Render Gantt Chart UI
  // ----------------------
  return (
    <div 
      ref={ganttRef}
      className="gantt-chart-container relative bg-white rounded-lg shadow-lg p-6 h-full overflow-hidden"
    >
      {/* Header: Title and Import Buttons */}
      <div className="flex items-center gap-2 mb-4">
        <Calendar className="text-green-600" size={24} />
        <h2 className="text-xl font-semibold text-gray-800">Planning</h2>

        {/* Import buttons */}
        <div className="ml-auto flex items-center gap-4">
          <label className="flex items-center gap-2 px-3 py-1 rounded text-xs font-medium bg-green-600 text-white hover:bg-green-700 cursor-pointer">
            <Upload size={18} /> Import Data
            <input
              type="file"
              accept=".json"
              style={{ display: 'none' }}
              onChange={handleImportData}
            />
          </label>
          <label className="flex items-center gap-2 px-3 py-1 rounded text-xs font-medium bg-green-600 text-white hover:bg-green-700 cursor-pointer">
            <Upload size={18} /> Import Solution
            <input
              type="file"
              accept=".json"
              style={{ display: 'none' }}
              onChange={handleImportSolution}
            />
          </label>
        </div>
      </div>
      
      {/* Instructions */}
      <div className="mb-2 text-xs text-gray-500 text-center">
        Drag tasks horizontally to adjust timing, vertically to change teams
      </div>

      {/* Main Gantt Body */}
      <div className="flex-1 flex overflow-hidden">

        {/* Left: Teams List */}
        <div className="w-24 flex-shrink-0 flex flex-col border-r border-gray-200">

          {/* Sticky team heading */}
          <div className="h-10 flex items-center justify-center font-medium text-gray-700 border-b border-gray-200 bg-white sticky top-0 z-10">
            Teams
          </div>

          {/* Scrollable team rows */}
          <div className="flex-1 overflow-y-auto overflow-x-hidden">
            {state.teams.map(team => {
              const relevantTask = state.dragging_to_gantt 
                ? state.tasks.find(t => t.task.id === state.dragging_to_gantt) 
                : state.selectedTaskId 
                ? state.tasks.find(t => t.task.id === state.selectedTaskId) 
                : draggedTask 
                ? state.tasks.find(t => t.task.id === draggedTask) 
                : null;
              
              const dis = relevantTask ? isDisallowed(relevantTask, team.id) : false;
              const isDropZone = dropZone?.teamId === team.id;
              const isSelected = state.selectedTeamId === team.id;
              const highlight = isDropZone || isSelected;

              // Decide row classes
              const rowClasses = [
                "h-8 flex items-center border-b px-2 relative transition-all",
                dis
                  ? "border-l-4 border-l-red-500"
                  : highlight
                  ? "bg-blue-50 border-blue-300 border-l-4 border-l-blue-500 border-b-gray-200"
                  : "border-gray-100",
              ].join("");
              
              return (
                <div
                  key={team.id}
                  className={rowClasses}
                  data-team-row
                  data-team-id={team.id}
                  onClick={() => dispatch({ type: 'SET_SELECTED_TEAM', teamId: team.id })}
                >
                  {/* Disallowed team overlay */}
                  {dis && (
                    <div className="absolute inset-0 pointer-events-none z-10"
                      style={{
                        background: 
                          'repeating-linear-gradient(45deg, rgba(239, 68, 68, 0.15) 0px, rgba(239, 68, 68, 0.15) 10px, rgba(239, 68, 68, 0.08) 10px, rgba(239, 68, 68, 0.08) 20px)',
                        border: '2px dashed rgba(239, 68, 68, 0.4)',
                        borderLeft: 'none',
                        borderRight: 'none'
                      }}
                    />
                  )}

                  {/* Team info */}
                  <div className="flex items-center gap-2">
                    <div 
                      className="w-3 h-4 rounded-full"
                      style={{ backgroundColor: team.color }} 
                    />
                    <span className="text-sm font-medium text-gray-700">{team.id}</span>
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        {/* Middle: Total Duration */}
        <div className="w-12 flex flex-col border-r border-gray-200">

          {/* Sticky total duration heading */}
          <div className="h-10 flex items-center justify-center font-medium text-gray-700 border-b border-gray-200 bg-white sticky top-0 z-10">
            d
          </div>

          {/* Scrollable duration rows */}
          <div className="flex-1 overflow-y-hidden overflow-x-hidden">
            {state.teams.map(team => {
              const relevantTask = state.dragging_to_gantt 
                ? state.tasks.find(t => t.task.id === state.dragging_to_gantt) 
                : state.selectedTaskId 
                ? state.tasks.find(t => t.task.id === state.selectedTaskId) 
                : draggedTask 
                ? state.tasks.find(t => t.task.id === draggedTask) 
                : null;
              
              const isTeamDisallowed = relevantTask ? isDisallowed(relevantTask as Task, team.id) : false;
              const rowTasks = state.tasks.filter(t => t.duration.teamId === team.id);
              const totalDuration = rowTasks
                .reduce((sum, task) => sum + effectiveDuration(task), 0)
                .toFixed(1);
              const isSelected = state.selectedTeamId === team.id;
              
              return (
                <div
                  key={team.id}
                  className={`h-8 border-b border-gray-100 relative`}
                  data-team-row
                  data-team-id={team.id}
                >
                  {/* Disallowed team overlay */}
                  {isTeamDisallowed && (
                    <div className="absolute inset-0 pointer-events-none z-10"
                      style={{
                        background: 'repeating-linear-gradient(45deg, rgba(239, 68, 68, 0.15) 0px, rgba(239, 68, 68, 0.15) 10px, rgba(239, 68, 68, 0.08) 10px, rgba(239, 68, 68, 0.08) 20px)',
                        border: '2px dashed rgba(239, 68, 68, 0.4)',
                        borderLeft: 'none',
                        borderRight: 'none'
                      }}
                    >
                    </div>
                  )}

                  {/* Selected team overlay */}
                  {isSelected && (
                    <div className='absolute inset-0 pointer-events-none bg-blue-200 bg-opacity-30 border-blue-400 border-2 border-dashed border-r-0 flex items-center justify-center'></div>
                  )}

                  {/* Duration info */}
                  <div className="flex items-center justify-center h-full">
                    <span className="text-xs font-medium text-gray-600 text-center">
                      {totalDuration}
                    </span>
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        {/* Right: Timeline */}
        <div className="flex-1 flex flex-col overflow-hidden">

          {/* Timeline container */}
          <div className="timeline-content relative">

            {/* Horizontal scroll wrapper */}
            <div className="flex-1 overflow-x-auto overflow-y-hidden">

              {/* Start period boundary: <div className="absolute top-0 bottom-0 left-0 border-r border-gray-100" />  */}
              {/* Sticky periods header row */}
              <div className="h-10 border-b border-gray-200 relative bg-white sticky top-0 z-10"> 
                <div className="flex h-full w-max">
                    {periods.map((p, idx) => ( 
                      <div 
                        key={p.id}
                        className="absolute top-0 h-full flex items-center justify-center text-xs text-gray-600 border-r border-gray-100" 
                        style={{
                          left: `${(periodOffsets[idx] / totalHours) * 100}%`,
                          width: `${(periods[idx].length_h / totalHours) * 100}%`
                        }} 
                      > 
                        {p.name}
                      </div>
                    ))}
                </div>
              </div>

              {/* Timeline rows */}
              {state.teams.map(team => {
                const relevantTask = state.dragging_to_gantt
                  ? state.tasks.find(t => t.task.id === state.dragging_to_gantt)
                  : state.selectedTaskId
                    ? state.tasks.find(t => t.task.id === state.selectedTaskId)
                    : draggedTask
                      ? state.tasks.find(t => t.task.id === draggedTask)
                      : null;
              
                const isTeamDisallowed = relevantTask ? isDisallowed(relevantTask as Task, team.id) : false;
                const isSelected = state.selectedTeamId === team.id;

                return (
                  <div
                    key={team.id} 
                    className={`h-8 border-b border-gray-100 relative`}
                    data-team-row="true"
                    data-team-id={team.id}
                  >

                  {/* Disallowed team overlay */}
                  {isTeamDisallowed && (
                    <div className="absolute inset-0 pointer-events-none"
                      style={{
                        background: 'repeating-linear-gradient(45deg, rgba(239, 68, 68, 0.15) 0px, rgba(239, 68, 68, 0.15) 10px, rgba(239, 68, 68, 0.08) 10px, rgba(239, 68, 68, 0.08) 20px)',
                        border: '2px dashed rgba(239, 68, 68, 0.4)',
                        borderLeft: 'none',
                        borderRight: 'none'
                      }}
                    >
                    </div>
                  )}

                  {/* Selected team overlay */}
                  {isSelected && (
                    <div className='absolute inset-0 pointer-events-none bg-blue-200 bg-opacity-30 border-blue-400 border-2 border-dashed border-l-0 flex items-center justify-center'></div>
                  )}

                  {/* Start grid line: <div className="absolute top-0 bottom-0 left-0 border-r border-gray-50" /> */}
                  {/* Grid lines at period boundaries */}
                  {periods.map((p, idx) => (
                    <div
                      key={`${team.id}-grid-${p.id}`}
                      className="absolute top-0 bottom-0 border-r border-gray-50"
                      style={{
                        left: `${(periodOffsets[idx] / totalHours) * 100}%`,
                        width: `${(periods[idx].length_h / totalHours) * 100}%`
                      }} 
                    />
                  ))}

                  {/* Invalid period overlays when task is selected or being dragged */}
                  {(state.dragging_to_gantt || state.selectedTaskId || draggedTask) && (() => {
                    const relevantTask = state.dragging_to_gantt
                    ? state.tasks.find(t => t.task.id === state.dragging_to_gantt)
                    : state.selectedTaskId
                      ? state.tasks.find(t => t.task.id === state.selectedTaskId)
                      : draggedTask
                        ? state.tasks.find(t => t.task.id === draggedTask)
                        : null

                    if (!relevantTask?.duration.invalidPeriods?.length) return null;

                    return relevantTask.duration.invalidPeriods.map(invalidPeriod => {
                      const periodIdx = periods.findIndex(p => p.id === invalidPeriod);
                      if (periodIdx === -1) return null;

                      const startPct = (periodOffsets[periodIdx] / totalHours) * 100;
                      const widthPct = (periods[periodIdx].length_h / totalHours) * 100;

                      return (
                        <div
                          key={`${team.id}-invalid-${invalidPeriod}`}
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
                  {(draggedTask) && getTasksByTeam(team.id).map(t => {
                    if (t.task.id !== state.dragging_from_gantt) {
                      const startPct = (occStart(t) / totalHours) * 100;
                      const endPct = (occEnd(t) / totalHours) * 100;
                      const isLeftActive = !!(snapTarget && snapTarget.teamId === team.id && snapTarget.taskId === t.task.id && snapTarget.side === 'left');
                      const isRightActive = !!(snapTarget && snapTarget.teamId === team.id && snapTarget.taskId === t.task.id && snapTarget.side === 'right');
                      return (
                        <div key={`${t.task.id}-guides`}>
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
                {getTasksByTeam(team.id).map(task => {
                  const position = calculateTaskPosition(task);
                  const isSelected = state.selectedTaskId === task.task.id;
                  const isBeingDragged = draggedTask === task.task.id;

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
                      key={task.task.id}
                      className={`group absolute top-1.5 bottom-1.5 rounded px-1 py-0.5 text-[10px] font-medium text-white cursor-move select-none 
                        ${isSelected ? 'ring-4 ring-yellow-400 ring-opacity-100 scale-105' : ''} 
                        ${isBeingDragged ? 'opacity-80 shadow-xl' : 'hover:shadow-md'}
                      `}
                      style={{ backgroundColor: getTaskColor(task.task.avvForm, team.color), ...position, ...dragStyle, overflow: 'visible' } as CSSProperties } 
                      onMouseDown={(e) => handleTaskMouseDown(e, task.task.id)}
                    >
                      {/* Setup visual indicator */}
                      {(task.duration.defaultSetup ?? 0) > 0 && (
                        <div
                          className="absolute inset-y-0 left-0 pointer-events-none"
                          title={`Setup: ${task.duration.defaultSetup}h`}
                          style={{
                            width: `${((task.duration.defaultSetup ?? 0) / effDur) * 100}%`,
                            backgroundImage:
                              'repeating-linear-gradient(45deg, rgba(255,255,255,0.35), rgba(255,255,255,0.35) 2px, transparent 2px, transparent 4px)',
                            borderRight: '1px dashed rgba(255,255,255,0.8)'
                          }}
                        />
                      )}

                      {/* Task text */}
                      <div
                        className="flex items-center justify-center h-full relative overflow-hidden"
                        style={{
                          marginLeft: `${(((task.duration.defaultSetup ?? 0) / effDur) * 100)}%`,
                          width: `${100 - (((task.duration.defaultSetup ?? 0) / effDur) * 100)}%`
                        }}
                      >
                        <span className="truncate w-full text-center text-[10px] leading-none">
                          {task.task.id}
                        </span>
                      </div>

                      {/* Tooltip with fade + upward slide */}
                      <div className="
                        absolute bottom-full mb-1 left-1/2 -translate-x-1/2
                        px-2 py-1 rounded bg-black text-white text-[10px] whitespace-nowrap shadow
                        opacity-0 translate-y-1
                        group-hover:opacity-100 group-hover:translate-y-0
                        transition-all duration-200 ease-out
                        pointer-events-none z-50
                      ">
                        {task.task.id}
                      </div>

                      {/* Disallowed overlay */}
                      {disallowed && (
                        <div className="absolute inset-0 bg-red-600/30 flex items-center justify-center pointer-events-none">
                          <span className="text-white font-semibold text-[10px] drop-shadow">Not allowed</span>
                        </div>
                      )}
                    </div>
                  );
                })}

                {/* Drop zone */}
                {dropZone?.teamId === team.id && (() => {
                  const moving = draggedTask ? state.tasks.find(t => t.task.id === draggedTask) : null;
                  const dis = moving ? isDisallowed(moving as Task, team.id) : false;

                  if (!dis) {
                    return (
                    <div className='absolute inset-0 bg-blue-200 bg-opacity-30 border-blue-400 border-2 border-dashed rounded flex items-center justify-center pointer-events-none'>
                      <span className='text-blue-900 font-medium text-sm z-20'>
                        Drop here to assign
                      </span>
                    </div>
                    );
                  }
                })()}
                </div>
              )})}
            </div>
          </div>

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
  );
}