import type { OrchestrationV2BackgroundTaskOutput, ScopedThreadRef } from "@t3tools/contracts";
import { TerminalIcon } from "lucide-react";
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { create } from "zustand";

import { cn } from "~/lib/utils";
import { useThreadShell } from "~/state/entities";
import { orchestrationEnvironment } from "~/state/orchestration";
import { useAtomCommand } from "~/state/use-atom-command";

const POLL_MS = 1_000;

// The details card picks a command before the panel mounts, so the choice lives outside it.
const useSelectedTask = create<{ readonly taskId: string | null }>(() => ({ taskId: null }));
export const selectBackgroundTask = (taskId: string) => useSelectedTask.setState({ taskId });

type SeenTask = { readonly taskId: string; readonly label: string; readonly running: boolean };

/**
 * The thread's background commands, newest first, and the selected one's output. A command that
 * ends stays listed with its last output until the panel unmounts.
 */
export function BackgroundTasksPanel(props: {
  readonly threadRef: ScopedThreadRef;
  readonly visible: boolean;
}) {
  const shell = useThreadShell(props.threadRef);
  const live = (shell?.pendingBackgroundTasks ?? []).filter(
    (task) => task.kind === "command" || task.kind === "monitor",
  );
  const liveKey = live.map((task) => task.taskId).join("\n");
  const [seen, setSeen] = useState<readonly SeenTask[]>([]);
  const [seenKey, setSeenKey] = useState("");
  if (seenKey !== liveKey) {
    setSeenKey(liveKey);
    const liveIds = new Set(live.map((task) => task.taskId));
    const known = new Set(seen.map((task) => task.taskId));
    setSeen([
      ...live
        .filter((task) => !known.has(task.taskId))
        .map((task) => ({
          taskId: task.taskId,
          label: task.description?.trim() || task.taskId,
          running: true,
        }))
        .toReversed(),
      ...seen.map((task) => ({ ...task, running: liveIds.has(task.taskId) })),
    ]);
  }
  const selectedId = useSelectedTask((state) => state.taskId);
  const selected = seen.find((task) => task.taskId === selectedId) ?? seen[0] ?? null;

  if (seen.length === 0) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-2 p-6 text-center text-sm text-muted-foreground">
        <TerminalIcon aria-hidden className="size-5" />
        No background commands in this thread.
      </div>
    );
  }
  return (
    <div className="flex h-full min-h-0 flex-col">
      <ul className="flex max-h-2/5 shrink-0 flex-col gap-px overflow-y-auto border-b p-1.5">
        {seen.map((task) => (
          <li key={task.taskId}>
            <button
              type="button"
              aria-pressed={task.taskId === selected?.taskId}
              onClick={() => selectBackgroundTask(task.taskId)}
              className={cn(
                "flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm transition-colors duration-150 outline-none hover:bg-accent focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring",
                task.taskId === selected?.taskId && "bg-accent",
              )}
            >
              <span
                aria-hidden
                className={cn(
                  "size-1.5 shrink-0 rounded-full",
                  task.running ? "bg-success" : "bg-muted-foreground/50",
                )}
              />
              <span className="min-w-0 flex-1 truncate font-mono text-xs">{task.label}</span>
              <span className="shrink-0 text-xs text-muted-foreground">
                {task.running ? "Running" : "Ended"}
              </span>
            </button>
          </li>
        ))}
      </ul>
      {selected ? (
        <TaskOutput
          key={selected.taskId}
          threadRef={props.threadRef}
          taskId={selected.taskId}
          running={selected.running}
          visible={props.visible}
        />
      ) : null}
    </div>
  );
}

function TaskOutput(props: {
  readonly threadRef: ScopedThreadRef;
  readonly taskId: string;
  readonly running: boolean;
  readonly visible: boolean;
}) {
  const readOutput = useAtomCommand(orchestrationEnvironment.readBackgroundTaskOutput, {
    reportFailure: false,
  });
  const [output, setOutput] = useState<OrchestrationV2BackgroundTaskOutput | null>(null);
  const [failed, setFailed] = useState(false);
  const { environmentId, threadId } = props.threadRef;
  const { taskId, running, visible } = props;
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- polls the agent for output while the command runs and the panel shows
  useEffect(() => {
    if (!visible) return;
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const read = async () => {
      const result = await readOutput({ environmentId, input: { threadId, taskId } });
      if (cancelled) return;
      if (result._tag === "Success") {
        const next = result.value;
        // Unchanged polls keep the same object, so the view does not re-render every second.
        setOutput((current) =>
          current?.output === next.output && current.truncated === next.truncated ? current : next,
        );
        setFailed(false);
      } else setFailed(true);
      // An ended command gets this one last read.
      if (running) timer = setTimeout(read, POLL_MS);
    };
    void read();
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [environmentId, threadId, taskId, running, visible, readOutput]);
  const scrollRef = useRef<HTMLPreElement | null>(null);
  // Follows the tail only while the reader is at the bottom, so scrolling up to read stays put.
  const stuckRef = useRef(true);
  const text = output?.output;
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- keeps the scrolled DOM node at the tail as output arrives
  useLayoutEffect(() => {
    const node = scrollRef.current;
    if (node && text !== undefined && stuckRef.current) node.scrollTop = node.scrollHeight;
  }, [text]);
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      {failed && output !== null ? (
        <p className="shrink-0 px-3 pt-2 text-xs text-muted-foreground">
          Output may be out of date.
        </p>
      ) : null}
      {output?.truncated ? (
        <p className="shrink-0 px-3 pt-2 text-xs text-muted-foreground">
          Showing the last part of {Math.round(output.totalBytes / 1024)} KB.
        </p>
      ) : null}
      <pre
        ref={scrollRef}
        tabIndex={0}
        role="log"
        aria-label="Command output"
        aria-live="off"
        onScroll={(event) => {
          const node = event.currentTarget;
          stuckRef.current = node.scrollHeight - node.scrollTop - node.clientHeight < 24;
        }}
        className="min-h-0 flex-1 overflow-auto px-3 py-2 font-mono text-xs leading-relaxed whitespace-pre-wrap wrap-anywhere outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
      >
        {output === null
          ? failed
            ? "Output unavailable: the agent session may have ended."
            : "Loading…"
          : output.output.length > 0
            ? output.output
            : "No output yet."}
      </pre>
    </div>
  );
}
