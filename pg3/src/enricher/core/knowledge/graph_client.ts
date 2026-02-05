
import neo4j, { Driver, Session } from 'neo4j-driver';
import { config } from '../../config';
import { Logger } from '../../utils/logger';
import { CompanyInput } from '../../types';

export class GraphClient {
    private static instance: GraphClient;
    private driver: Driver;

    private constructor() {
        this.driver = neo4j.driver(
            config.neo4j.uri,
            neo4j.auth.basic(config.neo4j.user, config.neo4j.password)
        );
    }

    public static getInstance(): GraphClient {
        if (!GraphClient.instance) {
            GraphClient.instance = new GraphClient();
        }
        return GraphClient.instance;
    }

    public async close() {
        await this.driver.close();
    }

    /**
     * Merge a company into the graph.
     * Upserts the Company node and links it to P.IVA, Phone, and Email nodes.
     * This automatically resolves entities: different companies sharing a P.IVA will link to the same P.IVA node.
     */
    public async mergeCompany(company: CompanyInput) {
        const session = this.driver.session();
        try {
            await session.executeWrite(async (tx: any) => {
                // 1. Merge Company Node
                await tx.run(`
                    MERGE (c:Company { name: $name })
                    ON CREATE SET c.created_at = timestamp()
                    SET c.last_seen = timestamp(),
                        c.address = $address,
                        c.city = $city
                `, {
                    name: company.company_name,
                    address: company.address || '',
                    city: company.city || ''
                });

                // 2. Link P.IVA (The Strong Identifier)
                const piva = company.piva || company.vat_code;
                if (piva) {
                    await tx.run(`
                        MATCH (c:Company { name: $name })
                        MERGE (p:PIVA { code: $piva })
                        MERGE (c)-[:IDENTIFIED_BY]->(p)
                    `, { name: company.company_name, piva });
                }

                // 3. Link Phone
                if (company.phone) {
                    await tx.run(`
                        MATCH (c:Company { name: $name })
                        MERGE (ph:Phone { number: $phone })
                        MERGE (c)-[:HAS_CONTACT]->(ph)
                    `, { name: company.company_name, phone: company.phone });
                }

                // 4. Link Email
                if (company.email) {
                    await tx.run(`
                        MATCH (c:Company { name: $name })
                        MERGE (e:Email { address: $email })
                        MERGE (c)-[:HAS_CONTACT]->(e)
                    `, { name: company.company_name, email: company.email });
                }

                // 5. Link Website
                if (company.website) {
                    await tx.run(`
                        MATCH (c:Company { name: $name })
                        MERGE (w:Website { url: $url })
                        MERGE (c)-[:OWNS_SITE]->(w)
                    `, { name: company.company_name, url: company.website });
                }
            });
            Logger.info(`[Graph] 🕸️ Merged company "${company.company_name}" into Knowledge Graph.`);
        } catch (error) {
            Logger.error(`[Graph] Failed to merge company ${company.company_name}`, { error: error as Error });
        } finally {
            await session.close();
        }
    }
}
