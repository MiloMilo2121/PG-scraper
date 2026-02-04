
import { HoneyPotDetector } from './src/core/security/honeypot_detector';

async function verify() {
    console.log('🍯 HONEYPOT VERIFICATION START');

    const detector = HoneyPotDetector.getInstance();

    // 1. DNS Check (Valid)
    console.log('1. Checking google.com (Valid)...');
    const dnsRes = await detector.checkDNS('https://google.com');
    console.log(`DNS Result: ${JSON.stringify(dnsRes)}`);

    // 2. Content Check (Trap)
    console.log('2. Checking Fake Trap Content...');
    const fakeTrapHtml = `
        <html>
            <body>
                <h1>Domain For Sale</h1>
                <p>Buy this domain now at GoDaddy Parked.</p>
                <a href="#">Link 1</a>
            </body>
        </html>
    `;
    const trapRes = detector.analyzeContent(fakeTrapHtml);
    console.log(`Trap Result: ${JSON.stringify(trapRes)}`);

    if (!trapRes.safe) {
        console.log('✅ TRAP DETECTED SUCCESSFULLY');
    } else {
        console.log('❌ FAILED TO DETECT TRAP');
    }

    console.log('🍯 HONEYPOT VERIFICATION END');
}

verify();
