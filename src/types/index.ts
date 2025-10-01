export interface Task {
  id: string;
  parentId: string | null; 
  startHour: number;    
  defaultSetup: number;    
  defaultDuration: number;   
  specialParents: Record<string, number | 'X'>;
  invalidPeriods?: string[];
  location: {
    lat: number;
    lon: number;
  };
}

export interface Parent {
  id: string;
  name: string;
  color: string;
}

export interface Period {
  id: string;
  name: string;
  length_h: number;
}

export interface DragData {
  taskId: string;
  sourceParentId: string | null;
  sourceIndex: number;
}

export interface AppState {
  selectedTaskId: string | null;
  selectedParentId: string | null;
  dragging_from_gantt: string | null;
  dragging_to_gantt: string | null; 
  totalHours: number;   
  
  toggledNull: boolean;
  toggledDrop: boolean;

  tasks: Task[];
  parents: Parent[];
  periods: Period[];  
}