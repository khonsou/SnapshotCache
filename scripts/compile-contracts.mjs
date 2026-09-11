import { readFile, mkdir, writeFile } from 'node:fs/promises';
import Ajv2020 from 'ajv/dist/2020.js';
import addFormats from 'ajv-formats';
import standaloneCode from 'ajv/dist/standalone/index.js';

const schema = JSON.parse(await readFile(new URL('../contracts/snapshot.schema.json', import.meta.url)));
const ajv = new Ajv2020({ allErrors: true, strict: true, code: { source: true } });
addFormats(ajv);
ajv.addSchema(schema);
await mkdir(new URL('../src/snapshot/generated/', import.meta.url), { recursive: true });
await writeFile(new URL('../src/snapshot/generated/schema.cjs', import.meta.url), standaloneCode(ajv, {
  validateManifest: schema.$id,
  validateQuery: `${schema.$id}#/$defs/QueryContext`,
}));
console.log('Snapshot contract validators generated.');
