import type { ScopedThreadRef } from "@t3tools/client-runtime/environment";
import {
  isAtomCommandInterrupted,
  squashAtomCommandFailure,
} from "@t3tools/client-runtime/state/runtime";
import type { EnvironmentId, ThreadGroup } from "@t3tools/contracts";

import { toastManager } from "~/components/ui/toast";
import { appAtomRegistry } from "~/rpc/atomRegistry";
import { serverEnvironment } from "~/state/server";
import { threadEnvironment } from "~/state/threads";
import { useAtomCommand } from "~/state/use-atom-command";

const EMPTY_GROUPS: ReadonlyArray<ThreadGroup> = [];

export function readThreadGroups(environmentId: EnvironmentId): ReadonlyArray<ThreadGroup> {
  return (
    appAtomRegistry.get(serverEnvironment.settingsValueAtom(environmentId))?.threadGroups ??
    EMPTY_GROUPS
  );
}

function reportFailure(title: string, result: Parameters<typeof squashAtomCommandFailure>[0]) {
  if (isAtomCommandInterrupted(result)) return;
  const error = squashAtomCommandFailure(result);
  toastManager.add({
    type: "error",
    title,
    description: error instanceof Error ? error.message : "An error occurred.",
  });
}

/**
 * Group definitions live in each environment's server settings, so every client of that
 * environment sees the same groups; a thread's `groupId` points into that list.
 */
export function useThreadGroupActions() {
  const persistSettings = useAtomCommand(serverEnvironment.updateSettings, {
    reportFailure: false,
  });
  const setGroup = useAtomCommand(threadEnvironment.setGroup, { reportFailure: false });

  const saveGroups = async (environmentId: EnvironmentId, groups: ReadonlyArray<ThreadGroup>) => {
    const result = await persistSettings({
      environmentId,
      input: { patch: { threadGroups: groups } },
    });
    if (result._tag === "Failure") reportFailure("Could not save groups", result);
    return result._tag === "Success";
  };

  const moveThread = async (target: ScopedThreadRef, groupId: string | null) => {
    const result = await setGroup({
      environmentId: target.environmentId,
      input: { threadId: target.threadId, groupId },
    });
    if (result._tag === "Failure") reportFailure("Could not move thread", result);
  };

  return {
    moveThread,
    /** Creates the group with `target` in it; an empty group would not show. */
    createGroup: async (
      environmentId: EnvironmentId,
      name: string,
      target: ScopedThreadRef,
    ): Promise<void> => {
      const group = { id: `grp-${crypto.randomUUID()}`, name };
      if (!(await saveGroups(environmentId, [...readThreadGroups(environmentId), group]))) return;
      await moveThread(target, group.id);
    },
    renameGroup: (environmentId: EnvironmentId, groupId: string, name: string) =>
      saveGroups(
        environmentId,
        readThreadGroups(environmentId).map((group) =>
          group.id === groupId ? { ...group, name } : group,
        ),
      ),
    // Threads keep the stale id; an unknown group reads as none, so nothing else is rewritten.
    deleteGroup: (environmentId: EnvironmentId, groupId: string) =>
      saveGroups(
        environmentId,
        readThreadGroups(environmentId).filter((group) => group.id !== groupId),
      ),
  };
}
