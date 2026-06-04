import * as fs from 'fs';
import * as path from 'path';
import { parse } from 'csv-parse/sync';
import { stringify } from 'csv-stringify/sync';

const text = fs.readFileSync('updates.txt', 'utf-8');
const lines = text.split('\n');

const updates = new Map<string, string>();
let parsedCount = 0;

for (const line of lines) {
    const match = line.match(/^(?:✓\s*)?\d+\.\s+(.*?)\s+(?:—|→|->|–|-)\s+(https?:\/\/[^\s\[]+)/);
    if (match) {
        let name = match[1].trim();
        name = name.replace(/\s*\([^)]+\)$/, '').trim();
        const url = match[2].trim();
        
        const normKey = name.toLowerCase().replace(/[^a-z0-9]/g, '');
        updates.set(normKey, url);
        updates.set(name.toLowerCase(), url);
        parsedCount++;
    }
}

console.log(`Parsed ${parsedCount} URLs from updates.txt. Updates map size: ${updates.size}`);

const noWebPath = path.join(__dirname, '../../output/campaigns/MASTER_NO_WEBSITE.csv');
const withWebPath = path.join(__dirname, '../../output/campaigns/MASTER_WITH_WEBSITE.csv');

let noWebData = parse(fs.readFileSync(noWebPath, 'utf-8'), {columns: true, skip_empty_lines: true});
let withWebData = parse(fs.readFileSync(withWebPath, 'utf-8'), {columns: true, skip_empty_lines: true});

console.log(`Initial rows - NO WEB: ${noWebData.length}, WITH WEB: ${withWebData.length}`);

let movedCount = 0;
const newNoWebData: any[] = [];

for (const row of noWebData as any[]) {
    let companyName = row.company_name;
    const normKey = companyName.toLowerCase().replace(/[^a-z0-9]/g, '');
    
    let newUrl = null;
    
    if (updates.has(normKey)) {
        newUrl = updates.get(normKey);
    } else if (updates.has(companyName.toLowerCase())) {
        newUrl = updates.get(companyName.toLowerCase());
    } else {
        // Try substring search for difficult cases
        for (const [k, v] of updates.entries()) {
            if (k.length > 8 && normKey.includes(k)) {
                newUrl = v;
                break;
            }
        }
    }
    
    if (newUrl) {
        row.website = newUrl;
        withWebData.push(row);
        movedCount++;
        console.log(`Moved: ${companyName} -> ${newUrl}`);
    } else {
        newNoWebData.push(row);
    }
}

console.log(`Successfully moved ${movedCount} agencies from NO_WEBSITE to WITH_WEBSITE.`);

fs.writeFileSync(noWebPath, stringify(newNoWebData, {header: true}));
fs.writeFileSync(withWebPath, stringify(withWebData, {header: true}));

console.log(`Final rows - NO WEB: ${newNoWebData.length}, WITH WEB: ${withWebData.length}`);
