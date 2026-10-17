import { guestHandlers } from "@/lib/credits/guest-handlers";
export async function GET(request: Request) {
  return guestHandlers({ env: process.env }).GET(request);
}
export async function POST(request: Request) {
  return guestHandlers({ env: process.env }).POST(request);
}
