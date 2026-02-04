
import { BrowserFactory } from './src/core/browser/factory_v2';
import { GeneticFingerprinter } from './src/core/browser/genetic_fingerprinter';

async function verify() {
    console.log('🧬 GENETIC VERIFICATION START');

    const factory = BrowserFactory.getInstance();

    try {
        console.log('1. Launching Page with Genetic Profile...');
        const page = await factory.newPage();

        // Check Gene ID
        const geneId = (page as any).__geneId;
        console.log(`2. Gene ID Attached: ${geneId ? '✅ YES (' + geneId + ')' : '❌ NO'}`);

        // Check UA
        const ua = await page.evaluate(() => navigator.userAgent);
        console.log(`3. Actual User Agent: ${ua}`);

        // Verify it matches one of our base UAs (rough check)
        if (ua.includes('Mozilla')) console.log('✅ UA looks valid');

        // Simulate Feedback
        if (geneId) {
            console.log('4. Reporting Success to Fingerprinter...');
            GeneticFingerprinter.getInstance().reportSuccess(geneId);
            const bestGene = GeneticFingerprinter.getInstance().getBestGene();
            console.log(`5. Best Gene Score after update: ${bestGene.score}`);
        }

        await factory.closePage(page);
        await factory.close();

    } catch (e) {
        console.error('❌ Verification Failed:', e);
    }
    console.log('🧬 GENETIC VERIFICATION END');
}

verify();
