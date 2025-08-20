import React, { createContext, useContext, useReducer, ReactNode } from 'react';
import { AppState, Task, Parent, DragData } from '../types';

type AppAction =
  | { type: 'SET_SELECTED_TASK'; taskId: string | null, toggle_parent: string | null }
  | { type: 'SET_SELECTED_PARENT'; parentId: string | null }
  | { type: 'START_DRAG'; dragData: DragData }
  | { type: 'END_DRAG' }
  | { type: 'UPDATE_TASK_PARENT'; taskId: string; newParentId: string | null }
  | { type: 'UPDATE_TASK_DATES'; taskId: string; startDate: Date; endDate: Date }
  | { type: 'SET_DRAGGING_TASK'; taskId: string | null; isDragging: boolean };

const initialState: AppState = {
  tasks: [
    {
      id: 'task1',
      name: 'Site Survey',
      parentId: 'group1',
      startDate: new Date(2025, 0, 15),
      endDate: new Date(2025, 0, 18),
      location: { lat: 45.5017, lon: -73.5673 },
      dependencies: [],
      status: 'completed'
    },
    {
      id: 'task2',
      name: 'Equipment Setup',
      parentId: 'group1',
      startDate: new Date(2025, 0, 19),
      endDate: new Date(2025, 0, 22),
      location: { lat: 45.5048, lon: -73.5698 },
      dependencies: ['task1'],
      status: 'in-progress'
    },
    {
      id: 'task3',
      name: 'Tree Harvesting',
      parentId: 'group2',
      startDate: new Date(2025, 0, 16),
      endDate: new Date(2025, 0, 25),
      location: { lat: 45.4995, lon: -73.5635 },
      dependencies: [],
      status: 'in-progress'
    },
    {
      id: 'task4',
      name: 'Transport Logistics',
      parentId: 'group2',
      startDate: new Date(2025, 0, 26),
      endDate: new Date(2025, 0, 28),
      location: { lat: 45.5025, lon: -73.5711 },
      dependencies: ['task3'],
      status: 'pending'
    },
    {
      id: 'task5',
      name: 'Reforestation Planning',
      parentId: 'group3',
      startDate: new Date(2025, 0, 20),
      endDate: new Date(2025, 0, 30),
      location: { lat: 45.4978, lon: -73.5592 },
      dependencies: [],
      status: 'pending'
    },
    {
      id: 'task6',
      name: 'Environmental Assessment',
      parentId: null,
      startDate: new Date(2025, 1, 1),
      endDate: new Date(2025, 1, 5),
      location: { lat: 45.5089, lon: -73.5744 },
      dependencies: [],
      status: 'pending'
    },
    {
      id: 'task7',
      name: 'Soil Analysis',
      parentId: null,
      startDate: new Date(2025, 1, 6),
      endDate: new Date(2025, 1, 10),
      location: { lat: 45.4956, lon: -73.5531 },
      dependencies: ['task6'],
      status: 'pending'
    }
  ],
  parents: [
    { id: 'group1', name: 'Site Preparation Team', color: '#10B981' },
    { id: 'group2', name: 'Harvesting Crew', color: '#3B82F6' },
    { id: 'group3', name: 'Conservation Unit', color: '#8B5CF6' }
  ],
  selectedTaskId: null,
  selectedParentId: 'all',
  dragData: null,
  draggingTaskId: null
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
    
    case 'START_DRAG':
      return { ...state, dragData: action.dragData };
    
    case 'END_DRAG':
      return { ...state, dragData: null };
    
    case 'UPDATE_TASK_PARENT': {
      const updatedTasks = state.tasks.map(task => 
        task.id === action.taskId 
          ? { ...task, parentId: action.newParentId }
          : task
      );
      return { ...state, tasks: updatedTasks };
    }
    
    case 'UPDATE_TASK_DATES': {
      const updatedTasks = state.tasks.map(task =>
        task.id === action.taskId
          ? { ...task, startDate: action.startDate, endDate: action.endDate }
          : task
      );
      return { ...state, tasks: updatedTasks };
    }

    case 'SET_DRAGGING_TASK': {
      return { ...state, draggingTaskId: action.isDragging ? action.taskId : null };
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