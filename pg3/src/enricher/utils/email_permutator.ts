/**
 * 📧 EMAIL PERMUTATION & VALIDATION
 * Task 44: Generate and validate email combinations
 */

import * as dns from 'dns';
import * as net from 'net';
import { Logger } from './logger';

export interface EmailCandidate {
    email: string;
    pattern: string;
    valid: boolean;
    confidence: number;
}

export class EmailPermutator {
    /**
     * Generate email permutations from name and domain
     */
    static generatePermutations(
        firstName: string,
        lastName: string,
        domain: string
    ): string[] {
        const f = firstName.toLowerCase().trim();
        const l = lastName.toLowerCase().trim();
        const fi = f[0] || '';
        const li = l[0] || '';

        return [
            `${f}.${l}@${domain}`,           // mario.rossi@
            `${f}${l}@${domain}`,            // mariorossi@
            `${fi}.${l}@${domain}`,          // m.rossi@
            `${fi}${l}@${domain}`,           // mrossi@
            `${f}.${li}@${domain}`,          // mario.r@
            `${l}.${f}@${domain}`,           // rossi.mario@
            `${l}${f}@${domain}`,            // rossimario@
            `${f}@${domain}`,                // mario@
            `${l}@${domain}`,                // rossi@
            `${f}_${l}@${domain}`,           // mario_rossi@
            `${f}-${l}@${domain}`,           // mario-rossi@
        ].filter(e => e.includes('@'));
    }

    /**
     * Check if email domain has MX records
     */
    static async checkMX(domain: string): Promise<boolean> {
        return new Promise((resolve) => {
            dns.resolveMx(domain, (err, addresses) => {
                resolve(!err && addresses && addresses.length > 0);
            });
        });
    }

    /**
     * Light SMTP validation (check if server accepts RCPT TO)
     * Note: Many servers reject this check, so false negatives are common
     */
    static async validateSMTP(email: string): Promise<{
        valid: boolean;
        accepted: boolean;
        error?: string;
    }> {
        const domain = email.split('@')[1];

        return new Promise(async (resolve) => {
            try {
                // First check MX
                const hasMX = await this.checkMX(domain);
                if (!hasMX) {
                    resolve({ valid: false, accepted: false, error: 'No MX records' });
                    return;
                }

                // Get MX records
                dns.resolveMx(domain, (err, addresses) => {
                    if (err || !addresses?.length) {
                        resolve({ valid: false, accepted: false, error: 'MX lookup failed' });
                        return;
                    }

                    // Sort by priority
                    const mx = addresses.sort((a, b) => a.priority - b.priority)[0].exchange;

                    const socket = net.createConnection(25, mx);
                    let step = 0;
                    let responseBuffer = '';

                    socket.setTimeout(5000);

                    socket.on('data', (data) => {
                        responseBuffer += data.toString();

                        if (step === 0 && responseBuffer.includes('220')) {
                            socket.write(`HELO verificator.local\r\n`);
                            step = 1;
                        } else if (step === 1 && responseBuffer.includes('250')) {
                            socket.write(`MAIL FROM:<verify@verificator.local>\r\n`);
                            step = 2;
                        } else if (step === 2 && responseBuffer.includes('250')) {
                            socket.write(`RCPT TO:<${email}>\r\n`);
                            step = 3;
                        } else if (step === 3) {
                            socket.write(`QUIT\r\n`);
                            const accepted = responseBuffer.includes('250');
                            socket.end();
                            resolve({ valid: true, accepted });
                        }
                    });

                    socket.on('timeout', () => {
                        socket.destroy();
                        resolve({ valid: false, accepted: false, error: 'Timeout' });
                    });

                    socket.on('error', (e) => {
                        socket.destroy();
                        resolve({ valid: false, accepted: false, error: e.message });
                    });
                });
            } catch (e) {
                resolve({ valid: false, accepted: false, error: (e as Error).message });
            }
        });
    }

    /**
     * Find valid emails for a person at a company
     */
    static async findEmails(
        firstName: string,
        lastName: string,
        domain: string,
        validateSmtp: boolean = false
    ): Promise<EmailCandidate[]> {
        const permutations = this.generatePermutations(firstName, lastName, domain);
        const results: EmailCandidate[] = [];

        // Check domain has MX
        const hasMX = await this.checkMX(domain);
        if (!hasMX) {
            Logger.warn(`Domain ${domain} has no MX records`);
            return permutations.map(email => ({
                email,
                pattern: email.replace(firstName.toLowerCase(), '{f}').replace(lastName.toLowerCase(), '{l}'),
                valid: false,
                confidence: 0,
            }));
        }

        for (const email of permutations) {
            let valid = true;
            let confidence = 0.5; // Base confidence for valid domain

            if (validateSmtp) {
                const smtpResult = await this.validateSMTP(email);
                valid = smtpResult.valid;
                confidence = smtpResult.accepted ? 0.9 : 0.3;
            }

            results.push({
                email,
                pattern: email.replace(firstName.toLowerCase(), '{f}').replace(lastName.toLowerCase(), '{l}'),
                valid,
                confidence,
            });
        }

        return results.sort((a, b) => b.confidence - a.confidence);
    }
}
