import React, { createContext, useContext, useReducer, ReactNode } from 'react';
import { AppState, Task, Parent, PeriodLength } from '../types';

// ----------------------
// Action Types for State
// ----------------------
// These actions cover all interactions with tasks, parents, periods, and drag-and-drop.
type AppAction =
  | { type: 'SET_SELECTED_TASK'; taskId: string | null, toggle_parent: string | null }
  | { type: 'SET_SELECTED_PARENT'; parentId: string | null }
  | { type: 'TOGGLE_NULL'; toggledNull: boolean }
  | { type: 'UPDATE_TASK_PARENT'; taskId: string; newParentId: string | null }
  | { type: 'UPDATE_TASK_HOURS'; taskId: string; startHour: number; durationHours: number }
  | { type: 'SET_DRAGGING_UNASSIGNED_TASK'; taskId: string | null }
  | { type: 'SET_DRAGGING_GANTT_TASK'; taskId: string | null }
  | { type: 'SET_PERIOD_LENGTHS'; period_lengths: Array<PeriodLength>}
  | { type: 'ADD_TASKS'; tasks: Task[] }
  | { type: 'ADD_PARENTS'; parents: Parent[] }
  | { type: 'SET_PERIODS'; periods: string[] };

// ----------------------
// Initial Application State
// ----------------------
// Contains sample tasks, parents, periods, and drag/drop state.
const initialState: AppState = {
  tasks: [],
  parents: [],
  totalHours: null,
  selectedTaskId: null,
  selectedParentId: 'all',
  toggledNull: false,
  draggingTaskId_unassigned: null,
  draggingTaskId_gantt: null,
  periods: [],
  period_lengths: [],
};

// ----------------------
// Context Setup
// ----------------------
// Provides state and dispatch to all components in the app.
const AppContext = createContext<{
  state: AppState;
  dispatch: React.Dispatch<AppAction>;
} | null>(null);

// ----------------------
// Reducer Function
// ----------------------
// Handles all state transitions based on dispatched actions.
function appReducer(state: AppState, action: AppAction): AppState {
  switch (action.type) {
    case 'SET_SELECTED_TASK':
      return { ...state, selectedTaskId: action.taskId, selectedParentId: action.toggle_parent };

    case 'SET_SELECTED_PARENT':
      return { ...state, selectedParentId: action.parentId };

    case 'TOGGLE_NULL':
      return { ...state, toggledNull: action.toggledNull };

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
    };

    case 'UPDATE_TASK_HOURS': {
      const updatedTasks = state.tasks.map(task =>
        task.id === action.taskId
          ? { ...task, startHour: action.startHour, durationHours: action.durationHours }
          : task
      );
      return { ...state, tasks: updatedTasks };
    };

    case 'SET_DRAGGING_UNASSIGNED_TASK': 
      return { ...state, draggingTaskId_unassigned: action.taskId };

    case 'SET_DRAGGING_GANTT_TASK': 
      return { ...state, draggingTaskId_gantt: action.taskId };

    case 'SET_PERIOD_LENGTHS': 
      return { ...state, period_lengths: action.period_lengths };

    case 'ADD_TASKS':
      return { ...state, tasks: [...state.tasks, ...action.tasks] };
    
      case 'ADD_PARENTS':
      return { ...state, parents: [...state.parents, ...action.parents] };

    case 'SET_PERIODS':
      return { ...state, periods: action.periods };

    default:
      return state;
  }
}

// ----------------------
// AppProvider Component
// ----------------------
// Wraps the app and provides state/context to all children.
export function AppProvider({ children }: { children: ReactNode }) {
  const [state, dispatch] = useReducer(appReducer, initialState);

  return (
    <AppContext.Provider value={{ state, dispatch }}>
      {children}
    </AppContext.Provider>
  );
}

// ----------------------
// useApp Custom Hook
// ----------------------
// Allows easy access to app state and dispatch in any component.
export function useApp() {
  const context = useContext(AppContext);
  if (!context) {
    throw new Error('useApp must be used within an AppProvider');
  }
  return context;
}
