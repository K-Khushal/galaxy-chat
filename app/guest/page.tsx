import type { Metadata } from "next";
import { GuestChat } from "@/components/guest/guest-chat";
export const metadata: Metadata = {
  title: "Try a guest prompt · Galaxy Chat",
  robots: { index: false, follow: false },
};
export default function GuestPage() {
  return <GuestChat />;
}
