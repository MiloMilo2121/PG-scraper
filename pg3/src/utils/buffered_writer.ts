
import * as fs from 'fs';
import { createObjectCsvWriter } from 'csv-writer';

export class BufferedCSVWriter {
    private writer: any;
    private buffer: any[] = [];
    private bufferSize: number;

    constructor(path: string, header: any[], bufferSize: number = 50) {
        this.bufferSize = bufferSize;
        this.writer = createObjectCsvWriter({
            path,
            header,
            append: fs.existsSync(path)
        });
    }

    public async write(record: any) {
        this.buffer.push(record);
        if (this.buffer.length >= this.bufferSize) {
            await this.flush();
        }
    }

    public async flush() {
        if (this.buffer.length > 0) {
            await this.writer.writeRecords(this.buffer);
            this.buffer = [];
        }
    }
}
