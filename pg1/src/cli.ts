#!/usr/bin/env node
import { Command } from 'commander';
import { Pipeline } from './pipeline';
import path from 'path';

const program = new Command();

program
    .name('adr-it')
    .description('Autonomous Domain Resolver for Italian SMEs')
    .version('3.0.0');

program
    .command('resolve')
    .description('Resolve domains from CSV input')
    .requiredOption('-i, --input <path>', 'Input CSV file path')
    .requiredOption('-o, --output <path>', 'Output CSV file path')
    .option('-c, --config <path>', 'Path to custom config YAML')
    .action(async (options) => {
        try {
            const inputPath = path.resolve(options.input);
            const outputPath = path.resolve(options.output);

            console.log(`Starting ADR-IT v3...`);
            console.log(`Input: ${inputPath}`);
            console.log(`Output: ${outputPath}`);

            await Pipeline.run(inputPath, outputPath);

            console.log('Done.');
        } catch (e: any) {
            console.error('Fatal Error:', e.message);
            process.exit(1);
        }
    });

program.parse(process.argv);
