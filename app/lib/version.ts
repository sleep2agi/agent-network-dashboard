/** Dashboard package version sourced from package.json at build time.
 *  Importing JSON requires `resolveJsonModule: true` in tsconfig, which
 *  Next sets by default. Bumping is automated by the publish flow, so this
 *  surfaces the real preview number in Settings → Dashboard. */
import pkg from '../../package.json' assert { type: 'json' };

export const DASHBOARD_VERSION: string = pkg.version;
