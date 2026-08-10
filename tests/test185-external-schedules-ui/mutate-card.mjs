import { readFileSync, writeFileSync } from 'node:fs';

const path = process.argv[2];
const source = readFileSync(path, 'utf8');
const anchor = '          <ExternalSchedulesCard snapshot={session?.external_schedules} />\n';
if (source.split(anchor).length - 1 !== 1) throw new Error('expected one ExternalSchedulesCard wiring anchor');
const mutated = source.replace(anchor, '');
if (mutated === source) throw new Error('card mutation was byte-identical');
writeFileSync(path, mutated);
