export interface Period {
  id: string;
  name: string;
  length_h: number;
}

export interface Month {
  monthId: string;
  periods: Period[];
}

export interface Task {
  duration: Task.Duration;
  task: Task.TaskDetails;
}

export namespace Task {
  export interface Duration {
    fixedCost: number;
    costPerHrs: number,
    defaultSetup: number;
    defaultDuration: number;
    specialTeams: Record<string, number | 'X'>;
    
    invalidPeriods?: string[];

    teamId: string | null;
    startHour: number;
  }

  export interface TaskDetails {
    id: string;
    lat: number;
    lon: number;
    avvForm: string;
    barighet: string;
  }
}

export interface Team {
  id: string;
  lat: number;
  lon: number;
  maxWheelingDist_km: number;
  color: string;
}

export interface DragData {
  taskId: string;
  sourceTeamId: string | null;
  sourceIndex: number;
}

export interface AppState {
  selectedTaskId: string | null;
  selectedTeamId: string | null;
  dragging_from_gantt: string | null;
  dragging_to_gantt: string | null; 
  totalHours: number;   
  
  toggledNull: boolean;
  toggledDrop: boolean;

  tasks: Task[];
  teams: Team[];
  periods: Period[];  
  months: Month[];
}