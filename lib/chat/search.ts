import "server-only";
import { sql } from "drizzle-orm";
import type { Db } from "@/lib/db/types";

/** Rank titles above Message text; never search another owner's Chats. */
export async function searchChats(db: Db, userId: string, query: string) {
  const result = await db.execute(sql`
    WITH matches AS (
      SELECT c.id, ts_rank(to_tsvector('english', coalesce(c.title, '')), websearch_to_tsquery('english', ${query})) * 2 AS rank
      FROM chat c WHERE c.user_id = ${userId} AND NOT c.archived
        AND to_tsvector('english', coalesce(c.title, '')) @@ websearch_to_tsquery('english', ${query})
      UNION ALL
      SELECT c.id, ts_rank(m.search_document, websearch_to_tsquery('english', ${query})) AS rank
      FROM message m JOIN chat c ON c.id = m.chat_id
      WHERE c.user_id = ${userId} AND NOT c.archived
        AND m.search_document @@ websearch_to_tsquery('english', ${query})
    )
    SELECT c.id, c.title FROM matches JOIN chat c ON c.id = matches.id
    GROUP BY c.id ORDER BY max(matches.rank) DESC, c.updated_at DESC, c.id LIMIT 50
  `);
  const rows = result as unknown as {
    rows?: { id: string; title: string | null }[];
  };
  return (
    rows.rows ??
    Array.from(
      result as unknown as Iterable<{ id: string; title: string | null }>,
    )
  );
}
