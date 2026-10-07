import { createReadStream } from 'node:fs';
import { StringDecoder } from 'node:string_decoder';

export async function* readCsvRows(filePath) {
    const decoder = new StringDecoder('utf8');
    let buffer = '';
    let headers = null;
    let fields = [];
    let field = '';
    let inQuotes = false;
    let recordNumber = 0;
    let cursor = 0;

    function finishRecord() {
        fields.push(field);
        field = '';
        recordNumber += 1;
        const values = fields;
        fields = [];
        return values;
    }

    function setHeaders(values) {
        headers = values.map((value, index) => index === 0 ? value.replace(/^\uFEFF/, '') : value);
        const duplicates = headers.filter((header, index) => headers.indexOf(header) !== index);
        if (duplicates.length) throw new Error('Duplicate CSV header(s): ' + [...new Set(duplicates)].join(', '));
    }

    function rowObject(values) {
        if (values.length !== headers.length) throw new Error('CSV record ' + recordNumber + ' has ' + values.length + ' fields; expected ' + headers.length);
        const row = Object.create(null);
        for (let index = 0; index < headers.length; index += 1) row[headers[index]] = values[index];
        Object.defineProperty(row, '__rowNumber', { value: recordNumber, enumerable: false });
        return row;
    }

    for await (const chunk of createReadStream(filePath)) {
        buffer += decoder.write(chunk);
        cursor = 0;
        const ready = [];
        while (cursor < buffer.length) {
            const character = buffer[cursor];
            if (inQuotes) {
                if (character === '"') {
                    if (cursor + 1 >= buffer.length) break;
                    if (buffer[cursor + 1] === '"') { field += '"'; cursor += 2; }
                    else { inQuotes = false; cursor += 1; }
                } else { field += character; cursor += 1; }
                continue;
            }
            if (character === '"') { inQuotes = true; cursor += 1; }
            else if (character === ',') { fields.push(field); field = ''; cursor += 1; }
            else if (character === '\r' || character === '\n') {
                if (character === '\r' && cursor + 1 >= buffer.length) break;
                cursor += character === '\r' && buffer[cursor + 1] === '\n' ? 2 : 1;
                const values = finishRecord();
                if (!headers) setHeaders(values);
                else if (!(values.length === 1 && values[0] === '')) ready.push(rowObject(values));
            } else { field += character; cursor += 1; }
        }
        buffer = buffer.slice(cursor);
        for (const row of ready) yield row;
    }

    buffer += decoder.end();
    cursor = 0;
    while (cursor < buffer.length) {
        const character = buffer[cursor];
        if (inQuotes) {
            if (character === '"') {
                if (buffer[cursor + 1] === '"') { field += '"'; cursor += 2; }
                else { inQuotes = false; cursor += 1; }
            } else { field += character; cursor += 1; }
        } else if (character === '"') { inQuotes = true; cursor += 1; }
        else if (character === ',') { fields.push(field); field = ''; cursor += 1; }
        else if (character === '\r' || character === '\n') {
            cursor += character === '\r' && buffer[cursor + 1] === '\n' ? 2 : 1;
            const values = finishRecord();
            if (!headers) setHeaders(values);
            else if (!(values.length === 1 && values[0] === '')) yield rowObject(values);
        } else { field += character; cursor += 1; }
    }
    if (inQuotes) throw new Error('Unclosed quoted field in CSV: ' + filePath);
    if (field.length || fields.length) {
        const values = finishRecord();
        if (!headers) setHeaders(values);
        else if (!(values.length === 1 && values[0] === '')) yield rowObject(values);
    }
    if (!headers) throw new Error('CSV has no header row: ' + filePath);
}
