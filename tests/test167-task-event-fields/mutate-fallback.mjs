import { readFileSync, writeFileSync } from 'node:fs';

const path = 'app/components/TaskDetail.tsx';
const before = "return event.event_type?.trim() || event.to_status?.trim() || 'event';";
const after = "return event.event_type?.trim() || 'event';";
const source = readFileSync(path, 'utf8');
const matches = source.split(before).length - 1;
if (matches !== 1) throw new Error(`fallback mutation anchor count must be 1, got ${matches}`);
const mutated = source.replace(before, after);
if (mutated === source) throw new Error('fallback mutation was byte-identical');
writeFileSync(path, mutated);
