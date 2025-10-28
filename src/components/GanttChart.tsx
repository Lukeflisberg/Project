import { useState, useRef, useEffect } from 'react';
import type { CSSProperties } from 'react';
import { Calendar, Upload } from 'lucide-react';
import { useApp } from '../context/AppContext';
import { Task, Team, Period } from '../types';
import { importDataFromFile, importSolutionFromFile } from '../helper/fileReader'
import { getPeriodData } from '../helper/periodUtils';
import { occStart, occEnd, effectiveDuration, isDisallowed, clamp, endHour, isInValidPeriod, isInInvalidPeriod, getTaskColor, planSequentialLayoutHours } from '../helper/taskUtils';
import { calculateTotalTaskDuration } from '../helper/chartUtils';
import { historyManager } from '../context/HistoryManager';

const PERIOD_FALLBACK: Period = {id: "P0", name: "n/a", length_h: 1};

export function GanttChart() {
  const { state, dispatch } = useApp();
  const [draggedTask, setDraggedTask] = useState<string | null>(null);
  const [dropZone, setDropZone] = useState<{ teamId: string } | null>(null);
  const [dragPosition, setDragPosition] = useState({ x: 0, y: 0 });
  const [snapTarget, setSnapTarget] = useState<{ teamId: string; taskId: string; side: 'left' | 'right' } | null>(null);
  const [, setSnapLeftPct] = useState<number | null>(null);
  const [, setDragOffsetOcc] = useState(0);
  const [dragHoverTaskId, setDragHoverTaskId] = useState<string | null>(null);
  const ganttRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const observer = new MutationObserver(() => {
      const taskId = document.body.getAttribute('data-dragging-to-gantt');
      setDragHoverTaskId(taskId || null);
    });
    
    observer.observe(document.body, { attributes: true });
    return () => observer.disconnect();
  }, []);

  const periods = state.periods?.length ? state.periods : [PERIOD_FALLBACK];
  const { periodOffsets, totalHours } = getPeriodData(periods, PERIOD_FALLBACK.length_h);
  
  // Helper to get the relevant task being dragged/selected
  const getRelevantTask = () => {
    return dragHoverTaskId 
      ? state.tasks.find(t => t.task.id === dragHoverTaskId) 
      : state.selectedTaskId 
      ? state.tasks.find(t => t.task.id === state.selectedTaskId) 
      : draggedTask 
      ? state.tasks.find(t => t.task.id === draggedTask) 
      : null;
  };

  const getTasksByTeam = (teamId: string | null) => {
    return state.tasks
      .filter(task => task.duration.teamId === teamId)
      .sort((a, b) => {
        const diff = occStart(a) - occStart(b);
        if (diff !== 0) return diff;
        if (a.task.id === draggedTask) return -1;
        if (b.task.id === draggedTask) return 1;
        return 0;
      });
  };

  const calculateTaskPosition = (task: Task): { left: string, width: string } => {
    const left = (Math.max(0, occStart(task)) / totalHours) * 100;
    const width = ((effectiveDuration(task, task.duration.teamId)) / totalHours) * 100;
    return { left: `${left}%`, width: `${width}%` };
  };

  const getTeamFromMousePosition = (mouseY: number): string | null => {
    if (!ganttRef.current) return null;
    const teamRows = ganttRef.current.querySelectorAll('[data-team-row]');
    for (let i = 0; i < teamRows.length; i++) {
      const rect = (teamRows[i] as HTMLElement).getBoundingClientRect();
      if (mouseY >= rect.top && mouseY <= rect.bottom) {
        return teamRows[i].getAttribute('data-team-id');
      }
    }
    return null;
  };

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
    const candidates = state.tasks.filter(t => t.duration.teamId === teamId && t.task.id !== excludeTaskId);

    for (const t of candidates) {
      const leftEdgePct = (occStart(t) / totalHours) * 100;
      const rightEdgePct = (occEnd(t) / totalHours) * 100;
      const leftPx = rect.left + (leftEdgePct / 100) * rect.width;
      const rightPx = rect.left + (rightEdgePct / 100) * rect.width;

      const inLeftZone = clientX >= leftPx - zoneWidthPx / 2 && clientX <= leftPx + zoneWidthPx / 2;
      const inRightZone = clientX >= rightPx - zoneWidthPx / 2 && clientX <= rightPx + zoneWidthPx / 2;

      if (inLeftZone || inRightZone) {
        const moving = state.tasks.find(x => x.task.id === excludeTaskId);
        if (!moving) continue;

        const side = inLeftZone ? 'left' : 'right';
        const validSpace = side === 'left' 
          ? checkLeftSpace(teamId, t, moving)
          : checkRightSpace(teamId, t, moving);

        if (validSpace) {
          return { teamId, taskId: t.task.id, side };
        }
      }
    }
    return null;
  };

  const checkLeftSpace = (teamId: string, target: Task, moving: Task): boolean => {
    const preds = state.tasks.filter(x => 
      x.duration.teamId === teamId && 
      x.task.id !== target.task.id && 
      x.task.id !== moving.task.id && 
      occEnd(x) <= occStart(target)
    );
    const predecessor = preds.sort((a,b) => occEnd(b) - occEnd(a))[0];
    const earliestOccStart = predecessor ? occEnd(predecessor) : 0;
    const desiredStart = occStart(target) - effectiveDuration(moving, teamId);
    return desiredStart >= earliestOccStart && desiredStart < totalHours;
  };

  const checkRightSpace = (teamId: string, target: Task, moving: Task): boolean => {
    const succs = state.tasks.filter(x => 
      x.duration.teamId === teamId && 
      x.task.id !== target.task.id && 
      x.task.id !== moving.task.id && 
      occStart(x) >= occEnd(target)
    );
    const successor = succs.sort((a,b) => occStart(a) - occStart(b))[0];
    const desiredStart = occEnd(target);
    return successor 
      ? (desiredStart + effectiveDuration(moving, teamId) <= occStart(successor))
      : (desiredStart < totalHours);
  };

  // Consolidated snap logic
  const handleSnapDrop = (
    snapInfo: { teamId: string; taskId: string; side: 'left' | 'right' },
    currentTask: Task,
    taskId: string
  ): boolean => {
    const target = state.tasks.find(t => t.task.id === snapInfo.taskId);
    if (!target) return false;

    const desiredStart = snapInfo.side === 'left'
      ? occStart(target) - effectiveDuration(currentTask, snapInfo.teamId)
      : occEnd(target);
    const desiredEnd = desiredStart + effectiveDuration(currentTask, snapInfo.teamId);

    if (isInInvalidPeriod(currentTask, desiredStart, desiredEnd, periods, periodOffsets)) {
      return false;
    }

    if (snapInfo.teamId === currentTask.duration.teamId) {
      // Same team
      return reflowTasksInTeam(currentTask.duration.teamId, taskId, desiredStart);
    } else {
      // Different team
      dispatch({ type: 'UPDATE_TASK_TEAM', taskId, newTeamId: snapInfo.teamId });
      const newTeamSiblings = state.tasks
        .filter(t => t.duration.teamId === snapInfo.teamId || t.task.id === taskId)
        .map(t => (t.task.id === taskId ? { ...t, duration: { ...t.duration, teamId: snapInfo.teamId } } : t));
      return reflowTasks(newTeamSiblings as Task[], taskId, desiredStart);
    }
  };

  // Consolidated reflow logic
  const reflowTasksInTeam = (teamId: string | null, taskId: string, desiredStart: number): boolean => {
    const siblings = state.tasks.filter(t => t.duration.teamId === teamId);
    return reflowTasks(siblings, taskId, desiredStart);
  };

  const reflowTasks = (tasks: Task[], taskId: string, desiredStart: number): boolean => {
    const plan = planSequentialLayoutHours(tasks, taskId, desiredStart, totalHours);
    const batchUpdates = plan['updates'].map(u => ({
      taskId: u.id,
      startHour: u.startHour,
      defaultDuration: u.defaultDuration
    }));

    if (batchUpdates.length > 0) {
      // console.log('📤 DISPATCHING BATCH_UPDATE_TASK_HOURS with', batchUpdates.length, 'updates');
      dispatch({ type: 'BATCH_UPDATE_TASK_HOURS', updates: batchUpdates });
      // console.log("Success");
      return true;
    }
    return false;
  };

  const handleTaskMouseDown = (e: React.MouseEvent, taskId: string) => {
    e.preventDefault();
    e.stopPropagation();

    if (state.taskSnapshot.length === 0) {
      dispatch({ 
        type: 'SET_TASKSNAPSHOT', 
        taskSnapshot: state.tasks.map(task => ({
          ...task,
          duration: { ...task.duration },
          task: { ...task.task }
        }))
      });
      // console.log('created snapshot');
    }

    dispatch({ type: 'SET_SELECTED_TASK', taskId: null, toggle_team: state.selectedTeamId });

    const originalTask = state.tasks.find(t => t.task.id === taskId);
    if (!originalTask) return;

    const offset = { x: e.clientX, y: e.clientY };
    setDraggedTask(taskId);
    setDragPosition({ x: 0, y: 0 });
    dispatch({ type: 'SET_DRAGGING_FROM_GANTT', taskId: taskId });

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

    const handleMouseMove = (evt: MouseEvent) => {
      const newDragPosition = { x: evt.clientX - offset.x, y: evt.clientY - offset.y };
      setDragPosition(newDragPosition);

      setSnapTarget(null);
      setSnapLeftPct(null);
      const targetTeamIdForSnap = getTeamFromMousePosition(evt.clientY);
      const timelineContent = ganttRef.current?.querySelector('.timeline-content') as HTMLElement | null;
      const rect = timelineContent?.getBoundingClientRect();
      
      if (rect && targetTeamIdForSnap) {
        const snapMatch = findSnapMatch(evt.clientX, rect, targetTeamIdForSnap, draggedTask);
        if (snapMatch) {
          setSnapTarget({ teamId: targetTeamIdForSnap, taskId: snapMatch.taskId, side: snapMatch.side as 'left' | 'right'});
          setSnapLeftPct(snapMatch.pct);
        }
      }

      const targetTeamId = getTeamFromMousePosition(evt.clientY);
      if (targetTeamId && targetTeamId !== originalTask.duration.teamId) {
        setDropZone({ teamId: targetTeamId });
      } else {
        setDropZone(null);
      }
    };

    const handleMouseUp = (evt: MouseEvent) => {
      const cancelDrag = () => {
        setDraggedTask(null);
        setDropZone(null);
        setDragPosition({ x: 0, y: 0 });
        setSnapTarget(null);
        setSnapLeftPct(null);
        setDragOffsetOcc(0);
        document.removeEventListener('mousemove', handleMouseMove);
        document.removeEventListener('mouseup', handleMouseUp);
      };

      const finalOffset = { x: evt.clientX - offset.x, y: evt.clientY - offset.y };
      dispatch({ type: 'SET_DRAGGING_FROM_GANTT', taskId: null });

      const currentTask = state.tasks.find(t => t.task.id === taskId);
      if (!currentTask) return;

      let taskUpdated = false;
      const moveDistance = Math.sqrt(finalOffset.x ** 2 + finalOffset.y ** 2);

      if (moveDistance > 5) {
        dispatch({ type: 'TOGGLE_COMPARISON_MODAL', toggledModal: true });

        // Try different drop strategies in order
        taskUpdated = trySnapDrop(evt, taskId, currentTask, cancelDrag) ||
                     tryUnassignDrop(evt, taskId) ||
                     tryBodyDrop(evt, taskId, currentTask, finalOffset, cancelDrag) ||
                     tryDeferredSnap(taskId, currentTask) ||
                     tryHorizontalVerticalShift(evt, taskId, currentTask, finalOffset, cancelDrag);

        if (taskUpdated && state.taskSnapshot.length > 0 && !state.toggledModal) {
          dispatch({ type: 'TOGGLE_COMPARISON_MODAL', toggledModal: true });
        }
      } else {
        const teamId = state.tasks.find(t => t.task.id === taskId)?.duration.teamId ?? 'all';
        dispatch({ type: 'SET_SELECTED_TASK', taskId, toggle_team: teamId });
        // console.log("Clicked on task", taskId);
      }

      cancelDrag();
      historyManager.push(state.tasks);
    };

    document.addEventListener('mousemove', handleMouseMove);
    document.addEventListener('mouseup', handleMouseUp);
  };

  const findSnapMatch = (pointerX: number, rect: DOMRect, teamId: string, excludeId: string | null) => {
    const candidates = state.tasks.filter(t => t.duration.teamId === teamId && t.task.id !== (excludeId ?? ''));
    const zoneWidthPx = 8;

    for (const t of candidates) {
      const startPct = (occStart(t) / totalHours) * 100;
      const endPct = (occEnd(t) / totalHours) * 100;
      const leftPx = rect.left + (startPct / 100) * rect.width;
      const rightPx = rect.left + (endPct / 100) * rect.width;

      const inLeftZone = pointerX >= leftPx - zoneWidthPx / 2 && pointerX <= leftPx + zoneWidthPx / 2;
      const inRightZone = pointerX >= rightPx - zoneWidthPx / 2 && pointerX <= rightPx + zoneWidthPx / 2;

      if (inLeftZone || inRightZone) {
        const side = inLeftZone ? 'left' : 'right';
        const moving = excludeId ? state.tasks.find(t => t.task.id === excludeId) : null;
        if (!moving) continue;

        const valid = side === 'left' 
          ? checkLeftSpace(teamId, t, moving)
          : checkRightSpace(teamId, t, moving);

        if (valid) {
          return { taskId: t.task.id, side, pct: side === 'left' ? startPct : endPct };
        }
      }
    }
    return null;
  };

  const trySnapDrop = (evt: MouseEvent, taskId: string, currentTask: Task, cancelDrag: () => void): boolean => {
    const snapNow = getSnapAt(evt.clientX, evt.clientY, taskId);
    if (!snapNow) return false;

    // console.log("Attempting to snap to neighbour edges");
    const success = handleSnapDrop(snapNow, currentTask, taskId);
    if (!success) cancelDrag();
    return success;
  };

  const tryUnassignDrop = (evt: MouseEvent, taskId: string): boolean => {
    const unassignedMenu = document.querySelector('.unassigned-tasks-container');
    const worldmap = document.querySelector('.world-map-container');
    
    const checkBounds = (element: Element | null) => {
      if (!element) return false;
      const r = element.getBoundingClientRect();
      return evt.clientX >= r.left && evt.clientX <= r.right && 
             evt.clientY >= r.top && evt.clientY <= r.bottom;
    };

    if (checkBounds(unassignedMenu) || checkBounds(worldmap)) {
      // console.log("Moving task to unassigned");
      dispatch({ type: 'UPDATE_TASK_TEAM', taskId, newTeamId: null });
      // console.log("Success");
      return true;
    }
    return false;
  };

  const tryBodyDrop = (
    evt: MouseEvent, 
    taskId: string, 
    currentTask: Task, 
    finalOffset: { x: number; y: number },
    cancelDrag: () => void
  ): boolean => {
    // console.log("Attempting to drop task onto other task body");
    const targetTeamId = getTeamFromMousePosition(evt.clientY);
    const timeline = ganttRef.current?.querySelector('.timeline-content') as HTMLElement | null;
    const rect = timeline?.getBoundingClientRect();
    
    if (!rect || !targetTeamId) return false;

    const siblings = state.tasks.filter(t => t.duration.teamId === targetTeamId && t.task.id !== currentTask.task.id);
    const bodyMatch = findBodyMatch(evt.clientX, rect, siblings);
    
    if (!bodyMatch) return false;

    const target = state.tasks.find(t => t.task.id === bodyMatch.taskId);
    if (!target) return false;

    const hasHoriz = !!rect && Math.abs(finalOffset.x) > 5;
    const hoursDelta = hasHoriz ? (finalOffset.x / rect.width) * totalHours : 0;
    const desiredStart = currentTask.duration.startHour + hoursDelta;
    const desiredEnd = desiredStart + effectiveDuration(currentTask, targetTeamId);
    
    if (isInInvalidPeriod(currentTask, desiredStart, desiredEnd, periods, periodOffsets)) {
      cancelDrag();
      return false;
    }

    const targetNewStart = bodyMatch.side === 'left'
      ? (desiredStart + effectiveDuration(currentTask, targetTeamId))
      : target.duration.startHour;
    
    const currentNewStart = bodyMatch.side === 'left'
      ? desiredStart
      : target.duration.startHour + effectiveDuration(target, targetTeamId);

    if (targetTeamId === currentTask.duration.teamId) {
      const sibs = state.tasks.filter(t => t.duration.teamId === currentTask.duration.teamId);
      const sibsAdj = sibs.map(t => 
        t.task.id === target.task.id 
          ? { ...t, duration: { ...t.duration, startHour: targetNewStart } } 
          : t
      );
      return reflowTasks(sibsAdj as Task[], currentTask.task.id, currentNewStart);
    } else {
      if (isDisallowed(currentTask, targetTeamId)) return true;

      dispatch({ type: 'UPDATE_TASK_TEAM', taskId, newTeamId: targetTeamId });
      const newTeamSibs = state.tasks
        .filter(t => t.duration.teamId === targetTeamId || t.task.id === taskId)
        .map(t => {
          if (t.task.id === taskId) return { ...t, duration: { ...t.duration, teamId: targetTeamId } };
          if (t.task.id === target.task.id) return { ...t, duration: { ...t.duration, startHour: targetNewStart } };
          return t;
        });
      return reflowTasks(newTeamSibs as Task[], taskId, desiredStart);
    }
  };

  const findBodyMatch = (pointerX: number, rect: DOMRect, siblings: Task[]) => {
    for (const t of siblings) {
      const leftPx = rect.left + ((occStart(t) / totalHours) * rect.width);
      const rightPx = rect.left + ((occEnd(t) / totalHours) * rect.width);
      if (pointerX > leftPx && pointerX < rightPx) {
        const side: 'left' | 'right' = pointerX <= (leftPx + rightPx) / 2 ? 'left' : 'right';
        return { taskId: t.task.id, side };
      }
    }
    return null;
  };

  const tryDeferredSnap = (taskId: string, currentTask: Task): boolean => {
    if (!snapTarget) return false;

    // console.log("Attempting deferred snap to neighbor edges");
    if (isDisallowed(currentTask, snapTarget.teamId)) return false;

    return handleSnapDrop(snapTarget, currentTask, taskId);
  };

  const tryHorizontalVerticalShift = (
    evt: MouseEvent,
    taskId: string,
    currentTask: Task,
    finalOffset: { x: number; y: number },
    cancelDrag: () => void
  ): boolean => {
    // console.log("Attempting to combine horizontal and vertical shift");
    const timelineContent = ganttRef.current?.querySelector('.timeline-content');
    const rect = timelineContent?.getBoundingClientRect();
    const hasHoriz = !!rect && Math.abs(finalOffset.x) > 5;
    const hoursDelta = hasHoriz && rect ? (finalOffset.x / rect.width) * totalHours : 0;
    const proposedStart = currentTask.duration.startHour + (hoursDelta || 0);
    const targetTeamId = getTeamFromMousePosition(evt.clientY);
    const isTeamChange = !!targetTeamId && targetTeamId !== currentTask.duration.teamId;
    const effTeamForDrop = (isTeamChange && targetTeamId) ? targetTeamId : currentTask.duration.teamId;
    const proposedEnd = proposedStart + effectiveDuration(currentTask, effTeamForDrop);

    if (proposedStart >= totalHours || isInInvalidPeriod(currentTask, proposedStart, proposedEnd, periods, periodOffsets)) {
      // console.log("Invalid Period");
      cancelDrag();
      return false;
    }

    if (isTeamChange && targetTeamId && !isDisallowed(currentTask, targetTeamId)) {
      dispatch({ type: 'UPDATE_TASK_TEAM', taskId, newTeamId: targetTeamId });
      const newTeamSiblings = state.tasks
        .filter(t => t.duration.teamId === targetTeamId || t.task.id === taskId)
        .map(t => (t.task.id === taskId ? { ...t, duration: { ...t.duration, teamId: targetTeamId } } : t));

      const plan = planSequentialLayoutHours(newTeamSiblings as Task[], taskId, proposedStart, totalHours);
      const success = reflowTasks(newTeamSiblings as Task[], taskId, proposedStart);
      
      for (const id of plan['unassign']) {
        dispatch({ type: 'UPDATE_TASK_TEAM', taskId: id, newTeamId: null });
      }
      // console.log("Success");
      return success;
    } else if (hasHoriz && ganttRef.current) {
      const siblings = state.tasks.filter(t => t.duration.teamId === currentTask.duration.teamId);
      const plan = planSequentialLayoutHours(siblings, currentTask.task.id, proposedStart, totalHours);
      const success = reflowTasks(siblings, currentTask.task.id, proposedStart);

      for (const id of plan['unassign']) {
        dispatch({ type: 'UPDATE_TASK_TEAM', taskId: id, newTeamId: null });
      }
      // console.log("Success");
      return success;
    }

    return false;
  };

  const handleImportData = async (e: React.ChangeEvent<HTMLInputElement>) => {
    dispatch({ type: 'RESET_STATE' });
    // console.log("Reset state: ", state.tasks, state.teams, state.periods);

    const file = e.target.files?.[0];
    if (!file) return;

    const result = await importDataFromFile(file);
    if (!result) return;

    let _totalHours: number = 0
    let _formattedPeriods: Period[] | null = null;
    
    if (result.periods && Array.isArray(result.periods)) {
      const formattedPeriods = result.periods.map((id: string) => {
        const periodLength = result.period_length.find((p: Period) => p.id === id);
        const name = periodLength?.name ?? PERIOD_FALLBACK.name;
        const length_h = periodLength?.length_h ?? PERIOD_FALLBACK.length_h;
        _totalHours += length_h;
        return { id, name, length_h };
      });

      dispatch({ type: 'SET_PERIODS', periods: formattedPeriods });
      _formattedPeriods = formattedPeriods;
      // console.log("Imported Periods: ", formattedPeriods);
      // console.log("Total hours: ", _totalHours);
    } 

    if (_formattedPeriods === null) {
      _formattedPeriods = [PERIOD_FALLBACK];
      _totalHours = _formattedPeriods[0].length_h;
      dispatch({ type: 'SET_PERIODS', periods: [PERIOD_FALLBACK] });
    }

    dispatch({ type: 'SET_TOTAL_HOURS', totalHours: _totalHours });

    if (result.months && Array.isArray(result.months)) {
      dispatch({ type: 'SET_MONTHS', months: result.months });
      console.log("Imported months: ", result.months);
    }

    if (result.productionGoals && Array.isArray(result.productionGoals)) {
      dispatch({ type: 'SET_PRODUCTION_GOALS', productionGoals: result.productionGoals})
      console.log("Imported Production Goals: ", result.productionGoals);
    }

    if (result.teams && Array.isArray(result.teams)) {
      dispatch({ type: 'UPDATE_TEAMS', teams: result.teams });
      // console.log("Imported Teams: ", result.teams);
    }

    if (
      (result.tasks && Array.isArray(result.tasks)) && 
      (result.durations && Array.isArray(result.durations)) && 
      (result.harvestCosts && Array.isArray(result.harvestCosts)) && 
      (result.production && Array.isArray(result.production)) && 
      (result.Productivity && Array.isArray(result.Productivity))
    ) { 
      const formattedTasks = result.durations.map((t: any) => { 
        const id = t['Activity'];
        const task = { ...result.tasks.find((d: any) => d.id === id)!, color: state.defaultColor };
        const harvestCosts = result.harvestCosts.find((h: any) => h['Activity'] === id)!.costs;
        const { Activity: a, ...production } = result.production.find((p: any) => p['Activity'] === id)!;
        const { Activity: b, ...productivity } = result.Productivity.find((p: any) => p['Activity'] === id)!;

        return {
          task,
          duration: {
            teamId: null,
            startHour: 0,
            defaultSetup: t['Default Setup (hrs)'],
            defaultDuration: t['Default Duration (hrs)'],
            specialTeams: t['Special Teams'],
            fixedCost: t['Fixed cost'],
            costPerHrs: t['Cost/hrs']
          },
          harvestCosts,
          production,
          productivity
        };
      });

      dispatch({ type: 'UPDATE_TASKS', tasks: formattedTasks });
      console.log("Imported Tasks: ", formattedTasks);
    }

    if (result.Resources && Array.isArray(result.Resources)) {
      const formattedResources = result.Resources.map((t: any) => ({
        resource: t.Resource,
        costPerHrs: t['Cost/hrs'],
        hrsPerWeek: t['(hrs/week)'],
        periods: {
          p1: t.P1, p2: t.P2, p3: t.P3, p4: t.P4, p5: t.P5, p6: t.P6,
          p7: t.P7, p8: t.P8, p9: t.P9, p10: t.P10, p11: t.P11, p12: t.P12,
          p13: t.P13, p14: t.P14, p15: t.P15, p16: t.P16
        }
      }));
      dispatch({ type: 'SET_RESOURCES', resources: formattedResources });
      console.log("Imported Resources: ", formattedResources);
    }

    if (result.Demand && Array.isArray(result.Demand)) {
      dispatch({ type: 'SET_DEMAND', demand: result.Demand });
      console.log("Imported Demand: ", result.Demand);
    }

    if (result.assortments_graph && Array.isArray(result.assortments_graph)) {
      dispatch({ type: 'SET_ASSORTMENTS_GRAPH', assortmentsGraph: result.assortments_graph });
      console.log("Imported Assortments Graph: ", result.assortments_graph);
    }

    if (result.Distances && Array.isArray(result.Distances)) {
      dispatch({ type: 'SET_DISTANCES', distances: result.Distances });
      console.log("Imported Distances: ", result.Distances);
    }
  };

  const handleImportSolution = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const result = await importSolutionFromFile(file);
    if (!result) return;

    let _tasks = state.tasks;

    if (result.transportCosts && Array.isArray(result.transportCosts)) {
      dispatch({ type: 'SET_TRANSPORT_COSTS', transportCosts: result.transportCosts });
      console.log("Imported Transport Costs: ", result.transportCosts);
    }

    // Reset all task teams
    for (const task of _tasks) {
      dispatch({ type: 'UPDATE_TASK_TEAM', taskId: task.task.id, newTeamId: null });
    }
    // console.log("Reset all teams");

    if (result.solution && Array.isArray(result.solution)) {
      for (const {team, tasks} of result.solution) {
        for (const {task, start} of tasks) {
          if (state.teams.some(item => item.id === team)) {
            dispatch({ type: 'UPDATE_TASK_TEAM', taskId: task, newTeamId: team });
          } else {
            // console.log("Failed to assign task to team. Team does not exist", team);
          }

          _tasks = _tasks.map(t => 
            t.task.id === task ? { ...t, duration: { ...t.duration, teamId: team } } : t
          );

          const foundTask = _tasks.find(t => t.task.id === task);
          if (foundTask) {
            const clampedStart = clamp(start, 0, Math.max(0, totalHours));
            dispatch({
              type: 'UPDATE_TASK_HOURS',
              taskId: task,
              startHour: clampedStart,
              defaultDuration: foundTask.duration.defaultDuration
            });
            _tasks = _tasks.map(t => 
              t.task.id === task ? { ...t, duration: { ...t.duration, startHour: clampedStart } } : t
            );
          }
        }
      }
    }

    // console.log("Updated tasks");

    // Resolve overlaps
    const totalTasks: Task[] = _tasks;
    const totalTeams: Team[] = state.teams;

    // console.log("Resolving overlaps...");
    // console.log("Total teams: ", totalTeams.length);

    for (const p of totalTeams) {
      const teamSiblings = totalTasks
        .filter(t => t.duration.teamId === p.id)
        .sort((a, b) => occStart(a) - occStart(b));

      // console.log("Siblings: ", teamSiblings.length);

      for (let i = 1; i < teamSiblings.length; i++) {
        const prev = teamSiblings[i - 1];
        const curr = teamSiblings[i];

        // console.log(`Prev: [${prev.duration.startHour}->${endHour(prev)}]`);
        // console.log(`Curr: [${curr.duration.startHour}->${endHour(curr)}]`);

        if (curr.duration.startHour < endHour(prev)) {
          let newStart = endHour(prev);
          // console.log(`Overlap detected. Initial newStart: ${newStart}`);

          // Find valid period for curr
          while (newStart < totalHours) {
            if (isInValidPeriod(curr, newStart, effectiveDuration(curr), state.periods)) {
              break;
            }

            let cumulativeHour = 0;
            let foundNextValid = false;

            for (const { id, length_h } of state.periods) {
              const periodEnd = cumulativeHour + length_h;
              if (curr.duration.invalidPeriods?.includes(id) && newStart < periodEnd) {
                newStart = periodEnd;
                foundNextValid = true;
                break;
              }
              cumulativeHour += length_h;
            }

            if (!foundNextValid) break;
          }

          if (newStart >= totalHours || 
              !isInValidPeriod(curr, newStart, effectiveDuration(curr), state.periods)) {
            // console.log(`${newStart} out of range or in invalid period`);
            dispatch({ type: 'UPDATE_TASK_TEAM', taskId: curr.task.id, newTeamId: null });
            teamSiblings.splice(i, 1);
            i--;
          } else {
            // console.log(`Moving curr to ${newStart}`);
            dispatch({
              type: 'UPDATE_TASK_HOURS',
              taskId: curr.task.id,
              startHour: newStart,
              defaultDuration: curr.duration.defaultDuration
            });
            curr.duration.startHour = newStart;
          }
        } else if (curr.duration.startHour >= totalHours) {
          // console.log(`Curr overflowing at ${curr.duration.startHour}`);
          dispatch({ type: 'UPDATE_TASK_TEAM', taskId: curr.task.id, newTeamId: null });
        }
      }
    }

    historyManager.init(state.tasks);
  };

  // Render team row helper
  const renderTeamRow = (team: Team, isInColumn: 'name' | 'util' | 'timeline') => {
    const relevantTask = getRelevantTask();
    const isDisallowedTeam = relevantTask ? isDisallowed(relevantTask, team.id) : false;
    const isDropZone = dropZone?.teamId === team.id;
    const isSelected = state.selectedTeamId === team.id;

    const disallowedOverlay = isDisallowedTeam && (
      <div className="absolute inset-0 pointer-events-none z-10"
        style={{
          background: 'repeating-linear-gradient(45deg, rgba(239, 68, 68, 0.15) 0px, rgba(239, 68, 68, 0.15) 10px, rgba(239, 68, 68, 0.08) 10px, rgba(239, 68, 68, 0.08) 20px)',
          border: '2px dashed rgba(239, 68, 68, 0.4)',
          borderLeft: isInColumn === 'name' ? '4px solid rgb(239, 68, 68)' : 'none',
          borderRight: 'none'
        }}
      />
    );

    const selectedOverlay = isSelected && !isDisallowedTeam && (
      <div className={`absolute inset-0 pointer-events-none bg-blue-200 bg-opacity-30 border-blue-400 border-2 border-dashed ${
        isInColumn === 'timeline' ? 'border-l-0' : isInColumn === 'util' ? '' : ''
      } flex items-center justify-center`} />
    );

    return { isDisallowedTeam, isDropZone, isSelected, disallowedOverlay, selectedOverlay };
  };

  return (
    <div 
      ref={ganttRef}
      className="gantt-chart-container flex flex-col relative bg-white rounded-lg shadow-lg p-4 h-full overflow-hidden"
    >
      <div className="flex items-center gap-2 mb-2">
        <Calendar className="text-green-600" size={20} />
        <h2 className="text-lg font-semibold text-gray-800">Schedule</h2>

        <div className="ml-auto flex items-center gap-2">
          <label className="flex items-center gap-1.5 px-2.5 py-1 rounded text-xs font-medium bg-green-600 text-white hover:bg-green-700 cursor-pointer">
            <Upload size={14} /> Import Data
            <input type="file" accept=".json" style={{ display: 'none' }} onChange={handleImportData} />
          </label>
          <label className="flex items-center gap-1.5 px-2.5 py-1 rounded text-xs font-medium bg-green-600 text-white hover:bg-green-700 cursor-pointer">
            <Upload size={14} /> Import Solution
            <input type="file" accept=".json" style={{ display: 'none' }} onChange={handleImportSolution} />
          </label>
        </div>
      </div>

      <div className="flex-1 flex overflow-hidden">
        {/* Team Names Column */}
        <div className="w-24 flex-shrink-0 flex flex-col border-r border-gray-200">
          <div className="h-8 flex items-center justify-center font-medium text-xs text-gray-700 border-b border-gray-200 bg-white sticky top-0 z-10">
            Teams
          </div>

          <div className="flex-1 overflow-y-scroll overflow-x-hidden" style={{ direction: 'rtl' }} onScroll={(e) => {
            const scrollTop = e.currentTarget.scrollTop;
            const durationCol = ganttRef.current?.querySelector('.duration-column');
            const timelineCol = ganttRef.current?.querySelector('.timeline-column');
            if (durationCol) durationCol.scrollTop = scrollTop;
            if (timelineCol) timelineCol.scrollTop = scrollTop;
          }}>
            {state.teams.map(team => {
              const { isDisallowedTeam, isDropZone, isSelected, disallowedOverlay } = renderTeamRow(team, 'name');
              const highlight = isDropZone || isSelected;

              return (
                <div
                  key={team.id}
                  className={`h-6 flex items-center border-b px-2 relative transition-all ${
                    isDisallowedTeam
                      ? "border-l-4 border-l-red-500"
                      : highlight
                      ? "bg-blue-50 border-blue-300 border-l-4 border-l-blue-500 border-b-gray-200"
                      : "border-gray-100"
                  }`}
                  data-team-row
                  data-team-id={team.id}
                  onClick={() => dispatch({ type: 'SET_SELECTED_TEAM', teamId: team.id })}
                >
                  {disallowedOverlay}
                  <div className="flex items-center gap-1.5">
                    <div 
                      className="w-2.5 h-3 rounded-full"
                      style={{ backgroundColor: state.defaultColor }} 
                    />
                    <span className="text-xs font-medium text-gray-700">{team.id}</span>
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        {/* Utilization Column */}
        <div className="w-12 flex flex-col border-r border-gray-200">
          <div className="h-8 flex items-center justify-center font-medium text-xs text-gray-700 border-b border-gray-200 bg-white sticky top-0 z-10">
            util
          </div>

          <div className="duration-column flex-1 overflow-y-hidden overflow-x-hidden">
            {state.teams.map(team => {
              const { disallowedOverlay, selectedOverlay } = renderTeamRow(team, 'util');
              const rowTasks = state.tasks.filter(t => t.duration.teamId === team.id);
              const totalDuration = calculateTotalTaskDuration(rowTasks, state.totalHours);
              
              return (
                <div
                  key={team.id}
                  className="h-6 border-b border-gray-100 relative"
                  data-team-row
                  data-team-id={team.id}
                >
                  {disallowedOverlay}
                  {selectedOverlay}
                  <div className="flex items-center justify-center h-full">
                    <span className="text-xs font-medium text-gray-600 text-center">
                      {Math.round((totalDuration / state.totalHours) * 100)}%
                    </span>
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        {/* Timeline Column */}
        <div className="flex-1 flex flex-col overflow-hidden">
          <div className="timeline-content relative flex flex-col h-full" style={{ minWidth: 0 }}>
            <div className="timeline-column flex-1 overflow-x-auto overflow-y-hidden">
              <div className="h-8 border-b border-gray-200 relative bg-white sticky top-0 z-10"> 
                <div className="flex h-full w-max">
                  {periods.map((p, idx) => ( 
                    <div 
                      key={p.id}
                      className="absolute top-0 h-full flex items-center justify-center text-[10px] text-gray-600 border-r border-gray-100" 
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

              {state.teams.map(team => {
                const { disallowedOverlay, selectedOverlay } = renderTeamRow(team, 'timeline');

                return (
                  <div
                    key={team.id} 
                    className="h-6 border-b border-gray-100 relative"
                    data-team-row="true"
                    data-team-id={team.id}
                  >
                    {disallowedOverlay}
                    {selectedOverlay}

                    {/* Period grid lines */}
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

                    {/* Invalid period overlays */}
                    {getRelevantTask()?.duration.invalidPeriods?.map(invalidPeriod => {
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
                        />
                      );
                    })}

                    {/* Snap guides */}
                    {draggedTask && getTasksByTeam(team.id).map(t => {
                      if (t.task.id === state.dragging_from_gantt) return null;
                      
                      const startPct = (occStart(t) / totalHours) * 100;
                      const endPct = (occEnd(t) / totalHours) * 100;
                      const isLeftActive = !!(snapTarget && snapTarget.teamId === team.id && snapTarget.taskId === t.task.id && snapTarget.side === 'left');
                      const isRightActive = !!(snapTarget && snapTarget.teamId === team.id && snapTarget.taskId === t.task.id && snapTarget.side === 'right');
                      
                      return (
                        <div key={`${t.task.id}-guides`}>
                          {[
                            { pct: startPct, active: isLeftActive, label: 'Before' },
                            { pct: endPct, active: isRightActive, label: 'After' }
                          ].map(({ pct, active, label }, i) => (
                            <div
                              key={i}
                              className="absolute top-0 bottom-0 pointer-events-none"
                              style={{ left: `${pct}%`, marginLeft: -8, width: 16, zIndex: 20 }}
                            >
                              <div
                                className={`relative h-full rounded-sm ${active ? 'bg-emerald-500/50 animate-pulse' : 'bg-emerald-400/20'}`}
                                style={{ boxShadow: active ? '0 0 0 2px rgba(16,185,129,0.6)' : undefined }}
                              >
                                <div className="absolute inset-y-0 left-1/2 -translate-x-1/2 w-px bg-emerald-700/70"></div>
                                {active && (
                                  <div className="absolute -top-5 left-1/2 -translate-x-1/2 px-2 py-0.5 rounded text-[10px] font-semibold bg-emerald-600 text-white shadow">
                                    {label}
                                  </div>
                                )}
                              </div>
                            </div>
                          ))}
                        </div>
                      );
                    })}

                    {/* Task blocks */}
                    {getTasksByTeam(team.id).map((task, taskIndex) => {
                      const position = calculateTaskPosition(task);
                      const isSelected = state.selectedTaskId === task.task.id;
                      const isBeingDragged = draggedTask === task.task.id;
                      const isTeamSelected = state.selectedTeamId === team.id;

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
                          className={`group absolute top-0.5 bottom-0.5 rounded px-1 py-0.5 text-[10px] font-medium text-white cursor-move select-none 
                            ${isSelected ? 'ring-4 ring-yellow-400 ring-opacity-100 scale-105' : ''} 
                            ${isBeingDragged ? 'opacity-80 shadow-xl' : 'hover:shadow-md'}
                          `}
                          style={{ backgroundColor: getTaskColor(task), ...position, ...dragStyle, overflow: 'visible' } as CSSProperties } 
                          onMouseDown={(e) => handleTaskMouseDown(e, task.task.id)}
                        >
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

                          <div
                            className="flex items-center justify-center h-full relative"
                            style={{
                              marginLeft: `${(((task.duration.defaultSetup ?? 0) / effDur) * 100)}%`,
                              width: `${100 - (((task.duration.defaultSetup ?? 0) / effDur) * 100)}%`
                            }}
                          >
                            {isTeamSelected && (
                              <span className="text-white font-bold text-[11px] drop-shadow-md whitespace-nowrap">
                                {taskIndex + 1}
                              </span>
                            )}
                          </div>

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

                          {disallowed && (
                            <div className="absolute inset-0 bg-red-600/30 flex items-center justify-center pointer-events-none">
                              <span className="text-white font-semibold text-[10px] drop-shadow">Not allowed</span>
                            </div>
                          )}
                        </div>
                      );
                    })}

                    {/* Drop zone indicator */}
                    {dropZone?.teamId === team.id && !isDisallowed(getRelevantTask() as Task, team.id) && (
                      <div className='absolute inset-0 bg-blue-200 bg-opacity-30 border-blue-400 border-2 border-dashed rounded flex items-center justify-center pointer-events-none'>
                        <span className='text-blue-900 font-medium text-sm z-20'>
                          Drop here to assign
                        </span>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </div>

          {/* Global drop indicator */}
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