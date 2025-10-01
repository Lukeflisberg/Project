import React, { createContext, useContext, useReducer, ReactNode } from 'react';
import { AppState, Task, Parent, Period } from '../types';

// ----------------------
// Action Types for State
// ----------------------
// These actions cover all interactions with tasks, parents, periods, and drag-and-drop.
type AppAction =
  | { type: 'SET_SELECTED_TASK'; taskId: string | null, toggle_parent: string | null }
  | { type: 'SET_SELECTED_PARENT'; parentId: string | null }
  | { type: 'SET_DRAGGING_FROM_GANTT'; taskId: string | null }
  | { type: 'SET_DRAGGING_TO_GANTT'; taskId: string | null }
  | { type: 'SET_PERIODS'; periods: Period[]}
  | { type: 'SET_TOTAL_HOURS'; totalHours: number }
  
  | { type: 'TOGGLE_NULL'; toggledNull: boolean }
  | { type: 'TOGGLE_UNASSIGN_DROP'; toggledDrop: boolean}

  | { type: 'UPDATE_TASK_PARENT'; taskId: string; newParentId: string | null }
  | { type: 'UPDATE_TASK_HOURS'; taskId: string; startHour: number; defaultDuration: number }

  | { type: 'ADD_TASKS'; tasks: Task[] }
  | { type: 'ADD_PARENTS'; parents: Parent[] };
  
// ----------------------
// Initial Application State
// ----------------------
// Contains sample tasks, parents, periods, and drag/drop state.
const initialState: AppState = {
  selectedTaskId: null,
  selectedParentId: 'all',
  dragging_from_gantt: null,
  dragging_to_gantt: null,
  totalHours: 0,

  toggledNull: false,
  toggledDrop: false,

  tasks: [],
  parents: [],
  periods: [],
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

    case 'SET_DRAGGING_FROM_GANTT': 
      return { ...state, dragging_from_gantt: action.taskId };

    case 'SET_DRAGGING_TO_GANTT': 
      return { ...state, dragging_to_gantt: action.taskId };    

    case 'SET_TOTAL_HOURS':
      return { ...state, totalHours: action.totalHours };

    case 'SET_PERIODS':
      return { ...state, periods: action.periods };



    case 'TOGGLE_NULL':
      return { ...state, toggledNull: action.toggledNull };

    case 'TOGGLE_UNASSIGN_DROP':
      return { ...state, toggledDrop: action.toggledDrop };



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
          ? { ...task, startHour: action.startHour, defaultDuration: action.defaultDuration }
          : task
      );
      return { ...state, tasks: updatedTasks };
    };


    
    case 'ADD_TASKS':
      return { ...state, tasks: [...state.tasks, ...action.tasks] };
    
    case 'ADD_PARENTS':
      return { ...state, parents: [...state.parents, ...action.parents] };

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
