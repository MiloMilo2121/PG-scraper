import { BilancioHunter } from '../../../foundation/BilancioHunter';
import { EnrichmentPostProcessor } from '../../../foundation/EnrichmentPostProcessor';
import { NormalizedInput } from '../../../foundation/InputNormalizer';
import { LinkedInSniper } from '../../../foundation/LinkedInSniper';
import { PecHunter } from '../../../foundation/PecHunter';
import { HunterClient } from '../../utils/hunter_client';
import { ContactEnrichmentStage } from './contact_enrichment_stage';
import { DecisionMakerStage } from './decision_maker_stage';
import { EmployeeEnrichmentStage } from './employee_enrichment_stage';
import { FinancialEnrichmentStage } from './financial_enrichment_stage';
import { RuntimeStageOutcome } from './stage_types';

export interface PostDiscoveryEnrichmentResult {
  financial: any;
  decisionMaker: any;
  employees: string | null;
  isEstimatedEmployees: boolean;
  vat: string | null;
  pec: string | null;
  email: string | null;
  stageOutcomes: Record<string, RuntimeStageOutcome>;
}

export class PostDiscoveryEnrichmentStage {
  private readonly financialStage: FinancialEnrichmentStage;
  private readonly decisionMakerStage: DecisionMakerStage;
  private readonly employeeStage: EmployeeEnrichmentStage;
  private readonly contactStage: ContactEnrichmentStage;

  constructor(deps: {
    bilancioHunter: BilancioHunter;
    linkedinSniper: LinkedInSniper;
    postProcessor: EnrichmentPostProcessor;
    pecHunter: PecHunter;
    hunterClient?: HunterClient;
  }) {
    this.financialStage = new FinancialEnrichmentStage(deps.bilancioHunter);
    this.decisionMakerStage = new DecisionMakerStage(deps.linkedinSniper);
    this.employeeStage = new EmployeeEnrichmentStage(deps.postProcessor);
    this.contactStage = new ContactEnrichmentStage(deps.pecHunter, deps.hunterClient);
  }

  public async run(companyId: string, input: NormalizedInput, discoveredUrl: string | null): Promise<PostDiscoveryEnrichmentResult> {
    const [financialStage, decisionMakerStage, employeeStage, contactStage] = await Promise.all([
      this.financialStage.run(companyId, input),
      this.decisionMakerStage.run(companyId, input, discoveredUrl),
      this.employeeStage.run(companyId, input, discoveredUrl),
      this.contactStage.run(companyId, input, discoveredUrl),
    ]);

    let employees = financialStage.employees;
    let isEstimatedEmployees = financialStage.isEstimatedEmployees;

    if (!employees && employeeStage.employees) {
      employees = employeeStage.employees;
      isEstimatedEmployees = employeeStage.isEstimatedEmployees;
    }

    return {
      financial: financialStage.financial,
      decisionMaker: decisionMakerStage.decisionMaker,
      employees,
      isEstimatedEmployees,
      vat: financialStage.vat,
      pec: contactStage.pec,
      email: contactStage.email,
      stageOutcomes: {
        financial: financialStage.outcome,
        decision_maker: decisionMakerStage.outcome,
        employee_estimation: employeeStage.outcome,
        contacts: contactStage.outcome,
      },
    };
  }
}
