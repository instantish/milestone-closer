
export interface Issue {
  title: string;
  number: number;
  updated_at: string;
  labels: Label[];
  pull_request: any;
  state: string;
  locked: boolean;
}

export interface Milestone {
  id: number;
  title: string;
  number: number;
  updated_at: string;
  description: string;
  open_issues: number;
  closed_issues: number;
  state: string;
}

export interface ActionEvent {
  id: number;
  event: string;
  node_id: string;
  commit_id: string;
  created_at: string;
}

export interface Label {
  name: string;
}

export interface MilestoneProcessorOptions {
  repoToken: string;
  minimumIssues: number;
  relatedOnly: boolean;
  relatedActive: boolean;
  reopenActive: boolean;
  debugOnly: boolean;
}