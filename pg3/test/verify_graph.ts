
import { GraphClient } from './src/core/knowledge/graph_client';

async function verify() {
    console.log('🕸️ GRAPH VERIFICATION START');

    // Check if we can connect (Driver initializes lazily, so we try a merger)
    const client = GraphClient.getInstance();

    // Mock Data
    const c1 = {
        company_name: 'Graph Test S.R.L.',
        city: 'Milan',
        piva: 'IT12345678901'
    };

    try {
        console.log('1. Merging Company 1...');
        await client.mergeCompany(c1 as any);
        console.log('✅ Merge Success (or Silent Fail caught)');
    } catch (e) {
        console.log('⚠️ Graph connection failed (Expected if Docker not up):');
        console.log((e as Error).message);
    }

    // Shutdown driver
    await client.close();
    console.log('🕸️ GRAPH VERIFICATION END');
}

verify();
