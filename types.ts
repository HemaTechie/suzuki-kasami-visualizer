
export enum ProcessState {
  IDLE = 'IDLE',
  REQUESTING = 'REQUESTING',
  EXECUTING = 'EXECUTING',
}

export interface Token {
  queue: number[];
  lastSatisfied: number[]; // LN array
}

export interface Process {
  id: number;
  state: ProcessState;
  requestNumbers: number[]; // RN array
  hasToken: boolean;
}

export interface Message {
  id: string;
  from: number;
  to: number;
  type: 'REQUEST' | 'TOKEN';
  payload: any;
  progress: number; // 0 to 1
}

export interface SimulationState {
  processes: Process[];
  token: Token | null; // null if in flight
  messages: Message[];
  lastTokenHolder: number;
}
