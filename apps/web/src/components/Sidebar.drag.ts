import { closestCenter, type CollisionDetection, type Modifier } from "@dnd-kit/core";
import { verticalListSortingStrategy, type SortingStrategy } from "@dnd-kit/sortable";
import {
  resolveSidebarDropTarget,
  resolveSidebarGroupTarget,
  sidebarListItemId,
  sidebarMarkerId,
  type SidebarListItem,
  type SidebarListMarker,
  type SidebarSection,
} from "./Sidebar.logic";

const stationary = { x: 0, y: 0, scaleX: 1, scaleY: 1 };
const hidden = { ...stationary, scaleY: 0 };
type ThreadItem = Extract<SidebarListItem, { kind: "thread" }>;
type Layout = Parameters<SortingStrategy>[0];
const isShelfHeader = (item: SidebarListItem | undefined) =>
  item?.kind === "marker" &&
  (item.marker === "working-header" ||
    item.marker === "snoozed-header" ||
    item.marker === "settled-header");

export function restrictBelowSidebarLabel(
  { transform, containerNodeRect, draggingNodeRect }: Parameters<Modifier>[0],
  offset: number,
) {
  if (!containerNodeRect || !draggingNodeRect) return transform;
  const minimumY = containerNodeRect.top + offset - draggingNodeRect.top;
  return transform.y < minimumY ? { ...transform, y: minimumY } : transform;
}

export function createSidebarCollisionDetection(
  isValidTarget: (id: string) => boolean,
  options: {
    items?: readonly SidebarListItem[];
    activationY?: number | null;
  } = {},
): CollisionDetection {
  const validity = new Map<string, boolean>();
  const sections = new Map<string, SidebarSection | null>();
  let previousPointerY = options.activationY;
  let boundarySection: "pinned" | "active" | undefined;
  return (args) => {
    let collisions = closestCenter(args);
    const pointer = args.pointerCoordinates;
    const items = options.items;
    const found = items?.find((item) => sidebarListItemId(item) === args.active.id);
    const source =
      found?.kind === "group" ? { kind: "thread" as const, section: "active" as const } : found;
    const boundary = args.droppableContainers
      .find((container) => container.id === sidebarMarkerId("pinned-divider"))
      ?.node.current?.querySelector(".sidebar-drag-boundary-label")
      ?.getBoundingClientRect();
    if (items && boundary && source?.kind === "thread" && pointer) {
      boundarySection ??= source.section === "pinned" ? "pinned" : "active";
      // Only pointer movement changes sections; opening the destination moves rows under stationary gestures.
      const previousY = previousPointerY ?? pointer.y;
      previousPointerY = pointer.y;
      if (pointer.x >= boundary.left && pointer.x <= boundary.right) {
        if (pointer.y < previousY && pointer.y <= boundary.bottom) boundarySection = "pinned";
        else if (pointer.y > previousY && pointer.y >= boundary.top) boundarySection = "active";
        const nextHeader = (["working-header", "snoozed-header", "settled-header"] as const)
          .map((marker) =>
            args.droppableContainers.find((container) => container.id === sidebarMarkerId(marker)),
          )
          .find((container) => container !== undefined);
        const activeBottom = nextHeader?.node.current?.getBoundingClientRect().top;
        if (boundarySection === "pinned" || (activeBottom != null && pointer.y < activeBottom)) {
          const target = collisions.find((collision) => {
            const id = String(collision.id);
            if (!sections.has(id)) {
              const item = items.find((candidate) => sidebarListItemId(candidate) === id);
              // Groups drawn in the Working shelf sit below it, never in the Active zone.
              const workingHeader = items.findIndex(
                (candidate) => candidate.kind === "marker" && candidate.marker === "working-header",
              );
              const inWorkingShelf =
                item?.kind === "group" &&
                workingHeader !== -1 &&
                items.indexOf(item) > workingHeader;
              sections.set(
                id,
                inWorkingShelf
                  ? null
                  : (resolveSidebarDropTarget(items, String(args.active.id), id)?.section ?? null),
              );
            }
            return sections.get(id) === boundarySection;
          });
          if (target)
            collisions = [target, ...collisions.filter((collision) => collision !== target)];
        }
      }
    }
    const nearest = collisions[0];
    if (!nearest || nearest.id === args.active.id) {
      return collisions;
    }
    const id = String(nearest.id);
    const valid = validity.get(id) ?? isValidTarget(id);
    validity.set(id, valid);
    return valid ? collisions : collisions.filter((collision) => collision.id === args.active.id);
  };
}

export function createSidebarSortingStrategy(input: {
  items: readonly SidebarListItem[];
  enabled?: boolean;
  settledOrder: readonly string[];
  activeOrder?: readonly string[];
  settledExpanded: boolean;
  settledVisibleCount?: number;
  routeThreadKey?: string | null;
  snoozedThreadCount?: number;
  cardHeight?: number;
  slimHeight?: number;
  boundaryLabelHeight?: number;
  /** Markers not drawn in this list, so they take no room. */
  hiddenMarkers?: ReadonlySet<SidebarListMarker>;
}): SortingStrategy {
  if (input.enabled === false) return () => stationary;
  const { items } = input;
  const indices = new Map(items.map((item, index) => [sidebarListItemId(item), index]));
  let previous: Pick<Layout, "rects" | "activeIndex" | "overIndex"> | undefined;
  let transforms: ReturnType<SortingStrategy>[] | null = [];

  // A dragged group header carries its block (its rows follow the pointer in the row itself);
  // the other groups make room.
  function projectGroups({ rects, activeIndex, overIndex }: Layout, draggedGroup: string) {
    const over = items[overIndex];
    const order: string[] = [];
    for (const item of items) {
      if (item.kind === "group" && item.key === undefined) order.push(item.groupKey);
    }
    const from = order.indexOf(draggedGroup);
    const to = over?.kind === "group" ? order.indexOf(over.groupKey) : -1;
    const result: ReturnType<SortingStrategy>[] = items.map(() => stationary);
    const firstIndex = items.findIndex((item) => item.kind === "group");
    const firstRect = rects[firstIndex];
    if (from === -1 || to === -1 || !firstRect) return result;
    order.splice(to, 0, ...order.splice(from, 1));
    let top = firstRect.top;
    for (const groupKey of order) {
      for (const [index, item] of items.entries()) {
        if (item.kind !== "group" || item.groupKey !== groupKey) continue;
        const rect = rects[index];
        if (!rect) continue;
        result[index] = { ...stationary, y: top - rect.top };
        top += rect.height + 1;
      }
    }
    result[activeIndex] = stationary;
    return result;
  }

  function project({ rects, activeIndex, overIndex }: Layout) {
    const dragged = items[activeIndex];
    if (dragged?.kind === "group" && dragged.key === undefined) {
      return projectGroups({ rects, activeIndex, overIndex } as Layout, dragged.groupKey);
    }
    // A grouped row drags like an active one.
    const active: ThreadItem | undefined =
      dragged?.kind === "group" && dragged.key !== undefined
        ? { kind: "thread", key: dragged.key, section: "active" }
        : dragged?.kind === "thread"
          ? dragged
          : undefined;
    const over = items[overIndex] ?? dragged;
    if (active === undefined || !over || !rects[0]) return [];
    const target =
      over === dragged
        ? null
        : resolveSidebarDropTarget(items, active.key, sidebarListItemId(over));
    const overGroup =
      target === null ? null : resolveSidebarGroupTarget(items, sidebarListItemId(over));
    // Into another group the row moves whole, so no slot opens there: the group is outlined
    // instead and the row's old place stays empty until the drop. With no valid target (over
    // itself) the row also holds its place; an empty projection would snap every row back and
    // shake the list at boundaries.
    const intoOtherGroup =
      overGroup !== null && (dragged?.kind !== "group" || dragged.groupKey !== overGroup);
    const holdsPlace = target === null || intoOtherGroup;
    const targetGroup = holdsPlace ? null : overGroup;
    // Group blocks keep their place; a drop into one opens a slot under the pointer: below the
    // header, or above the hovered row.
    const groupItems: SidebarListItem[] = [];
    for (const item of items) {
      if (item.kind !== "group") continue;
      if (item === dragged) {
        if (holdsPlace) groupItems.push(active);
        continue;
      }
      const slotHere = targetGroup !== null && item === over;
      // Moving down within its own group, the slot opens below the hovered row.
      const below =
        item.key === undefined ||
        (dragged?.kind === "group" &&
          dragged.groupKey === item.groupKey &&
          items.indexOf(item) > items.indexOf(dragged));
      if (slotHere && !below) groupItems.push(active);
      groupItems.push(item);
      if (slotHere && below) groupItems.push(active);
    }
    const groups: Record<SidebarSection, ThreadItem[]> = {
      pinned: [],
      active: [],
      working: [],
      snoozed: [],
      settled: [],
    };
    let cardHeight = input.cardHeight;
    let slimHeight = input.slimHeight;
    let headerScale: number | undefined;
    for (const [index, item] of items.entries()) {
      if (item.kind === "group") continue;
      if (item.kind === "marker") {
        if (isShelfHeader(item)) {
          const height = rects[index]?.height;
          if (height) headerScale ??= height / 32;
        }
        continue;
      }
      if (item.section === "pinned" || item.section === "active" || item.section === "working")
        cardHeight ??= rects[index]?.height;
      else slimHeight ??= rects[index]?.height;
      if (item.key !== active.key || holdsPlace) groups[item.section].push(item);
    }
    const scale =
      slimHeight !== undefined ? slimHeight / 36 : (headerScale ?? (cardHeight ?? 82) / 82);
    cardHeight ??= 82 * scale;
    slimHeight ??= 36 * scale;
    const labelHeight = (input.boundaryLabelHeight ?? 0) * scale;
    if (target !== null && targetGroup === null && !holdsPlace) {
      const group = groups[target.section];
      const order =
        target.section === "pinned"
          ? target.pinnedOrder
          : target.section === "settled"
            ? input.settledOrder
            : (input.activeOrder ?? target.activeOrder);
      const ranks = new Map(order.map((key, index) => [key, index]));
      const rank = ranks.get(active.key) ?? Number.POSITIVE_INFINITY;
      const index = group.findIndex(
        (item) => (ranks.get(item.key) ?? Number.POSITIVE_INFINITY) > rank,
      );
      group.splice(index < 0 ? group.length : index, 0, { ...active, section: target.section });
    }
    const landsInSettled =
      (holdsPlace || target === null ? active.section : target.section) === "settled";
    const settledOrder = (
      input.settledOrder.length > 0 ? input.settledOrder : groups.settled.map((item) => item.key)
    ).filter((key) => key !== active.key || landsInSettled);
    const visible = input.settledExpanded
      ? settledOrder.slice(0, input.settledVisibleCount ?? settledOrder.length)
      : [];
    const routeKey = input.routeThreadKey;
    if (routeKey && settledOrder.includes(routeKey) && !visible.includes(routeKey)) {
      visible.push(routeKey);
    }
    groups.settled = visible.map((key) => ({ kind: "thread", key, section: "settled" }));
    const projected: SidebarListItem[] = [];
    const marker = (name: SidebarListMarker) => projected.push({ kind: "marker", marker: name });
    const section = (name: "active" | "settled") => {
      if (groups[name].length > 0) projected.push(...groups[name]);
      else marker(`${name}-placeholder`);
    };
    marker("pinned-header");
    projected.push(...groups.pinned);
    const workingHeaderIndex = items.findIndex(
      (item) => item.kind === "marker" && item.marker === "working-header",
    );
    const groupsInWorking =
      workingHeaderIndex !== -1 &&
      items.findIndex((item) => item.kind === "group") > workingHeaderIndex;
    marker("pinned-divider");
    if (!groupsInWorking) projected.push(...groupItems);
    if (items.some((item) => item.kind === "marker" && item.marker === "ungrouped-header")) {
      marker("ungrouped-header");
    }
    section("active");
    if (workingHeaderIndex !== -1) {
      marker("working-header");
      projected.push(...groups.working);
      if (groupsInWorking) projected.push(...groupItems);
    }
    if (
      groups.snoozed.length > 0 ||
      ((active.section !== "snoozed" || (input.snoozedThreadCount ?? 0) > 1) &&
        items.some((item) => item.kind === "marker" && item.marker === "snoozed-header"))
    ) {
      marker("snoozed-header");
      projected.push(...groups.snoozed);
    }
    marker("settled-header");
    section("settled");
    const heights = projected.map((item) => {
      const index = indices.get(sidebarListItemId(item));
      const rect = index === undefined ? undefined : rects[index];
      const fallback =
        item.kind === "thread" &&
        (item.section === "pinned" || item.section === "active" || item.section === "working")
          ? cardHeight
          : slimHeight;
      const moved = item.kind === "thread" && item.key === active.key;
      if (item.kind === "marker" && input.hiddenMarkers?.has(item.marker)) return 0;
      return item.kind === "marker" &&
        (item.marker === "pinned-header" || item.marker === "pinned-divider")
        ? labelHeight
        : item.kind === "marker" && item.marker.endsWith("placeholder")
          ? slimHeight
          : moved
            ? fallback
            : (rect?.height ?? fallback);
    });
    // The shelf that floats to the bottom is the first one with a gap above it.
    const firstShelf = items.findIndex(
      (item, index) =>
        isShelfHeader(item) &&
        (rects[index]?.top ?? 0) > (rects[index - 1]?.bottom ?? Number.POSITIVE_INFINITY) + 1,
    );
    const shelfRect = rects[firstShelf];
    const beforeShelf = rects[firstShelf - 1];
    const lastRect = rects.at(-1);
    let shelfSpace =
      shelfRect && beforeShelf && lastRect && shelfRect.top > beforeShelf.bottom + 1
        ? Math.max(
            0,
            lastRect.bottom - rects[0].top - heights.reduce((sum, height) => sum + height + 1, -1),
          )
        : 0;
    const result = items.map(() => hidden);
    let top = rects[0].top;
    for (const [projectedIndex, item] of projected.entries()) {
      // The floating shelf may have left the projection (its last row dragged out); the next one floats.
      if (
        isShelfHeader(item) &&
        (indices.get(sidebarListItemId(item)) ?? Number.POSITIVE_INFINITY) >= firstShelf
      ) {
        top += shelfSpace;
        shelfSpace = 0;
      }
      const index = indices.get(sidebarListItemId(item));
      const rect = index === undefined ? undefined : rects[index];
      if (index !== undefined && rect) result[index] = { ...stationary, y: top - rect.top };
      top += heights[projectedIndex]! + 1;
    }
    result[activeIndex] = stationary;
    return result;
  }

  return (args) => {
    if (
      previous?.rects !== args.rects ||
      previous.activeIndex !== args.activeIndex ||
      previous.overIndex !== args.overIndex
    ) {
      previous = args;
      transforms = project(args);
    }
    return transforms === null
      ? verticalListSortingStrategy(args)
      : (transforms[args.index] ?? stationary);
  };
}
