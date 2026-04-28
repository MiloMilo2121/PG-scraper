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

const REGION_TO_PROVINCES: Record<string, string[]> = {
  abruzzo: ['AQ', 'CH', 'PE', 'TE'],
  basilicata: ['MT', 'PZ'],
  calabria: ['CZ', 'CS', 'KR', 'RC', 'VV'],
  campania: ['AV', 'BN', 'CE', 'NA', 'SA'],
  'emilia-romagna': ['BO', 'FE', 'FC', 'MO', 'PR', 'PC', 'RA', 'RE', 'RN'],
  'emilia romagna': ['BO', 'FE', 'FC', 'MO', 'PR', 'PC', 'RA', 'RE', 'RN'],
  'friuli-venezia giulia': ['GO', 'PN', 'TS', 'UD'],
  'friuli venezia giulia': ['GO', 'PN', 'TS', 'UD'],
  lazio: ['FR', 'LT', 'RI', 'RM', 'VT'],
  liguria: ['GE', 'IM', 'SP', 'SV'],
  lombardia: ['BG', 'BS', 'CO', 'CR', 'LC', 'LO', 'MN', 'MB', 'MI', 'PV', 'SO', 'VA'],
  marche: ['AN', 'AP', 'FM', 'MC', 'PU'],
  molise: ['CB', 'IS'],
  piemonte: ['AL', 'AT', 'BI', 'CN', 'NO', 'TO', 'VB', 'VC'],
  puglia: ['BA', 'BT', 'BR', 'FG', 'LE', 'TA'],
  sardegna: ['CA', 'NU', 'OR', 'SS', 'SU'],
  sicilia: ['AG', 'CL', 'CT', 'EN', 'ME', 'PA', 'RG', 'SR', 'TP'],
  toscana: ['AR', 'FI', 'GR', 'LI', 'LU', 'MS', 'PI', 'PT', 'PO', 'SI'],
  'trentino-alto adige': ['BZ', 'TN'],
  'trentino alto adige': ['BZ', 'TN'],
  umbria: ['PG', 'TR'],
  "valle d'aosta": ['AO'],
  'valle daosta': ['AO'],
  veneto: ['BL', 'PD', 'RO', 'TV', 'VE', 'VR', 'VI'],
};

function normalizeGeoKey(value: string): string {
  return value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[’']/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
}

function resolveProvinceToken(raw: string): string[] {
  const trimmed = raw.trim();
  const region = REGION_TO_PROVINCES[normalizeGeoKey(trimmed)];
  if (region) return region;

  if (trimmed.length <= 3 && PROVINCE_CODES[trimmed.toUpperCase()]) {
    return [trimmed.toUpperCase()];
  }
  const fromName = PROVINCE_NAME_TO_CODE[trimmed.toLowerCase()];
  if (fromName) return [fromName];
  return [trimmed.toUpperCase()];
}

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

  return Array.from(new Set(collected.flatMap(resolveProvinceToken)));
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
