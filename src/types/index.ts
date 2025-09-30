export interface Task {
  id: string;
  name: string;
  parentId: string | null; 
  startHour: number;       
  durationHours: number;   
  setup: number;        
  specialTeams?: Record<string, number | 'x'>;
  invalidPeriods?: string[];
  location: {
    lat: number;
    lon: number;
  };
  
  distance?: number, 
  dependencies?: string[]; 
}

export interface Parent {
  id: string;
  name: string;
  color: string;
}

export interface Period {
  id: string;
  name: string;
  length_hrs: number;
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
  totalHours: number | null;   
  
  toggledNull: boolean;
  toggledDrop: boolean;

  tasks: Task[];
  parents: Parent[];
  periods: Period[];  
}