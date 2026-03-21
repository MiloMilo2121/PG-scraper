export type RuntimeStageStatus = 'success' | 'failed' | 'skipped' | 'not_found';

export interface RuntimeStageOutcome {
  stage: string;
  status: RuntimeStageStatus;
  duration_ms: number;
  error?: string;
  detail?: string;
}
