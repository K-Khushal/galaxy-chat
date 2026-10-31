import { Skeleton } from "@/components/ui/skeleton";

export default function Loading() {
  return (
    <output
      aria-label="Loading"
      className="flex flex-1 flex-col items-center justify-center gap-6 px-4 pb-[8vh]"
    >
      <Skeleton className="h-9 w-72 max-w-full" />
      <Skeleton className="h-[5.5rem] w-full max-w-3xl rounded-3xl" />
    </output>
  );
}
