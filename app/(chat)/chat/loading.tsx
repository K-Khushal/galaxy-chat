export default function ChatLoading() {
  return (
    <div className="flex items-center justify-center h-full min-h-[400px]">
      <div className="flex items-center gap-2 text-muted-foreground">
        <div className="w-4 h-4 border-2 border-current border-t-transparent rounded-full animate-spin" />
        Preparing your chat experience...
      </div>
    </div>
  );
}
