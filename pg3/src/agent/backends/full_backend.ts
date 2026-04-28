import { AgentScraperRequest, AgentStats, mergeStats } from '../agent_contracts';
import { RunPaths } from '../agent_artifacts';
import {
  runCampaign,
  CampaignBackendOutput,
  CampaignRunner,
} from './campaign_backend';
import {
  runEnrichment,
  EnrichmentBackendOutput,
  EnrichmentRunner,
} from './enrichment_backend';

export interface FullBackendOutput {
  campaign: CampaignBackendOutput;
  enrichment?: EnrichmentBackendOutput;
  stats: AgentStats;
  inputCsv?: string;
  outputCsv?: string;
}

export interface FullBackendDeps {
  campaignRunner?: CampaignRunner;
  enrichmentRunner?: EnrichmentRunner;
}

export async function runFull(
  req: AgentScraperRequest,
  paths: RunPaths,
  deps: FullBackendDeps = {}
): Promise<FullBackendOutput> {
  const campaign = await runCampaign(req, paths, deps.campaignRunner);

  if (!campaign.csvPath) {
    return {
      campaign,
      stats: campaign.stats,
      outputCsv: campaign.csvPath,
    };
  }

  const enrichment = await runEnrichment(
    req,
    paths,
    deps.enrichmentRunner,
    campaign.csvPath
  );

  return {
    campaign,
    enrichment,
    stats: mergeStats(campaign.stats, enrichment.stats),
    inputCsv: enrichment.inputCsv,
    outputCsv: campaign.csvPath,
  };
}
