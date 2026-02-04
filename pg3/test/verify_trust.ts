
import { TrustArbiter, DataSource, DataPoint } from './src/core/knowledge/trust_arbiter';

function verify() {
    console.log('⚖️ TRUST ARBITER VERIFICATION START');

    const arbiter = TrustArbiter.getInstance();
    const now = Date.now();

    // SCENARIO 1: Website vs Generic Search (Website should win)
    const candidates1: DataPoint<string>[] = [
        { value: 'Correct Phone (Web)', source: DataSource.WEBSITE_DIRECT, timestamp: now },
        { value: 'Wrong Phone (Serp)', source: DataSource.GENERIC_SERP, timestamp: now }
    ];
    const res1 = arbiter.resolve(candidates1);
    console.log(`Test 1 (Web vs Search): ${res1 === 'Correct Phone (Web)' ? '✅ PASS' : '❌ FAIL'}`);

    // SCENARIO 2: Voting (2 Mediums beat 1 High?)
    // PG (0.85) vs Maps (0.80) + Serp (0.50) -> If Maps and Serp agree, they might win
    const candidates2: DataPoint<string>[] = [
        { value: 'Via Roma 1', source: DataSource.PAGINEGIALLE, timestamp: now },
        { value: 'Via Milano 2', source: DataSource.GOOGLE_MAPS, timestamp: now },
        { value: 'Via Milano 2', source: DataSource.GENERIC_SERP, timestamp: now }
    ];
    // Map(0.8) + Serp(0.5) = 1.3  vs  PG(0.85) = 0.85. The "Via Milano" group should win.
    const res2 = arbiter.resolve(candidates2);
    console.log(`Test 2 (Voting Block): ${res2 === 'Via Milano 2' ? '✅ PASS' : '❌ FAIL - Got ' + res2}`);

    // SCENARIO 3: Recency (Old Web vs New PG)
    const oldTimestamp = now - (1000 * 60 * 60 * 24 * 365 * 2); // 2 years ago
    const candidates3: DataPoint<string>[] = [
        { value: 'Old Address', source: DataSource.WEBSITE_DIRECT, timestamp: oldTimestamp },
        { value: 'New Address', source: DataSource.PAGINEGIALLE, timestamp: now }
    ];
    // Web(0.95) * Recency(old) vs PG(0.85) * Recency(new)
    // 0.95 * ~0.92 = 0.87  vs 0.85.  Web usually still wins unless very old. 
    // Let's force it to make a choice. 
    const res3 = arbiter.resolve(candidates3);
    console.log(`Test 3 (Recency): Winner is '${res3}'`);

    console.log('⚖️ TRUST ARBITER VERIFICATION END');
}

verify();
