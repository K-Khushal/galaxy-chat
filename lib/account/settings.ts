import "server-only";
import { eq } from "drizzle-orm";
import { userSettings } from "@/lib/db/schema";
import type { Db } from "@/lib/db/types";

export async function getSettings(db: Db, userId: string) {
  const [row] = await db
    .select()
    .from(userSettings)
    .where(eq(userSettings.userId, userId));
  return {
    aboutYou: row?.aboutYou ?? "",
    responseInstructions: row?.responseInstructions ?? "",
  };
}
export async function customContext(db: Db, userId: string) {
  const settings = await getSettings(db, userId);
  return [
    settings.aboutYou && `About the User:\n${settings.aboutYou}`,
    settings.responseInstructions &&
      `How Galaxy should respond:\n${settings.responseInstructions}`,
  ]
    .filter(Boolean)
    .join("\n\n");
}
