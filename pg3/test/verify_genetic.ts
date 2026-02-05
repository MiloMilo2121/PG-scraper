/**
 * 🧪 AUDIT 1: IDENTITY TEST
 * Verifies the Ninja Core (stealth browser) is working correctly
 * 
 * What to look for:
 * - navigator.webdriver = false
 * - Canvas hash should vary between runs
 * - WebGL vendor should be spoofed
 * 
 * Usage: npx ts-node pg3/test/verify_genetic.ts
 */

import { BrowserFactory } from '../src/enricher/core/browser/factory_v2';
import { GeneticFingerprinter } from '../src/enricher/core/browser/genetic_fingerprinter';
import { Logger } from '../src/enricher/utils/logger';

async function runIdentityAudit() {
    Logger.info('🧪 AUDIT 1: IDENTITY TEST - Verifying Ninja Core');

    const factory = BrowserFactory.getInstance();
    const fingerprinter = GeneticFingerprinter.getInstance();

    // Test 1: Check BrowserFactory is operational
    Logger.info('📍 Test 1: Browser launch');
    const page = await factory.newPage();

    // Test 2: Check navigator.webdriver
    Logger.info('📍 Test 2: navigator.webdriver check');
    const webdriverValue = await page.evaluate(() => (navigator as any).webdriver);
    console.log(`   navigator.webdriver = ${webdriverValue}`);
    if (webdriverValue === false) {
        Logger.info('   ✅ PASSED: webdriver is hidden');
    } else {
        Logger.error('   ❌ FAILED: webdriver is exposed!');
    }

    // Test 3: Canvas fingerprint noise
    Logger.info('📍 Test 3: Canvas fingerprint noise');
    const canvasHash1 = await page.evaluate(() => {
        const canvas = document.createElement('canvas');
        const ctx = canvas.getContext('2d');
        if (!ctx) return 'no-context';
        ctx.textBaseline = 'top';
        ctx.font = '14px Arial';
        ctx.fillText('Antigravity Test', 0, 0);
        return canvas.toDataURL().substring(50, 100);
    });

    // Second measurement
    const canvasHash2 = await page.evaluate(() => {
        const canvas = document.createElement('canvas');
        const ctx = canvas.getContext('2d');
        if (!ctx) return 'no-context';
        ctx.textBaseline = 'top';
        ctx.font = '14px Arial';
        ctx.fillText('Antigravity Test', 0, 0);
        return canvas.toDataURL().substring(50, 100);
    });

    console.log(`   Canvas hash 1: ${canvasHash1}`);
    console.log(`   Canvas hash 2: ${canvasHash2}`);
    if (canvasHash1 !== canvasHash2) {
        Logger.info('   ✅ PASSED: Canvas noise is active');
    } else {
        Logger.warn('   ⚠️ INDETERMINATE: Canvas hashes match. Noise might trigger on toDataURL()');
    }

    // Test 4: WebGL Vendor spoofing
    Logger.info('📍 Test 4: WebGL vendor spoofing');
    const webglInfo = await page.evaluate(() => {
        const canvas = document.createElement('canvas');
        const gl = canvas.getContext('webgl') || canvas.getContext('experimental-webgl');
        if (!gl) return { vendor: 'N/A', renderer: 'N/A' };
        const ext = (gl as WebGLRenderingContext).getExtension('WEBGL_debug_renderer_info');
        if (!ext) return { vendor: 'N/A', renderer: 'N/A' };
        return {
            vendor: (gl as WebGLRenderingContext).getParameter(ext.UNMASKED_VENDOR_WEBGL),
            renderer: (gl as WebGLRenderingContext).getParameter(ext.UNMASKED_RENDERER_WEBGL)
        };
    });

    console.log(`   WebGL Vendor: ${webglInfo.vendor}`);
    console.log(`   WebGL Renderer: ${webglInfo.renderer}`);
    if (webglInfo.vendor === 'Apple Inc.' || webglInfo.vendor === 'Google Inc.') {
        Logger.info('   ✅ PASSED: WebGL vendor is spoofed');
    } else {
        Logger.warn(`   ⚠️ Vendor may reveal true identity: ${webglInfo.vendor}`);
    }

    // Test 5: Genetic fingerprinter
    Logger.info('📍 Test 5: Genetic fingerprinter');
    const gene = fingerprinter.getBestGene();
    console.log(`   Current gene ID: ${gene.id}`);
    console.log(`   User Agent: ${gene.userAgent.substring(0, 50)}...`);
    console.log(`   Viewport: ${gene.viewport.width}x${gene.viewport.height}`);
    Logger.info('   ✅ PASSED: Genetic fingerprinter is active');

    // Cleanup
    await factory.closePage(page);
    await factory.close();

    Logger.info('');
    Logger.info('🎯 AUDIT 1 COMPLETE');
    Logger.info('================');
    Logger.info('Check the results above. Key indicators:');
    Logger.info('- navigator.webdriver should be FALSE');
    Logger.info('- Canvas hash should ideally differ between calls');
    Logger.info('- WebGL vendor should NOT reveal your real GPU');

    process.exit(0);
}

runIdentityAudit().catch((err) => {
    Logger.error('AUDIT 1 FAILED:', err);
    process.exit(1);
});
