
import { CompanyInput } from '../../company_types';
import { DomainGuesser } from '../../utils/domain_guesser';

export class DeduplicatorV2 {
    private seenPivas = new Set<string>();
    private seenDomains = new Set<string>();

    public isDuplicate(company: CompanyInput): boolean {
        // PIVA Check
        if (company.piva && this.seenPivas.has(company.piva)) return true;

        // Domain Check
        if (company.website) {
            const domain = DomainGuesser.cleanDomain(company.website);
            if (this.seenDomains.has(domain)) return true;
        }

        // Add
        if (company.piva) this.seenPivas.add(company.piva);
        if (company.website) {
            const domain = DomainGuesser.cleanDomain(company.website);
            this.seenDomains.add(domain);
        }

        return false;
    }
}
