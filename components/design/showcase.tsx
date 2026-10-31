"use client";

import { ArrowUp, Bell, Download, Plus, Search, Trash2 } from "lucide-react";
import { Composer } from "@/components/shell/composer";
import { StatePanel } from "@/components/shell/state-panel";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  InputGroup,
  InputGroupAddon,
  InputGroupInput,
} from "@/components/ui/input-group";
import { Label } from "@/components/ui/label";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Separator } from "@/components/ui/separator";
import { Skeleton } from "@/components/ui/skeleton";
import { Switch } from "@/components/ui/switch";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";

const focusRing = "border-ring ring-3 ring-ring/50";

function Block({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex flex-col gap-3">
      <h3 className="text-xs font-medium text-muted-foreground">{title}</h3>
      {children}
    </div>
  );
}

const swatches = [
  ["background", "bg-background"],
  ["card", "bg-card"],
  ["popover", "bg-popover"],
  ["muted", "bg-muted"],
  ["accent", "bg-accent"],
  ["sidebar", "bg-sidebar"],
  ["user-bubble", "bg-user-bubble"],
  ["primary", "bg-primary"],
  ["destructive", "bg-destructive"],
  ["foreground", "bg-foreground"],
  ["muted-fg", "bg-muted-foreground"],
  ["border", "bg-border"],
] as const;

const charts = [
  "bg-chart-1",
  "bg-chart-2",
  "bg-chart-3",
  "bg-chart-4",
  "bg-chart-5",
] as const;

const variants = [
  "default",
  "secondary",
  "outline",
  "ghost",
  "destructive",
  "link",
] as const;

export function Showcase() {
  return (
    <div className="flex flex-col gap-10">
      <Block title="Colour tokens">
        <ul className="grid grid-cols-3 gap-3 sm:grid-cols-4">
          {swatches.map(([name, cls]) => (
            <li key={name} className="flex flex-col gap-1.5">
              <span className={`h-10 rounded-lg border ${cls}`} />
              <span className="text-xs text-muted-foreground">{name}</span>
            </li>
          ))}
        </ul>
        <ul className="flex gap-3">
          {charts.map((cls, i) => (
            <li key={cls} className="flex flex-1 flex-col gap-1.5">
              <span className={`h-6 rounded-md ${cls}`} />
              <span className="text-xs text-muted-foreground">
                chart-{i + 1}
              </span>
            </li>
          ))}
        </ul>
      </Block>

      <Block title="Type">
        <div className="flex flex-col gap-2">
          <p className="text-3xl font-medium tracking-tight">
            What can I help with?
          </p>
          <p className="text-lg font-medium tracking-tight">Heading, 18px</p>
          <p>
            Interface text, Geist 14px. Menus, labels, buttons and controls.
          </p>
          <p className="text-message">
            Message text, Geist 15px with a looser line height for reading
            replies at length.
          </p>
          <p className="text-muted-foreground">
            Muted text for secondary copy.
          </p>
          <p>
            A{" "}
            <a
              className="text-primary underline underline-offset-4"
              href="#top"
            >
              link
            </a>{" "}
            and <code className="font-mono text-[0.85em]">inline code</code>.
          </p>
          <pre className="overflow-x-auto rounded-xl bg-muted p-3 font-mono text-[0.8125rem]">
            {"const reply = await generate(chat)"}
          </pre>
        </div>
      </Block>

      <Block title="Radius: 8px controls, 12px cards and menus, 24px composer">
        <div className="flex items-end gap-4">
          <div className="flex h-12 w-24 items-center justify-center rounded-lg border bg-card text-xs">
            8
          </div>
          <div className="flex h-16 w-24 items-center justify-center rounded-xl border bg-card text-xs">
            12
          </div>
          <div className="flex h-20 min-w-0 flex-1 items-center justify-center rounded-3xl border bg-card text-xs">
            24
          </div>
        </div>
      </Block>

      <Block title="Button: variants (default 36px)">
        <div className="flex flex-wrap items-center gap-2">
          {variants.map((variant) => (
            <Button key={variant} variant={variant}>
              {variant}
            </Button>
          ))}
        </div>
      </Block>
      <Block title="Button: sizes (xs 24, sm 32, default 36, lg 40; 44px on touch)">
        <div className="flex flex-wrap items-center gap-2">
          <Button size="xs">xs</Button>
          <Button size="sm">sm</Button>
          <Button>default</Button>
          <Button size="lg">lg</Button>
          <Button size="icon-xs" aria-label="Add">
            <Plus />
          </Button>
          <Button size="icon-sm" variant="outline" aria-label="Search">
            <Search />
          </Button>
          <Button size="icon" variant="outline" aria-label="Notifications">
            <Bell />
          </Button>
          <Button size="icon-lg" variant="secondary" aria-label="Download">
            <Download />
          </Button>
        </div>
      </Block>
      <Block title="Button: with icon, disabled, focus (forced)">
        <div className="flex flex-wrap items-center gap-2">
          <Button>
            <Plus data-icon="inline-start" />
            New chat
          </Button>
          <Button variant="destructive">
            <Trash2 data-icon="inline-start" />
            Delete
          </Button>
          <Button disabled>Disabled</Button>
          <Button variant="outline" disabled>
            Disabled
          </Button>
          <Button className={focusRing}>Focused</Button>
          <Button variant="outline" className={focusRing}>
            Focused
          </Button>
          <Button size="icon" className="rounded-full" aria-label="Send">
            <ArrowUp />
          </Button>
        </div>
      </Block>

      <Block title="Fields">
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="d-input">Label</Label>
            <Input id="d-input" placeholder="Placeholder" />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="d-value">Filled</Label>
            <Input id="d-value" defaultValue="sk-proj-…" />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="d-focus">Focused (forced)</Label>
            <Input id="d-focus" placeholder="Focused" className={focusRing} />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="d-invalid">Invalid</Label>
            <Input id="d-invalid" aria-invalid defaultValue="Not a key" />
            <p className="text-xs text-destructive">
              Enter a key that starts with sk-.
            </p>
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="d-disabled">Disabled</Label>
            <Input id="d-disabled" disabled placeholder="Disabled" />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="d-group">Input group</Label>
            <InputGroup>
              <InputGroupAddon>
                <Search />
              </InputGroupAddon>
              <InputGroupInput id="d-group" placeholder="Search chats" />
            </InputGroup>
          </div>
          <div className="flex flex-col gap-1.5 sm:col-span-2">
            <Label htmlFor="d-textarea">Textarea</Label>
            <Textarea id="d-textarea" placeholder="Write something" />
          </div>
        </div>
      </Block>

      <Block title="Switch">
        <div className="flex flex-wrap items-center gap-6">
          <div className="flex items-center gap-2">
            <Switch id="s-off" />
            <Label htmlFor="s-off">Off</Label>
          </div>
          <div className="flex items-center gap-2">
            <Switch id="s-on" defaultChecked />
            <Label htmlFor="s-on">On</Label>
          </div>
          <div className="flex items-center gap-2">
            <Switch id="s-disabled" disabled />
            <Label htmlFor="s-disabled">Disabled</Label>
          </div>
        </div>
      </Block>

      <Block title="Badge">
        <div className="flex flex-wrap items-center gap-2">
          {variants.map((variant) => (
            <Badge key={variant} variant={variant}>
              {variant}
            </Badge>
          ))}
        </div>
      </Block>

      <Block title="Avatar">
        <div className="flex items-center gap-3">
          <Avatar size="sm">
            <AvatarFallback>KK</AvatarFallback>
          </Avatar>
          <Avatar>
            <AvatarFallback>KK</AvatarFallback>
          </Avatar>
          <Avatar size="lg">
            <AvatarFallback>KK</AvatarFallback>
          </Avatar>
        </div>
      </Block>

      <Block title="Tabs">
        <Tabs defaultValue="one">
          <TabsList>
            <TabsTrigger value="one">Overview</TabsTrigger>
            <TabsTrigger value="two">Models</TabsTrigger>
            <TabsTrigger value="three" disabled>
              Disabled
            </TabsTrigger>
          </TabsList>
          <TabsContent value="one" className="pt-3 text-muted-foreground">
            Overview content.
          </TabsContent>
          <TabsContent value="two" className="pt-3 text-muted-foreground">
            Models content.
          </TabsContent>
        </Tabs>
        <Tabs defaultValue="one">
          <TabsList variant="line">
            <TabsTrigger value="one">Line</TabsTrigger>
            <TabsTrigger value="two">Variant</TabsTrigger>
          </TabsList>
        </Tabs>
      </Block>

      <Block title="Separator, skeleton, scroll area">
        <Separator />
        <div className="flex items-center gap-3">
          <Skeleton className="size-9 rounded-full" />
          <div className="flex flex-1 flex-col gap-2">
            <Skeleton className="h-3 w-2/3" />
            <Skeleton className="h-3 w-1/2" />
          </div>
        </div>
        <ScrollArea className="h-28 rounded-xl border">
          <ul className="flex flex-col p-2">
            {Array.from({ length: 12 }, (_, i) => (
              <li
                // biome-ignore lint/suspicious/noArrayIndexKey: static demo rows
                key={i}
                className="rounded-lg px-2 py-1.5 text-sm hover:bg-accent"
              >
                Scrollable row {i + 1}
              </li>
            ))}
          </ul>
        </ScrollArea>
      </Block>

      <Block title="Composer shell">
        <Composer />
      </Block>

      <Block title="Empty and error states">
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="rounded-xl border py-8">
            <StatePanel
              title="No chats yet"
              description="Start a chat and it will show up here."
              action={<Button variant="outline">New chat</Button>}
            />
          </div>
          <div className="rounded-xl border py-8">
            <StatePanel
              title="Couldn't load chats"
              description="Check your connection and try again."
              action={<Button variant="outline">Try again</Button>}
            />
          </div>
        </div>
      </Block>
    </div>
  );
}
