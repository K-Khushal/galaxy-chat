/**
 * Messages form a tree through parentId. Versions are siblings under the same
 * parent; the Chat shows the path from a root to its active leaf.
 */

export type TreeNode = { id: string; parentId: string | null; createdAt: Date };

export type VersionInfo = {
  /** Sibling Message IDs, oldest first. */
  ids: string[];
  /** Position of this Message among them. */
  index: number;
};

function oldestFirst(a: TreeNode, b: TreeNode) {
  const byTime = a.createdAt.getTime() - b.createdAt.getTime();
  if (byTime !== 0) return byTime;
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
}

/** Children of `parentId` (null for roots), oldest first. */
export function childrenOf<T extends TreeNode>(
  messages: readonly T[],
  parentId: string | null,
): T[] {
  return messages
    .filter((message) => message.parentId === parentId)
    .sort(oldestFirst);
}

/** The path from a root to `leafId`, root first. Empty when not found. */
export function pathTo<T extends TreeNode>(
  messages: readonly T[],
  leafId: string | null,
): T[] {
  const byId = new Map(messages.map((message) => [message.id, message]));
  const path: T[] = [];
  let current = leafId ? byId.get(leafId) : undefined;
  while (current && path.length <= messages.length) {
    path.unshift(current);
    current = current.parentId ? byId.get(current.parentId) : undefined;
  }
  return path;
}

/** Follows the newest child from `fromId` down to a leaf. */
export function latestLeaf(messages: readonly TreeNode[], fromId: string) {
  let leaf = fromId;
  for (let depth = 0; depth <= messages.length; depth++) {
    const children = childrenOf(messages, leaf);
    const newest = children.at(-1);
    if (!newest) break;
    leaf = newest.id;
  }
  return leaf;
}

export function versionsOf(
  messages: readonly TreeNode[],
  message: TreeNode,
): VersionInfo {
  const ids = childrenOf(messages, message.parentId).map(({ id }) => id);
  return { ids, index: ids.indexOf(message.id) };
}
