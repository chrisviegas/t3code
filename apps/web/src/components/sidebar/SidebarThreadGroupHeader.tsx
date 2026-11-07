import type { ThreadGroup } from "@t3tools/contracts";
import { ChevronDownIcon, EllipsisIcon } from "lucide-react";
import { memo, useLayoutEffect, useState } from "react";

import { observeResize } from "~/lib/observeResize";
import { cn } from "~/lib/utils";
import { sidebarGroupHeaderId } from "../Sidebar.logic";
import { SortableSidebarMarker } from "./SidebarListMarkers";
import { Button } from "../ui/button";

/** The group's sidebar tree row; its thread rows name it as their parent. */
export function sidebarThreadGroupRowId(groupKey: string) {
  return `thread-group:${groupKey}`;
}

// A quiet label: smaller and dimmer than the rows it titles, so the threads stay the content.
const GROUP_TITLE_CLASS_NAME =
  "flex h-7 w-full items-center gap-1 rounded-(--control-radius) px-(--sidebar-row-content-inset) text-left text-xs font-medium text-sidebar-foreground/65 outline-none transition-colors duration-150 focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring";

/** Titles the threads in no group, styled as a group title it sits among; dropping here ungroups. */
export const SidebarUngroupedHeader = memo(function SidebarUngroupedHeader(props: {
  isDropTarget: boolean;
}) {
  return (
    <SortableSidebarMarker marker="ungrouped-header" className="relative pt-4">
      <div
        className={cn(
          GROUP_TITLE_CLASS_NAME,
          "cursor-default",
          props.isDropTarget && "text-primary",
        )}
      >
        Ungrouped
      </div>
    </SortableSidebarMarker>
  );
});

/** A user-made thread group: its name with the fold chevron right after it, like a section title. */
export const SidebarThreadGroupHeader = memo(function SidebarThreadGroupHeader(props: {
  groupKey: string;
  group: ThreadGroup;
  collapsed: boolean;
  threadCount: number;
  /** A dragged thread would join this group. */
  isDropTarget: boolean;
  /** Right under a shelf header, which already spaces it. */
  leading?: boolean;
  onToggle: (groupKey: string) => void;
  onContextMenu: (groupKey: string, position: { x: number; y: number }) => void;
}) {
  const { group, collapsed, groupKey } = props;
  return (
    // Padding, not margin: drag layout stacks rows by their boxes.
    <SortableSidebarMarker
      marker={{ id: sidebarGroupHeaderId(groupKey) }}
      data-testid="sidebar-thread-group"
      draggable
      className={cn("group/group-header relative pt-4 first:pt-0", props.leading && "pt-0.5")}
    >
      <button
        type="button"
        data-sidebar-row={sidebarThreadGroupRowId(groupKey)}
        aria-expanded={!collapsed}
        onClick={() => props.onToggle(groupKey)}
        onContextMenu={(event) => {
          event.preventDefault();
          props.onContextMenu(groupKey, { x: event.clientX, y: event.clientY });
        }}
        className={cn(
          GROUP_TITLE_CLASS_NAME,
          "group/title cursor-pointer hover:text-sidebar-foreground",
          props.isDropTarget && "text-primary hover:text-primary",
        )}
      >
        <span className="min-w-0 truncate">{group.name}</span>
        <ChevronDownIcon
          aria-hidden
          className={cn(
            "size-3.5 shrink-0 opacity-60 transition-transform duration-150 group-hover/title:opacity-100",
            collapsed && "-rotate-90",
          )}
        />
        <span className="flex-1" />
        {collapsed && props.threadCount > 0 ? (
          <span className="shrink-0 text-xs font-normal tabular-nums text-sidebar-muted-foreground group-hover/group-header:invisible pointer-coarse:invisible">
            {props.threadCount}
          </span>
        ) : null}
      </button>
      {/* Over the count, which hides on hover; the same menu as a right click. */}
      <span className="absolute right-1 bottom-0 flex h-7 items-center opacity-0 focus-within:opacity-100 group-hover/group-header:opacity-100 pointer-coarse:opacity-100">
        <Button
          size="icon-xs"
          variant="ghost-muted"
          aria-label={`${group.name} actions`}
          onPointerDown={(event) => event.stopPropagation()}
          onClick={(event) => {
            const rect = event.currentTarget.getBoundingClientRect();
            props.onContextMenu(groupKey, { x: rect.left, y: rect.bottom });
          }}
        >
          <EllipsisIcon aria-hidden />
        </Button>
      </span>
    </SortableSidebarMarker>
  );
});

/**
 * Outlines a whole group block, header through last row, while a dragged thread would move into
 * it. The group holds still during that drag, so it is measured on mount and again only when the
 * sidebar scrolls or resizes, and clipped to the sidebar's scroll area.
 */
export function SidebarGroupDropOutline(props: { groupKey: string; rowKeys: readonly string[] }) {
  const [box, setBox] = useState<{ top: number; left: number; width: number; height: number }>();
  const rowKeysKey = props.rowKeys.join("\n");
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- measures DOM rows outside React and follows the sidebar's scroll and size
  useLayoutEffect(() => {
    const header = document.querySelector(
      `[data-sidebar-row="${CSS.escape(sidebarThreadGroupRowId(props.groupKey))}"]`,
    );
    if (!header) return;
    const lastKey = rowKeysKey.split("\n").at(-1);
    const last =
      (lastKey ? document.querySelector(`[data-thread-item="${CSS.escape(lastKey)}"]`) : null) ??
      header;
    const scroller = header.closest('[data-slot="scroll-area-viewport"]');
    const measure = () => {
      const top = header.getBoundingClientRect();
      const bottom = last.getBoundingClientRect();
      const clip = scroller?.getBoundingClientRect();
      const y0 = Math.max(top.top - 2, clip?.top ?? -Infinity);
      const y1 = Math.min(bottom.bottom + 2, clip?.bottom ?? Infinity);
      setBox({ top: y0, left: top.left - 2, width: top.width + 4, height: Math.max(0, y1 - y0) });
    };
    measure();
    scroller?.addEventListener("scroll", measure, { passive: true });
    const stopResize = scroller ? observeResize(scroller, measure) : () => {};
    return () => {
      scroller?.removeEventListener("scroll", measure);
      stopResize();
    };
  }, [props.groupKey, rowKeysKey]);
  if (box === undefined) return null;
  return (
    <div
      aria-hidden
      className="pointer-events-none fixed z-10 rounded-lg border border-primary/60 bg-primary/5 transition-opacity duration-150 ease-out starting:opacity-0 motion-reduce:transition-none"
      style={box}
    />
  );
}
