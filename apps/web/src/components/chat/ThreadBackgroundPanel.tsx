import { scopeThreadRef } from "@t3tools/client-runtime/environment";
import type { EnvironmentId, ThreadId } from "@t3tools/contracts";
import { TerminalIcon } from "lucide-react";

import { useRightPanelStore } from "../../rightPanelStore";
import { useThreadShell } from "../../state/entities";
import { selectBackgroundTask } from "./BackgroundTasksPanel";
import { ThreadDetailsControl } from "./ThreadDetailsControl";
import { ThreadDetailsSection } from "./ThreadDetailsSection";
import { THREAD_DETAILS_PANEL_ICON_CLASS } from "./threadDetailsPanelStyles";

/** The thread's running background commands; a click opens that command's output. Hidden while none run. */
export function ThreadBackgroundPanel(props: {
  readonly environmentId: EnvironmentId;
  readonly threadId: ThreadId;
}) {
  const threadRef = scopeThreadRef(props.environmentId, props.threadId);
  const shell = useThreadShell(threadRef);
  const tasks = (shell?.pendingBackgroundTasks ?? []).filter(
    (task) => task.kind === "command" || task.kind === "monitor",
  );
  if (tasks.length === 0) return null;
  return (
    <ThreadDetailsSection headingId="thread-details-background-heading" title="Background">
      <ul className="m-0 list-none p-0">
        {tasks.toReversed().map((task) => (
          <li key={task.taskId}>
            <ThreadDetailsControl
              size="sm"
              variant="ghost"
              part="row"
              onClick={() => {
                selectBackgroundTask(task.taskId);
                useRightPanelStore.getState().open(threadRef, "tasks");
              }}
            >
              <TerminalIcon aria-hidden className={THREAD_DETAILS_PANEL_ICON_CLASS} />
              <span className="min-w-0 flex-1 truncate">
                {task.description?.trim() || task.taskId}
              </span>
              <span aria-hidden className="size-1.5 shrink-0 rounded-full bg-success" />
            </ThreadDetailsControl>
          </li>
        ))}
      </ul>
    </ThreadDetailsSection>
  );
}
