import React, { createContext, useContext, useReducer, ReactNode } from 'react';
import { AppState, Task, Parent } from '../types';

// Actions for hour-based scheduling
type AppAction =
  | { type: 'SET_SELECTED_TASK'; taskId: string | null, toggle_parent: string | null }
  | { type: 'SET_SELECTED_PARENT'; parentId: string | null }
  | { type: 'UPDATE_TASK_PARENT'; taskId: string; newParentId: string | null }
  | { type: 'UPDATE_TASK_HOURS'; taskId: string; startHour: number; durationHours: number }
  | { type: 'SET_DRAGGING_UNASSIGNED_TASK'; taskId: string | null }
  | { type: 'SET_DRAGGING_GANTT_TASK'; taskId: string | null }
  | { type: 'SET_PERIOD_CONFIG'; periods: string[]; periodLengthHours: number }
  | { type: 'ADD_TASKS'; tasks: Task[] }
  | { type: 'IMPORT_TASKS'; tasks: Task[] }
  | { type: 'ADD_PARENTS'; parents: Parent[] }
  | { type: 'IMPORT_TASKS_WITH_CONFLICTS'; tasks: Task[]; conflictedTasks: Task[]; newParents: Parent[] };

const defaultPeriods = [
  'P1','P2','P3','P4','P5','P6','P7','P8','P9','P10','P11','P12','P13'
];
const defaultPeriodLen = 40; 

const initialState: AppState = {
  tasks: [
    {
      id: 'T01',
      name: 'T01',
      parentId: 'R01',
      startHour: 40,
      durationHours: 40,
      setup: 20,
      location: { lat: 45.5017, lon: -73.5673 },
      dependencies: [],
    },
    {
      id: 'T02',
      name: 'T02',
      parentId: 'R01',
      startHour: 80,
      durationHours: 40,
      setup: 40,
      location: { lat: 45.5048, lon: -73.5698 },
      dependencies: [],
    },
    {
      id: 'T03',
      name: 'T03',
      parentId: 'R02',
      startHour: 40,
      durationHours: 120,
      setup: 20,
      location: { lat: 45.4995, lon: -73.5635 },
      dependencies: [],
    },
    {
      id: 'T04',
      name: 'T04',
      parentId: 'R02',
      startHour: 200,
      durationHours: 40,
      location: { lat: 45.5025, lon: -73.5711 },
      dependencies: [],
    },
    {
      id: 'T05',
      name: 'T05',
      parentId: 'R03',
      startHour: 80,
      durationHours: 120,
      location: { lat: 45.4978, lon: -73.5592 },
      dependencies: [],
    },
    {
      id: 'T06',
      name: 'T06',
      parentId: null,
      startHour: 240,
      durationHours: 40,
      location: { lat: 45.5089, lon: -73.5744 },
      dependencies: [],
    },
    {
      id: 'T07',
      name: 'T07',
      parentId: null,
      startHour: 280,
      durationHours: 40,
      location: { lat: 45.4956, lon: -73.5531 },
      dependencies: [],
    }
  ],
  parents: [
    { id: 'R01', name: 'R01', color: '#10B981' },
    { id: 'R02', name: 'R02', color: '#3B82F6' },
    { id: 'R03', name: 'R03', color: '#8B5CF6' }
  ],
  selectedTaskId: null,
  selectedParentId: 'all',
  draggingTaskId_unassigned: null,
  draggingTaskId_gantt: null,
  periods: defaultPeriods,
  periodLengthHours: defaultPeriodLen,
};

const AppContext = createContext<{
  state: AppState;
  dispatch: React.Dispatch<AppAction>;
} | null>(null);

function appReducer(state: AppState, action: AppAction): AppState {
  switch (action.type) {
    case 'SET_SELECTED_TASK':
      return { ...state, selectedTaskId: action.taskId, selectedParentId: action.toggle_parent };

    case 'SET_SELECTED_PARENT':
      return { ...state, selectedParentId: action.parentId };

    case 'UPDATE_TASK_PARENT': {
      const updatedTasks = state.tasks.map(task =>
        task.id === action.taskId
          ? { ...task, parentId: action.newParentId }
          : task
      );
      return {
        ...state,
        tasks: updatedTasks,
        selectedTaskId: action.newParentId === null ? null : state.selectedTaskId
      };
    }

    case 'UPDATE_TASK_HOURS': {
      const updatedTasks = state.tasks.map(task =>
        task.id === action.taskId
          ? { ...task, startHour: action.startHour, durationHours: action.durationHours }
          : task
      );
      return { ...state, tasks: updatedTasks };
    }

    case 'SET_DRAGGING_UNASSIGNED_TASK': {
      return { ...state, draggingTaskId_unassigned: action.taskId };
    }

    case 'SET_DRAGGING_GANTT_TASK': {
      return { ...state, draggingTaskId_gantt: action.taskId };
    }

    case 'SET_PERIOD_CONFIG': {
      return { ...state, periods: action.periods, periodLengthHours: action.periodLengthHours };
    }

    case 'ADD_TASKS':
      return { ...state, tasks: [...state.tasks, ...action.tasks] };

    case 'IMPORT_TASKS': {
      const existingIds = new Set(state.tasks.map(t => t.id));
      const newTasks = action.tasks.map((task) => {
        let newId = task.id;
        let counter = 1;
        while (existingIds.has(newId)) {
          newId = `${task.id}_${counter}`;
          counter++;
        }
        existingIds.add(newId);
        return { ...task, id: newId };
      });
      return { ...state, tasks: [...state.tasks, ...newTasks] };
    }

    case 'ADD_PARENTS':
      return { ...state, parents: [...state.parents, ...action.parents] };

    case 'IMPORT_TASKS_WITH_CONFLICTS': {
      const updatedParents = [...state.parents, ...action.newParents];
      const existingIds = new Set(state.tasks.map(t => t.id));
      const allNewTasks = [...action.tasks, ...action.conflictedTasks];
      const processedTasks = allNewTasks.map((task) => {
        let newId = task.id;
        let counter = 1;
        while (existingIds.has(newId)) {
          newId = `${task.id}_${counter}`;
          counter++;
        }
        existingIds.add(newId);
        return { ...task, id: newId };
      });
      return { ...state, tasks: [...state.tasks, ...processedTasks], parents: updatedParents };
    }

    default:
      return state;
  }
}

export function AppProvider({ children }: { children: ReactNode }) {
  const [state, dispatch] = useReducer(appReducer, initialState);

  return (
    <AppContext.Provider value={{ state, dispatch }}>
      {children}
    </AppContext.Provider>
  );
}

export function useApp() {
  const context = useContext(AppContext);
  if (!context) {
    throw new Error('useApp must be used within an AppProvider');
  }
  return context;
}
