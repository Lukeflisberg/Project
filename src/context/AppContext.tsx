import React, { createContext, useContext, useReducer, ReactNode } from 'react';
import { AppState, Task, Parent } from '../types';

type AppAction =
  | { type: 'SET_SELECTED_TASK'; taskId: string | null, toggle_parent: string | null }
  | { type: 'SET_SELECTED_PARENT'; parentId: string | null }
  | { type: 'UPDATE_TASK_PARENT'; taskId: string; newParentId: string | null }
  | { type: 'UPDATE_TASK_DATES'; taskId: string; startDate: Date; endDate: Date }
  | { type: 'SET_DRAGGING_UNASSIGNED_TASK'; taskId: string | null }
  | { type: 'SET_DRAGGING_GANTT_TASK'; taskId: string | null }
  | { type: 'SET_TIME_SCALE'; timeScale: 'days' | 'weeks' | 'months' | 'years' }
  | { type: 'SET_TIMELINE_START'; startDate: Date }
  | { type: 'ADD_TASKS'; tasks: Task[] }
  | { type: 'IMPORT_TASKS'; tasks: Task[] };

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
    },
    {
      id: 'task2',
      name: 'Equipment Setup',
      parentId: 'group1',
      startDate: new Date(2025, 0, 19),
      endDate: new Date(2025, 0, 22),
      location: { lat: 45.5048, lon: -73.5698 },
      dependencies: ['task1'],
    },
    {
      id: 'task3',
      name: 'Tree Harvesting',
      parentId: 'group2',
      startDate: new Date(2025, 0, 16),
      endDate: new Date(2025, 0, 25),
      location: { lat: 45.4995, lon: -73.5635 },
      dependencies: [],
    },
    {
      id: 'task4',
      name: 'Transport Logistics',
      parentId: 'group2',
      startDate: new Date(2025, 0, 26),
      endDate: new Date(2025, 0, 28),
      location: { lat: 45.5025, lon: -73.5711 },
      dependencies: ['task3'],
    },
    {
      id: 'task5',
      name: 'Reforestation Planning',
      parentId: 'group3',
      startDate: new Date(2025, 0, 20),
      endDate: new Date(2025, 0, 30),
      location: { lat: 45.4978, lon: -73.5592 },
      dependencies: [],
    },
    {
      id: 'task6',
      name: 'Environmental Assessment',
      parentId: null,
      startDate: new Date(2025, 1, 1),
      endDate: new Date(2025, 1, 5),
      location: { lat: 45.5089, lon: -73.5744 },
      dependencies: [],
    },
    {
      id: 'task7',
      name: 'Soil Analysis',
      parentId: null,
      startDate: new Date(2025, 1, 6),
      endDate: new Date(2025, 1, 10),
      location: { lat: 45.4956, lon: -73.5531 },
      dependencies: ['task6'],
    }
  ],
  parents: [
    { id: 'group1', name: 'Site Preparation Team', color: '#10B981' },
    { id: 'group2', name: 'Harvesting Crew', color: '#3B82F6' },
    { id: 'group3', name: 'Conservation Unit', color: '#8B5CF6' }
  ],
  selectedTaskId: null,
  selectedParentId: 'all',
  draggingTaskId_unassigned: null,
  draggingTaskId_gantt: null,
  timeScale: 'weeks',
  timelineStart: new Date(2025, 0, 1)
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
        // Clear selection if task was unassigned
        selectedTaskId: action.newParentId === null ? null : state.selectedTaskId
      };
    }
    
    case 'UPDATE_TASK_DATES': {
      const updatedTasks = state.tasks.map(task =>
        task.id === action.taskId
          ? { ...task, startDate: action.startDate, endDate: action.endDate }
          : task
      );
      return { ...state, tasks: updatedTasks };
    }

    case 'SET_DRAGGING_UNASSIGNED_TASK': {
      return { ...state, draggingTaskId_unassigned:  action.taskId };
    }

    case 'SET_DRAGGING_GANTT_TASK': {
      return { ...state, draggingTaskId_gantt: action.taskId };
    }

    case 'SET_TIME_SCALE':
      return { ...state, timeScale: action.timeScale };
    
    case 'SET_TIMELINE_START':
      return { ...state, timelineStart: action.startDate };

    case 'ADD_TASKS':
      return { ...state, tasks: [...state.tasks, ...action.tasks] };
    
    case 'IMPORT_TASKS': {
      // Add imported tasks to existing tasks, ensuring unique IDs
      const existingIds = new Set(state.tasks.map(t => t.id));
      const newTasks = action.tasks.map((task, index) => {
        let newId = task.id;
        let counter = 1;
        
        // Ensure unique ID
        while (existingIds.has(newId)) {
          newId = `${task.id}_${counter}`;
          counter++;
        }
        
        existingIds.add(newId);
        return { ...task, id: newId };
      });
      
      return { 
        ...state, 
        tasks: [...state.tasks, ...newTasks]
      };
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