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

export interface Production {
  activity: string,
  gtk: string,
  gtn: string,
  ttk: string,
  ttn: string,
  asp: string,
  bmb: string,
  brv: string,
  gm: string,
  grot: string,
  lm: string,
  lt: string
}

export interface Productivity {
  activity: string,
  p1: string,
  p2: string,
  p3: string,
  p4: string,
  p5: string,
  p6: string,
  p7: string,
  p8: string,
  p9: string,
  p10: string,
  p11: string,
  p12: string,
  p13: string,
  p14: string,
  p15: string,
  p16: string
}

export interface Resource {
  resource: string,
  costPerHrs: number,
  hrsPerWeek: number,
  p1: number,
  p2: number,
  p3: number,
  p4: number,
  p5: number,
  p6: number,
  p7: number,
  p8: number,
  p9: number,
  p10: number,
  p11: number,
  p12: number,
  p13: number,
  p14: number,
  p15: number,
  p16: number
}

export interface Demand {
  product: string,
  per_m3 : number,
  demand: number,
  p1: number,
  p2: number,
  p3: number,
  p4: number,
  p5: number,
  p6: number,
  p7: number,
  p8: number,
  p9: number,
  p10: number,
  p11: number,
  p12: number,
  p13: number,
  p14: number,
  p15: number,
  p16: number
}

export interface Distances {
  fromTo: string,
  [key: `T${string}`]: number;
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