import { testE2eEnabled } from "@/lib/env";
import { loadE2eSeams } from "@/lib/testing/load-e2e";

async function handle(request: Request) {
  if (!testE2eEnabled()) return new Response(null, { status: 404 });
  return (await loadE2eSeams()).storageRequest(request);
}
export { handle as GET, handle as HEAD, handle as PUT };
