import { useState, useRef } from 'react';
import { Calendar, AlertTriangle, Upload } from 'lucide-react';
import { useApp } from '../context/AppContext';
import { Task } from '../types';
import { importTasksFromFile, processImportedTasks } from '../helper/fileReader';

// Period config (fallbacks if not in state)
const DEFAULT_PERIODS = ['P1','P2','P3','P4','P5','P6','P7','P8','P9','P10','P11','P12','P13'];
const DEFAULT_PERIOD_LEN = 40; // hours

const endHour = (t: Task) => t.startHour + t.durationHours; // exclusive
const clamp = (v: number, min: number, max: number) => Math.max(min, Math.min(max, v));

// Setup helpers
const setupOf = (t: Task) => {
  const n = t.setup ?? 0;
  return Number.isFinite(n) ? Math.max(0, n) : 0;
};
const occStart = (t: Task) => t.startHour - setupOf(t);
const occEnd = (t: Task) => endHour(t);

// Returns planned (startHour,durationHours) for each task so none overlap, after a move.
function planSequentialLayoutHours(
  siblings: Task[],
  movedTaskId: string,
  movedNewStartHour: number,
  periodLen: number,
  maxHour: number
): Array<{ id: string; startHour: number; durationHours: number }> {
  // Local copy
  const local = siblings.map(t => ({ ...t }));

  // Apply moved task's new start locally first (no snapping)
  const moved = local.find(t => t.id === movedTaskId);
  if (!moved) return [];
  const movedDur = Math.max(1, moved.durationHours);
  moved.startHour = clamp(movedNewStartHour, 0, Math.max(0, maxHour - movedDur));

  // Sort by start hour, but prioritize moved task if equal
  local.sort((a, b) => {
    const diff = a.startHour - b.startHour;
    if (diff !== 0) return diff;
    if (a.id === movedTaskId) return -1;
    if (b.id === movedTaskId) return 1;
    return 0;
  });

  // Sweep forward ensuring no overlaps
  const updates: Array<{ id: string; startHour: number; durationHours: number }> = [];
  let nextAvailableStart = 0; // track next occupied end in hours

  for (const t of local) {
    const dur = Math.max(1, t.durationHours);
    // Ensure occupied start >= nextAvailableStart
    const desired = Math.max(t.startHour, nextAvailableStart + setupOf(t));
    const start = clamp(desired, 0, Math.max(0, maxHour - dur));
    const end = start + dur;

    // Record planned hours
    updates.push({ id: t.id, startHour: start, durationHours: dur });
    nextAvailableStart = end;
  }

  return updates;
}

export function GanttChart() {
  const { state, dispatch } = useApp();
  const [draggedTask, setDraggedTask] = useState<string | null>(null);
  const [dropZone, setDropZone] = useState<{ parentId: string } | null>(null);
  const [dragPosition, setDragPosition] = useState({ x: 0, y: 0 });
  const [snapTarget, setSnapTarget] = useState<{ parentId: string; taskId: string; side: 'left' | 'right' } | null>(null);
  const [snapLeftPct, setSnapLeftPct] = useState<number | null>(null);
  const ganttRef = useRef<HTMLDivElement>(null);

  const periods = state.periods?.length ? state.periods : DEFAULT_PERIODS;
  const periodLen = state.periodLengthHours || DEFAULT_PERIOD_LEN;
  const totalHours = Math.max(1, periods.length * periodLen);

  const getTasksByParent = (parentId: string | null) => {
    return state.tasks
      .filter(task => task.parentId === parentId)
      .sort((a, b) => {
        const diff = a.startHour - b.startHour;
        if (diff !== 0) return diff;

        // If they start equal, prioritize the currently dragged task
        if (a.id === draggedTask) return -1;
        if (b.id === draggedTask) return 1;

        return 0;
      });
  };

  const calculateTaskPosition = (task: Task) => {
    const left = (Math.max(0, occStart(task)) / totalHours) * 100;
    const width = ((setupOf(task) + task.durationHours) / totalHours) * 100;
    return { left: `${left}%`, width: `${width}%` };
  };

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
      const leftEdgePct = (occStart(t) / totalHours) * 100;
      const rightEdgePct = (occEnd(t) / totalHours) * 100;
      const leftPx = rect.left + (leftEdgePct / 100) * rect.width;
      const rightPx = rect.left + (rightEdgePct / 100) * rect.width;

      const inLeftZone = pointerX >= leftPx - zoneWidthPx / 2 && pointerX <= leftPx + zoneWidthPx / 2;
      const inRightZone = pointerX >= rightPx - zoneWidthPx / 2 && pointerX <= rightPx + zoneWidthPx / 2;

      if (inLeftZone) {
        // capacity check (left)
        const moving = state.tasks.find(x => x.id === excludeTaskId);
        if (!moving) continue;
        const preds = state.tasks.filter(x => x.parentId === parentId && x.id !== t.id && x.id !== excludeTaskId && occEnd(x) <= occStart(t));
        const predecessor = preds.sort((a,b) => occEnd(b) - occEnd(a))[0];
        const earliestOccStart = predecessor ? occEnd(predecessor) : 0;
        const desiredStart = occStart(t) - moving.durationHours;
        if ((desiredStart - setupOf(moving)) >= earliestOccStart) return { parentId, taskId: t.id, side: 'left' };
      }
      if (inRightZone) {
        // capacity check (right)
        const moving = state.tasks.find(x => x.id === excludeTaskId);
        if (!moving) continue;
        const succs = state.tasks.filter(x => x.parentId === parentId && x.id !== t.id && x.id !== excludeTaskId && occStart(x) >= occEnd(t));
        const successor = succs.sort((a,b) => occStart(a) - occStart(b))[0];
        const desiredStart = occEnd(t) + setupOf(moving);
        const desiredEnd = desiredStart + moving.durationHours;
        const latestOccEnd = successor ? occStart(successor) : totalHours;
        if (desiredEnd <= latestOccEnd) return { parentId, taskId: t.id, side: 'right' };
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

        if (match && draggedTask) {
          const target = state.tasks.find(t => t.id === match.taskId);
          const moving = state.tasks.find(t => t.id === draggedTask);
          if (target && moving) {
            if (match.side === 'left') {
              // find predecessor (occupied)
              const preds = state.tasks.filter(t => t.parentId === targetParentIdForSnap && t.id !== target.id && t.id !== draggedTask && occEnd(t) <= occStart(target));
              const predecessor = preds.sort((a,b) => occEnd(b) - occEnd(a))[0];
              const earliestOccStart = predecessor ? occEnd(predecessor) : 0;
              const desiredStart = occStart(target) - moving.durationHours;
              if ((desiredStart - setupOf(moving)) >= earliestOccStart) {
                setSnapTarget({ parentId: targetParentIdForSnap, taskId: match.taskId, side: match.side });
                setSnapLeftPct(match.pct);
              }
            } else {
              // right side: ensure space before successor (occupied)
              const succs = state.tasks.filter(t => t.parentId === targetParentIdForSnap && t.id !== target.id && t.id !== draggedTask && occStart(t) >= occEnd(target));
              const successor = succs.sort((a,b) => occStart(a) - occStart(b))[0];
              const desiredStart = occEnd(target) + setupOf(moving);
              const desiredEnd = desiredStart + moving.durationHours;
              const latestOccEnd = successor ? occStart(successor) : totalHours;
              if (desiredEnd <= latestOccEnd) {
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
      } else {
        setDropZone(null);
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
            const desiredStart = snapNow.side === 'left'
              ? occStart(target) - currentTask.durationHours
              : occEnd(target) + (currentTask.setup ?? 0);

            if (snapNow.parentId === currentTask.parentId) {
              const siblings = state.tasks.filter(t => t.parentId === currentTask.parentId);
              const plan = planSequentialLayoutHours(
                siblings,
                currentTask.id,
                desiredStart,
                periodLen,
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
                periodLen,
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
          // 2) Snap to neighbor edges (deferred)
          if (snapTarget) {
            const target = state.tasks.find(t => t.id === snapTarget.taskId);
            if (target) {
              const desiredStart = snapTarget.side === 'left'
                ? occStart(target) - currentTask.durationHours
                : occEnd(target) + (currentTask.setup ?? 0);

              if (snapTarget.parentId === currentTask.parentId) {
                const siblings = state.tasks.filter(t => t.parentId === currentTask.parentId);
                const plan = planSequentialLayoutHours(
                  siblings,
                  currentTask.id,
                  desiredStart,
                  periodLen,
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
                  periodLen,
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

          // 3) Horizontal shift (time)
          if (!taskUpdated && Math.abs(finalOffset.x) > 5 && ganttRef.current) {
            const timelineContent = ganttRef.current.querySelector('.timeline-content');
            const rect = timelineContent?.getBoundingClientRect();

            if (rect) {
              const hoursDelta = (finalOffset.x / rect.width) * totalHours;
              const newStartHour = currentTask.startHour + hoursDelta;

              // Build local siblings snapshot including this task
              const siblings = state.tasks.filter(t => t.parentId === currentTask.parentId);

              // Plan the full, non-overlapping layout locally first
              const plan = planSequentialLayoutHours(
                siblings,
                currentTask.id,
                newStartHour,
                periodLen,
                totalHours
              );

              // Dispatch only real changes
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

          // 3) Vertical shift (parent change)
          const newParentId = !taskUpdated ? getParentFromMousePosition(evt.clientY) : null;
          if (newParentId && newParentId !== currentTask.parentId) {
            // Move to new parent first
            dispatch({ type: 'UPDATE_TASK_PARENT', taskId, newParentId });

            // Reflow within the new parent immediately using local plan
            const keptStart = currentTask.startHour;

            const newParentSiblings = state.tasks
              .filter(t => t.parentId === newParentId || t.id === taskId)
              .map(t => (t.id === taskId ? { ...t, parentId: newParentId } : t));

            const plan = planSequentialLayoutHours(
              newParentSiblings as Task[],
              taskId,
              keptStart,
              periodLen,
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
      } else {
        // Click (no real drag)
        dispatch({ type: 'SET_SELECTED_TASK', taskId, toggle_parent: 'any' });
      }

      // Cleanup
      setDraggedTask(null);
      setDropZone(null);
      setDragPosition({ x: 0, y: 0 });
      setSnapTarget(null);
      setSnapLeftPct(null);

      document.removeEventListener('mousemove', handleMouseMove);
      document.removeEventListener('mouseup', handleMouseUp);
    };

    document.addEventListener('mousemove', handleMouseMove);
    document.addEventListener('mouseup', handleMouseUp);
  };

  return (
    <div ref={ganttRef} className="gantt-chart-container relative bg-white rounded-lg shadow-lg p-6 h-full overflow-hidden">
      <div className="flex items-center gap-2 mb-4">
        <Calendar className="text-green-600" size={24}/>
        <h2 className="text-xl font-semibold text-gray-800">Task Timeline</h2>

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
              {/* Header scale by periods */}
              <div className="h-12 border-b border-gray-200 relative">
                {periods.map((p, idx) => (
                  <div
                    key={p}
                    className="absolute top-0 h-full flex items-center justify-center text-xs text-gray-600 border-r border-gray-100"
                    style={{
                      left: `${((idx * periodLen) / totalHours) * 100}%`,
                      width: `${(periodLen / totalHours) * 100}%`
                    }}
                  >
                    {p}
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
                  {/* Grid lines at period boundaries */}
                  {periods.map((p, idx) => (
                    <div
                      key={`${parent.id}-${p}`}
                      className="absolute top-0 bottom-0 border-r border-gray-50"
                      style={{ left: `${(((idx + 1) * periodLen) / totalHours) * 100}%` }}
                    />
                  ))}

                  {/* Edge guides on all tasks (wider, animated, labeled) */}
                  {(draggedTask) && getTasksByParent(parent.id).map(t => {
                    if (t.id !== state.draggingTaskId_gantt) {
                      const startPct = (t.startHour / totalHours) * 100;
                      const endPct = (endHour(t) / totalHours) * 100;
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

                    return (
                      <div
                        key={task.id}
                        className={`absolute top-2 bottom-2 rounded px-2 py-1 text-xs font-medium cursor-move transition-all select-none 
                          ${isSelected ? 'ring-4 ring-yellow-400 ring-opacity-100 scale-105' : ''} 
                          ${isBeingDragged ? 'opacity-80 shadow-xl' : 'hover:shadow-md'}
                          text-white`}
                        style={{ backgroundColor: parent.color, ...position, ...dragStyle, overflow: 'hidden' }}
                        onMouseDown={(e) => handleTaskMouseDown(e, task.id)}
                      >
                        {(task.setup ?? 0) > 0 && (
                          <div
                            className="absolute inset-y-0 left-0"
                            title={`Setup: ${task.setup}h`}
                            style={{
                              width: `${(((task.setup ?? 0) / ((task.setup ?? 0) + task.durationHours)) * 100)}%`,
                              backgroundImage: 'linear-gradient(45deg, rgba(255,255,255,0.35) 25%, transparent 25%), linear-gradient(-45deg, rgba(255,255,255,0.35) 25%, transparent 25%), linear-gradient(45deg, transparent 75%, rgba(255,255,255,0.35) 75%), linear-gradient(-45deg, transparent 75%, rgba(255,255,255,0.35) 75%)',
                              backgroundSize: '8px 8px',
                              backgroundPosition: '0 0, 0 4px, 4px -4px, -4px 0px',
                              borderRight: '1px dashed rgba(255,255,255,0.8)'
                            }}
                          />
                        )}
                        <div
                          className="flex items-center justify-between h-full relative"
                          style={{
                            marginLeft: `${(((task.setup ?? 0) / ((task.setup ?? 0) + task.durationHours)) * 100)}%`,
                            width: `${100 - (((task.setup ?? 0) / ((task.setup ?? 0) + task.durationHours)) * 100)}%`
                          }}
                        >
                          <span className="truncate">{task.name}</span>
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