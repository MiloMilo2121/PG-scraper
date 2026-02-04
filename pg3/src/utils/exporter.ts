
import * as fs from 'fs';

export class Exporter {
    public static toJSON(data: any[], path: string) {
        fs.writeFileSync(path, JSON.stringify(data, null, 2));
    }

    // toXLSX requiring library, mock for now
    public static toXLSX(data: any[], path: string) {
        // console.log('Exporting XLSX to ' + path);
    }
}
