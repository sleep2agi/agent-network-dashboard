export const HUB_CREATE_RUNTIMES: ReadonlyArray<{
  id: string;
  label: string;
  models: readonly string[];
  defaultModel: string;
}>;

export const HUB_CREATE_RUNTIME_IDS: readonly string[];
export const HUB_PERMISSION_MODES: readonly string[];
export const CREATE_FLAG_KEYS: readonly string[];
export const EDITABLE_CHANNELS: readonly string[];

export function narrowEditableChannels(input: unknown): string[] | undefined;

export type ReportedProvider = { id: string; baseUrl?: string; models: string[] };
export type ReportedCatalog = { present: boolean; models: string[]; providers: ReportedProvider[] };

export function reportedRuntimeCatalog(readiness: unknown, runtime: string): ReportedCatalog;
export function readinessSummary(entry: unknown): { state: string; reason: string } | null;
