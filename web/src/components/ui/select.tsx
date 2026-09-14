"use client"

import * as React from "react"
import { CheckIcon, ChevronDownIcon, ChevronUpIcon } from "lucide-react"
import { Select as SelectPrimitive } from "radix-ui"

import { cn } from "@/lib/utils"

function Select(props: React.ComponentProps<typeof SelectPrimitive.Root>) {
  return <SelectPrimitive.Root data-slot="select" {...props} />
}

function SelectValue(props: React.ComponentProps<typeof SelectPrimitive.Value>) {
  return <SelectPrimitive.Value data-slot="select-value" {...props} />
}

function SelectTrigger({ className, children, ...props }: React.ComponentProps<typeof SelectPrimitive.Trigger>) {
  return <SelectPrimitive.Trigger
    className={cn("border-input data-[placeholder]:text-muted-foreground [&_svg:not([class*='text-'])]:text-muted-foreground focus-visible:border-ring focus-visible:ring-ring/50 dark:bg-input/30 dark:hover:bg-input/50 flex h-9 w-fit items-center justify-between gap-2 rounded-md border bg-transparent px-3 py-2 text-sm whitespace-nowrap shadow-xs outline-none focus-visible:ring-[3px] disabled:cursor-not-allowed disabled:opacity-50 *:data-[slot=select-value]:line-clamp-1", className)}
    data-slot="select-trigger"
    {...props}
  >
    {children}
    <SelectPrimitive.Icon asChild><ChevronDownIcon className="size-4 opacity-50" /></SelectPrimitive.Icon>
  </SelectPrimitive.Trigger>
}

function SelectContent({ className, children, position = "popper", ...props }: React.ComponentProps<typeof SelectPrimitive.Content>) {
  return <SelectPrimitive.Portal><SelectPrimitive.Content
    className={cn("bg-popover text-popover-foreground data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0 data-[state=closed]:zoom-out-95 data-[state=open]:zoom-in-95 relative z-50 max-h-(--radix-select-content-available-height) min-w-[8rem] overflow-x-hidden overflow-y-auto rounded-md border shadow-md", className)}
    data-slot="select-content"
    position={position}
    {...props}
  >
    <SelectScrollUpButton />
    <SelectPrimitive.Viewport className={cn("p-1", position === "popper" && "w-full min-w-[var(--radix-select-trigger-width)]")}>
      {children}
    </SelectPrimitive.Viewport>
    <SelectScrollDownButton />
  </SelectPrimitive.Content></SelectPrimitive.Portal>
}

function SelectItem({ className, children, ...props }: React.ComponentProps<typeof SelectPrimitive.Item>) {
  return <SelectPrimitive.Item
    className={cn("focus:bg-accent focus:text-accent-foreground relative flex w-full cursor-default items-center rounded-sm py-1.5 pr-8 pl-2 text-sm outline-hidden select-none data-[disabled]:pointer-events-none data-[disabled]:opacity-50", className)}
    data-slot="select-item"
    {...props}
  >
    <span className="absolute right-2 flex size-3.5 items-center justify-center"><SelectPrimitive.ItemIndicator><CheckIcon className="size-4" /></SelectPrimitive.ItemIndicator></span>
    <SelectPrimitive.ItemText>{children}</SelectPrimitive.ItemText>
  </SelectPrimitive.Item>
}

function SelectScrollUpButton(props: React.ComponentProps<typeof SelectPrimitive.ScrollUpButton>) {
  return <SelectPrimitive.ScrollUpButton className="flex cursor-default items-center justify-center py-1" {...props}><ChevronUpIcon className="size-4" /></SelectPrimitive.ScrollUpButton>
}

function SelectScrollDownButton(props: React.ComponentProps<typeof SelectPrimitive.ScrollDownButton>) {
  return <SelectPrimitive.ScrollDownButton className="flex cursor-default items-center justify-center py-1" {...props}><ChevronDownIcon className="size-4" /></SelectPrimitive.ScrollDownButton>
}

export { Select, SelectContent, SelectItem, SelectTrigger, SelectValue }
