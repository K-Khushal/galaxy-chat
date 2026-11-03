import { CircleAlert, Info, TriangleAlert } from "lucide-react";
import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

type StateSize = "page" | "inline";

function StateTile({
  icon,
  tone,
}: {
  icon: ReactNode;
  tone: "muted" | "destructive";
}) {
  return (
    <div
      aria-hidden="true"
      className={cn(
        "flex size-10 items-center justify-center rounded-xl [&_svg:not([class*='size-'])]:size-5",
        tone === "muted"
          ? "bg-muted text-muted-foreground"
          : "bg-destructive/10 text-destructive",
      )}
    >
      {icon}
    </div>
  );
}

function PageState({
  tile,
  title,
  description,
  action,
  footer,
  headingLevel,
  className,
}: {
  tile?: ReactNode;
  title: string;
  description?: string;
  action?: ReactNode;
  footer?: ReactNode;
  headingLevel?: 1 | 2;
  className?: string;
}) {
  const Heading = headingLevel === 2 ? "h2" : "h1";
  return (
    <div
      data-slot="state"
      className={cn(
        "flex flex-col items-center gap-4 px-6 text-center",
        className,
      )}
    >
      {tile}
      <div className="flex flex-col gap-1">
        <Heading className="text-heading font-semibold">{title}</Heading>
        {description ? (
          <p className="max-w-sm text-pretty text-muted-foreground">
            {description}
          </p>
        ) : null}
        {footer}
      </div>
      {action ? (
        <div className="flex flex-wrap justify-center gap-2">{action}</div>
      ) : null}
    </div>
  );
}

/** Nothing here yet. The copy invites the next action ("No chats yet"). */
function EmptyState({
  icon,
  title,
  description,
  action,
  size = "page",
  headingLevel,
  className,
}: {
  icon?: ReactNode;
  title: string;
  description?: string;
  action?: ReactNode;
  size?: StateSize;
  headingLevel?: 1 | 2;
  className?: string;
}) {
  if (size === "inline")
    return (
      <div
        data-slot="state"
        className={cn(
          "flex flex-wrap items-center gap-x-2 gap-y-1 text-sm text-muted-foreground",
          className,
        )}
      >
        <h2>{title}</h2>
        {action}
      </div>
    );
  return (
    <PageState
      tile={icon ? <StateTile icon={icon} tone="muted" /> : null}
      title={title}
      description={description}
      action={action}
      headingLevel={headingLevel}
      className={className}
    />
  );
}

/** Says what happened, how to recover, and the ID support can look up. */
function ErrorState({
  title = "Something went wrong",
  description,
  errorId,
  action,
  size = "page",
  headingLevel,
  className,
}: {
  title?: string;
  description?: string;
  errorId?: string;
  action?: ReactNode;
  size?: StateSize;
  headingLevel?: 1 | 2;
  className?: string;
}) {
  const id = errorId ? (
    <p className="font-mono text-xs text-muted-foreground">
      Error ID: <span className="select-all">{errorId}</span>
    </p>
  ) : null;
  if (size === "inline")
    return (
      <div
        data-slot="state"
        className={cn("flex flex-col gap-1 text-sm", className)}
      >
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
          <h2 className="flex items-center gap-1.5 text-destructive">
            <TriangleAlert aria-hidden="true" className="size-4 shrink-0" />
            {title}
          </h2>
          {action}
        </div>
        {description ? (
          <p className="text-muted-foreground">{description}</p>
        ) : null}
        {id}
      </div>
    );
  return (
    <PageState
      tile={<StateTile icon={<TriangleAlert />} tone="destructive" />}
      title={title}
      description={description}
      footer={id}
      action={action}
      headingLevel={headingLevel}
      className={className}
    />
  );
}

const alertIcon = {
  error: CircleAlert,
  warning: TriangleAlert,
  info: Info,
} as const;

/** A persistent message in the flow, such as a failed send above the composer. */
function InlineAlert({
  tone = "error",
  children,
  action,
  className,
}: {
  tone?: "error" | "warning" | "info";
  children: ReactNode;
  action?: ReactNode;
  className?: string;
}) {
  const Icon = alertIcon[tone];
  return (
    <div
      data-slot="inline-alert"
      data-tone={tone}
      role={tone === "error" ? "alert" : "status"}
      className={cn(
        "flex items-start gap-2 rounded-xl border bg-card px-3 py-2.5 text-sm",
        className,
      )}
    >
      <Icon
        aria-hidden="true"
        className={cn(
          "mt-0.5 size-4 shrink-0",
          tone === "error" && "text-destructive",
          tone === "warning" && "text-warning",
          tone === "info" && "text-muted-foreground",
        )}
      />
      <div className="min-w-0 flex-1 text-pretty">{children}</div>
      {action ? <div className="-my-1.5 shrink-0">{action}</div> : null}
    </div>
  );
}

export { EmptyState, ErrorState, InlineAlert };
