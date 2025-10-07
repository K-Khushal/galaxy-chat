"use client";

import { LibraryContent } from "@/components/library/library-content";
import { LibraryHeader } from "@/components/library/library-header";

export default function LibraryPage() {
  return (
    <div className="flex flex-col h-full">
      <LibraryHeader />
      <LibraryContent />
    </div>
  );
}
