
export class DataSanitizer {
    public static sanitize(company: any): any {
        // Empty Fields
        for (const key in company) {
            if (company[key] === null || company[key] === undefined || company[key] === '') {
                delete company[key]; // Or set to default
            }
        }

        // Encoding Fixes (Simple replacement for common issues)
        if (typeof company.company_name === 'string') {
            company.company_name = company.company_name.replace(/Ã¨/g, 'è').replace(/Ã©/g, 'é');
        }

        // Category Consistency
        if (company.category) {
            company.category = company.category.toUpperCase().trim();
        }

        return company;
    }
}
