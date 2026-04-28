import * as path from 'path';
import { runCampaignProgrammatic, CampaignResult } from '../../scraper/generate_campaign_v2';
import { PROVINCE_CODES, PROVINCE_NAME_TO_CODE } from '../../scraper/data/pg_categories';
import { AgentScraperRequest, AgentStats } from '../agent_contracts';
import { RunPaths } from '../agent_artifacts';

export interface CampaignBackendOutput {
  csvPath?: string;
  stats: AgentStats;
  result: CampaignResult;
}

export type CampaignRunner = (
  opts: Parameters<typeof runCampaignProgrammatic>[0]
) => Promise<CampaignResult>;

function resolveProvinceCodes(req: AgentScraperRequest): string[] {
  const collected: string[] = [];
  if (req.provinces && req.provinces.length > 0) {
    collected.push(...req.provinces);
  } else if (req.zone) {
    collected.push(req.zone);
  }
  if (collected.length === 0) {
    throw new Error("Campaign mode requires 'provinces' or 'zone'");
  }

  return collected.map((raw) => {
    const trimmed = raw.trim();
    if (trimmed.length <= 3 && PROVINCE_CODES[trimmed.toUpperCase()]) {
      return trimmed.toUpperCase();
    }
    const fromName = PROVINCE_NAME_TO_CODE[trimmed.toLowerCase()];
    if (fromName) return fromName;
    return trimmed.toUpperCase();
  });
}

export async function runCampaign(
  req: AgentScraperRequest,
  paths: RunPaths,
  runner: CampaignRunner = runCampaignProgrammatic
): Promise<CampaignBackendOutput> {
  if (!req.sector) {
    throw new Error("Campaign mode requires 'sector'");
  }
  const provinceCodes = resolveProvinceCodes(req);

  const result = await runner({
    query: req.sector,
    provinceCodes,
    resume: false,
    checkpointFile: path.join(paths.runDir, 'campaign_INTERIM_CHECKPOINT.csv'),
    limit: req.limit,
    includeImmobiliare: /immobil/i.test(req.sector),
    outputDir: paths.runDir,
  });

  const stats: AgentStats = {
    loaded: 0,
    discovered: result.count,
    enriched: 0,
    failed: result.droppedInvalid + result.droppedLowSignal,
  };

  return {
    csvPath: result.combinedCsv,
    stats,
    result,
  };
}
