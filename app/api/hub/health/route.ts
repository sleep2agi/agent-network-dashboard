import { requireDashboardAuth } from '@/app/lib/dashboard-auth';
import { hubFetch } from '@/app/lib/hub';
import { recordHubUploadLimits } from '@/app/lib/hub-upload-limits';

export async function GET() {
  const authFailure = await requireDashboardAuth();
  if (authFailure) return authFailure;

  try {
    const res = await hubFetch('/health');
    const data = await res.json();
    // The authenticated Dashboard health request runs during normal app
    // boot. Reuse it to warm the process-wide upload precheck cache instead
    // of creating a second startup request to the Hub (#496).
    recordHubUploadLimits(data);
    return Response.json(data);
  } catch (e: unknown) {
    return Response.json({ error: 'CommHub unreachable', detail: e instanceof Error ? e.message : String(e) }, { status: 502 });
  }
}
