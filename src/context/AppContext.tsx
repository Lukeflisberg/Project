import React, { createContext, useContext, useReducer, ReactNode } from 'react';
import { AppState, Task, Team, Period, Month, Resource, Demand, Distance, ProductionGoals, AssortmentsGraph, TransportCosts } from '../types';

// ----------------------
// Action Types for State
// ----------------------
// These actions cover all interactions with tasks, teams, periods, and drag-and-drop.
type AppAction =
  | { type: 'SET_SELECTED_TASK'; taskId: string | null, toggle_team: string | null }
  | { type: 'SET_SELECTED_TEAM'; teamId: string | null }
  | { type: 'SET_DRAGGING_FROM_GANTT'; taskId: string | null }
  | { type: 'SET_DRAGGING_TO_GANTT'; taskId: string | null }
  | { type: 'SET_TASKSNAPSHOT'; taskSnapshot: Task[] }

  | { type: 'SET_PERIODS'; periods: Period[] }
  | { type: 'SET_MONTHS'; months: Month[] }
  | { type: 'SET_PRODUCTION_GOALS'; productionGoals: ProductionGoals[] }
  | { type: 'SET_TOTAL_HOURS'; totalHours: number }
  | { type: 'SET_RESOURCES'; resources: Resource[] }
  | { type: 'SET_DEMAND'; demand: Demand[] }
  | { type: 'SET_ASSORTMENTS_GRAPH'; assortmentsGraph: AssortmentsGraph[] }
  | { type: 'SET_DISTANCES'; distances: Distance[] }
  | { type: 'SET_TASK_COLOR'; taskId: string, color: string }
  | { type: 'SET_TRANSPORT_COSTS'; transportCosts: TransportCosts[] }

  | { type: 'TOGGLE_NULL'; toggledNull: boolean }
  | { type: 'TOGGLE_UNASSIGN_DROP'; toggledDrop: boolean }
  | { type: 'TOGGLE_COMPARISON_MODAL'; toggledModal: boolean }

  | { type: 'UPDATE_TASK_TEAM'; taskId: string; newTeamId: string | null }
  | { type: 'UPDATE_TASK_HOURS'; taskId: string; startHour: number; defaultDuration: number }
  | { type: 'BATCH_UPDATE_TASK_HOURS'; updates: Array<{ taskId: string; startHour: number; defaultDuration: number }> }

  | { type: 'UPDATE_TASKS'; tasks: Task[] }
  | { type: 'UPDATE_TEAMS'; teams: Team[] }

  | { type: 'RESET_STATE' };
  
// ----------------------
// Initial Application State
// ----------------------
// Contains sample tasks, teams, periods, and drag/drop state.
const initialState: AppState = {
  selectedTaskId: null,
  selectedTeamId: 'all',
  dragging_from_gantt: null,
  dragging_to_gantt: null,
  totalHours: 0,
  defaultColor: "#5F8A8B",

  toggledNull: false,
  toggledDrop: false,
  toggledModal: false,

  tasks: [],
  teams: [],
  periods: [],
  months: [],
  resources: [],
  demand: [],
  distances: [],
  taskSnapshot: [],
  productionGoals: [],
  assortments_graph: [],
  transportCosts: [],
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
      return { ...state, selectedTaskId: action.taskId, selectedTeamId: action.toggle_team };

    case 'SET_SELECTED_TEAM':
      return { ...state, selectedTeamId: action.teamId };

    case 'SET_DRAGGING_FROM_GANTT': 
      return { ...state, dragging_from_gantt: action.taskId };

    case 'SET_DRAGGING_TO_GANTT': 
      return { ...state, dragging_to_gantt: action.taskId };    
    
    case 'SET_TASKSNAPSHOT':
      return { ...state, taskSnapshot: action.taskSnapshot}

    case 'SET_TOTAL_HOURS':
      return { ...state, totalHours: action.totalHours };

    case 'SET_PERIODS':
      return { ...state, periods: action.periods };
    
    case 'SET_MONTHS':
      return { ...state, months: action.months };

    case 'SET_PRODUCTION_GOALS':
      return { ...state, productionGoals: action.productionGoals };

    case 'SET_RESOURCES':
      return { ...state, resources: action.resources };

    case 'SET_DEMAND':
      return { ...state, demand: action.demand };

    case 'SET_ASSORTMENTS_GRAPH':
      return { ...state, assortments_graph: action.assortmentsGraph };

    case 'SET_DISTANCES':
      return { ...state, distances: action.distances };

    case 'SET_TASK_COLOR':
      const updatedTasks = state.tasks.map(task => 
        task.task.id === action.taskId
          ? { ...task, task: { ...task.task, color: action.color }}
          : task
      );
      return { ...state, tasks: updatedTasks}

    case 'SET_TRANSPORT_COSTS':
      return { ...state, transportCosts: action.transportCosts }


    case 'TOGGLE_NULL':
      return { ...state, toggledNull: action.toggledNull };

    case 'TOGGLE_UNASSIGN_DROP':
      return { ...state, toggledDrop: action.toggledDrop };

    case 'TOGGLE_COMPARISON_MODAL':
      return { ...state, toggledModal: action.toggledModal };


    case 'UPDATE_TASK_TEAM': {
      const updatedTasks = state.tasks.map(task =>
        task.task.id === action.taskId
          ? { ...task, duration: { ...task.duration, teamId: action.newTeamId } }
          : task
      );
      return {
        ...state,
        tasks: updatedTasks,
        selectedTaskId: action.newTeamId === null ? null : state.selectedTaskId
      };
    };

    case 'UPDATE_TASK_HOURS': {
      console.log('🔥 REDUCER: UPDATE_TASK_HOURS called for', action.taskId);
      const updatedTasks = state.tasks.map(task =>
        task.task.id === action.taskId
          ? { 
              ...task, 
              task: { ...task.task }, 
              duration: { 
                ...task.duration, 
                startHour: action.startHour, 
                defaultDuration: action.defaultDuration 
              } 
            }
          : task
      );

      return { ...state, tasks: updatedTasks };
    };

    case 'BATCH_UPDATE_TASK_HOURS': {
      console.log('🔥 REDUCER: BATCH_UPDATE_TASK_HOURS called with', action.updates.length, 'updates');
      
      // Create a Map for O(1) lookup of updates by taskId
      const updateMap = new Map(action.updates.map(u => [u.taskId, u]));
      
      // Map through all tasks and apply updates where they exist
      const updatedTasks = state.tasks.map(task => {
        const update = updateMap.get(task.task.id);
        if (update) {
          return {
            ...task,
            task: { ...task.task },
            duration: {
              ...task.duration,
              startHour: update.startHour,
              defaultDuration: update.defaultDuration
            }
          };
        }
        return task;
      });

      return { ...state, tasks: updatedTasks };
    };

    
    case 'UPDATE_TASKS':
      return { ...state, tasks: action.tasks };
    
    case 'UPDATE_TEAMS':
      return { ...state, teams: action.teams };

    case 'RESET_STATE':
      return { ...state, tasks: [], teams: [], periods: [] }

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
