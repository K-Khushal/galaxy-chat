"use client";

import { LibraryEmptyState } from "./library-empty-state";
import { LibraryMasonry } from "./library-masonry";
import { useLibraryData } from "./use-library-data";

export function LibraryContent() {
  const { mediaMessages, isLoading, error } = useLibraryData();

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="flex items-center gap-2 text-muted-foreground">
          <div className="w-4 h-4 border-2 border-current border-t-transparent rounded-full animate-spin" />
          Loading media...
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="text-center">
          <p className="text-destructive mb-2">Failed to load media</p>
          <p className="text-sm text-muted-foreground">{error}</p>
        </div>
      </div>
    );
  }

  if (!mediaMessages || mediaMessages.length === 0) {
    return <LibraryEmptyState />;
  }

  return <LibraryMasonry mediaMessages={mediaMessages} />;
}
