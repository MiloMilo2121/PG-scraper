export type RuntimeStageStatus = 'success' | 'failed' | 'skipped' | 'not_found' | 'partial';

export type RuntimeStageEntityMatchStatus = 'matched' | 'semantic' | 'ambiguous' | 'wrong_entity' | 'unknown';

export interface RuntimeStageOutcome {
  stage: string;
  status: RuntimeStageStatus;
  duration_ms: number;
  error?: string;
  detail?: string;
  reason_code?: string;
  confidence?: number;
  provider?: string;
  source_url?: string;
  attempted_count?: number;
  evidence_count?: number;
  entity_match_status?: RuntimeStageEntityMatchStatus;
}
