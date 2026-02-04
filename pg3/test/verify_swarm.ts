
import { BrowserFactory } from './src/core/browser/factory_v2';
import { config } from './src/config';

async function verify() {
    console.log('🐝 SWARM VERIFICATION START');

    // Force Remote Mode for this test
    config.browser.mode = 'remote';
    config.browser.remoteEndpoint = 'wss://mock-browserless.example.com'; // Fake endpoint

    const factory = BrowserFactory.getInstance();

    try {
        console.log('1. Attempting Remote Connection...');
        // This is expected to fail with a connection error, confirming the code path
        await factory.newPage();
    } catch (e: any) {
        console.log('2. Result:', e.message);
        if (e.message.includes('mock-browserless') || e.message.includes('ECONNREFUSED')) {
            console.log('✅ SUCCESS: Code attempted to connect to remote endpoint.');
        } else {
            console.log('❌ UNEXPECTED ERROR: ' + e.message);
        }
    } finally {
        // Reset config to avoid breaking other things
        config.browser.mode = 'local';
    }

    console.log('🐝 SWARM VERIFICATION END');
}

verify();
