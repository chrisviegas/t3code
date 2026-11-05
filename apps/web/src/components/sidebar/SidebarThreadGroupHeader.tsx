import type { ThreadGroup } from "@t3tools/contracts";
import { ChevronDownIcon } from "lucide-react";
import { memo } from "react";

import { cn } from "~/lib/utils";

/** The group's sidebar tree row; its thread rows name it as their parent. */
export function sidebarThreadGroupRowId(groupKey: string) {
  return `thread-group:${groupKey}`;
}

/** A user-made thread group: its name with the fold chevron right after it, like a section title. */
export const SidebarThreadGroupHeader = memo(function SidebarThreadGroupHeader(props: {
  groupKey: string;
  group: ThreadGroup;
  collapsed: boolean;
  threadCount: number;
  onToggle: (groupKey: string) => void;
  onContextMenu: (groupKey: string, position: { x: number; y: number }) => void;
}) {
  const { group, collapsed, groupKey } = props;
  return (
    <li data-testid="sidebar-thread-group" className="relative mt-4 list-none first:mt-0">
      <button
        type="button"
        data-sidebar-row={sidebarThreadGroupRowId(groupKey)}
        aria-expanded={!collapsed}
        onClick={() => props.onToggle(groupKey)}
        onContextMenu={(event) => {
          event.preventDefault();
          props.onContextMenu(groupKey, { x: event.clientX, y: event.clientY });
        }}
        className="flex h-8 w-full cursor-pointer items-center gap-1.5 rounded-(--control-radius) px-(--sidebar-row-content-inset) text-left outline-none hover:bg-sidebar-row-hover focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
      >
        {/* Larger and brighter than the built-in shelves (Working, Settled), which stay muted. */}
        <span className="min-w-0 truncate text-sm font-semibold text-sidebar-foreground">
          {group.name}
        </span>
        <ChevronDownIcon
          aria-hidden
          className={cn(
            "size-3 shrink-0 text-sidebar-muted-foreground transition-transform",
            collapsed && "-rotate-90",
          )}
        />
        <span className="flex-1" />
        {collapsed && props.threadCount > 0 ? (
          <span className="shrink-0 text-xs tabular-nums text-sidebar-muted-foreground">
            {props.threadCount}
          </span>
        ) : null}
      </button>
    </li>
  );
});
