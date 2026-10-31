"use client";

import { MoreHorizontal, Settings, Trash2, User } from "lucide-react";
import { toast } from "sonner";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  CommandShortcut,
} from "@/components/ui/command";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import {
  Popover,
  PopoverContent,
  PopoverDescription,
  PopoverHeader,
  PopoverTitle,
  PopoverTrigger,
} from "@/components/ui/popover";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from "@/components/ui/sheet";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";

/** Overlays render in a portal, so they follow the active theme. */
export function Overlays() {
  return (
    <section
      aria-label="Overlays"
      className="rounded-2xl border bg-background p-6"
    >
      <h2 className="text-lg font-medium tracking-tight">Overlays</h2>
      <p className="mt-1 mb-6 text-muted-foreground">
        These render in a portal and follow the theme set with the switcher.
      </p>
      <div className="grid gap-8 lg:grid-cols-2">
        <div className="flex flex-wrap items-start gap-2">
          <Dialog>
            <DialogTrigger render={<Button variant="outline" />}>
              Dialog
            </DialogTrigger>
            <DialogContent>
              <DialogHeader>
                <DialogTitle>Rename chat</DialogTitle>
                <DialogDescription>
                  Give this chat a name you will recognise.
                </DialogDescription>
              </DialogHeader>
              <Input aria-label="Chat name" defaultValue="Trip planning" />
              <DialogFooter>
                <Button>Save</Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>

          <AlertDialog>
            <AlertDialogTrigger render={<Button variant="outline" />}>
              Alert dialog
            </AlertDialogTrigger>
            <AlertDialogContent>
              <AlertDialogHeader>
                <AlertDialogTitle>Delete this chat?</AlertDialogTitle>
                <AlertDialogDescription>
                  This removes the chat and all of its messages. You can't undo
                  this.
                </AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel>Cancel</AlertDialogCancel>
                <AlertDialogAction variant="destructive">
                  Delete
                </AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>

          <DropdownMenu>
            <DropdownMenuTrigger render={<Button variant="outline" />}>
              Dropdown menu
            </DropdownMenuTrigger>
            <DropdownMenuContent className="w-48">
              <DropdownMenuGroup>
                <DropdownMenuLabel>Chat</DropdownMenuLabel>
                <DropdownMenuItem>
                  <User /> Profile
                </DropdownMenuItem>
                <DropdownMenuItem>
                  <Settings /> Settings
                </DropdownMenuItem>
              </DropdownMenuGroup>
              <DropdownMenuSeparator />
              <DropdownMenuItem variant="destructive">
                <Trash2 /> Delete
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>

          <Popover>
            <PopoverTrigger render={<Button variant="outline" />}>
              Popover
            </PopoverTrigger>
            <PopoverContent>
              <PopoverHeader>
                <PopoverTitle>Credits</PopoverTitle>
                <PopoverDescription>
                  Credits pay for replies from Credit models.
                </PopoverDescription>
              </PopoverHeader>
            </PopoverContent>
          </Popover>

          <Tooltip>
            <TooltipTrigger
              render={
                <Button variant="outline" size="icon" aria-label="More" />
              }
            >
              <MoreHorizontal />
            </TooltipTrigger>
            <TooltipContent>More actions</TooltipContent>
          </Tooltip>

          <Sheet>
            <SheetTrigger render={<Button variant="outline" />}>
              Sheet
            </SheetTrigger>
            <SheetContent side="right">
              <SheetHeader>
                <SheetTitle>Sheet</SheetTitle>
                <SheetDescription>
                  Side panel for secondary tasks, and the mobile sidebar.
                </SheetDescription>
              </SheetHeader>
            </SheetContent>
          </Sheet>

          <Button variant="outline" onClick={() => toast("Chat copied")}>
            Toast
          </Button>
          <Button
            variant="outline"
            onClick={() => toast.error("Couldn't send message")}
          >
            Error toast
          </Button>
        </div>

        <Command className="h-52 rounded-xl border">
          <CommandInput placeholder="Search chats" />
          <CommandList>
            <CommandEmpty>No chats found.</CommandEmpty>
            <CommandGroup heading="Chats">
              <CommandItem>
                Trip planning <CommandShortcut>⌘1</CommandShortcut>
              </CommandItem>
              <CommandItem>
                Recipe ideas <CommandShortcut>⌘2</CommandShortcut>
              </CommandItem>
              <CommandItem>
                Quarterly notes <CommandShortcut>⌘3</CommandShortcut>
              </CommandItem>
            </CommandGroup>
          </CommandList>
        </Command>
      </div>
    </section>
  );
}
