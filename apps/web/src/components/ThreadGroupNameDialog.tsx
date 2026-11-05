import { useEffect, useId, useState } from "react";
import { create } from "zustand";

import { Button } from "./ui/button";
import {
  Dialog,
  DialogFooter,
  DialogHeader,
  DialogPanel,
  DialogPopup,
  DialogTitle,
} from "./ui/dialog";
import { Input } from "./ui/input";
import { Label } from "./ui/label";

type Request = {
  readonly title: string;
  readonly submitLabel: string;
  readonly initialName: string;
  readonly resolve: (name: string | null) => void;
};

const useRequest = create<{ request: Request | null }>(() => ({ request: null }));

/** Asks for a thread group name; resolves null when dismissed. */
export function requestThreadGroupName(input: {
  readonly title: string;
  readonly submitLabel: string;
  readonly initialName?: string;
}): Promise<string | null> {
  useRequest.getState().request?.resolve(null);
  return new Promise((resolve) =>
    useRequest.setState({
      request: { ...input, initialName: input.initialName ?? "", resolve },
    }),
  );
}

function finish(name: string | null) {
  const request = useRequest.getState().request;
  useRequest.setState({ request: null });
  request?.resolve(name);
}

export function ThreadGroupNameDialogHost() {
  const request = useRequest((state) => state.request);
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- resolves a pending name request with null when the host unmounts
  useEffect(() => () => finish(null), []);
  return request ? <ThreadGroupNameDialog request={request} /> : null;
}

function ThreadGroupNameDialog(props: { request: Request }) {
  const id = useId();
  const [name, setName] = useState(props.request.initialName);
  const trimmed = name.trim();
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) finish(null);
      }}
    >
      <DialogPopup className="sm:max-w-sm">
        <form
          className="flex min-h-0 flex-col"
          onSubmit={(event) => {
            event.preventDefault();
            if (trimmed !== "") finish(trimmed.slice(0, 80));
          }}
        >
          <DialogHeader>
            <DialogTitle>{props.request.title}</DialogTitle>
          </DialogHeader>
          <DialogPanel>
            <div className="flex flex-col gap-2">
              <Label htmlFor={`${id}-name`}>Name</Label>
              <Input
                id={`${id}-name`}
                autoFocus
                maxLength={80}
                value={name}
                onChange={(event) => setName(event.target.value)}
              />
            </div>
          </DialogPanel>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => finish(null)}>
              Cancel
            </Button>
            <Button type="submit" disabled={trimmed === ""}>
              {props.request.submitLabel}
            </Button>
          </DialogFooter>
        </form>
      </DialogPopup>
    </Dialog>
  );
}
