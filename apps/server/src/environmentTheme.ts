// @effect-diagnostics nodeBuiltinImport:off - the guarded file read needs open
// flags (O_NOFOLLOW, O_NONBLOCK) the FileSystem service does not expose.
import * as NodeFS from "node:fs";

import {
  EnvironmentTheme,
  EnvironmentThemeFile,
  EnvironmentThemeId,
  environmentThemeFileHasColors,
} from "@t3tools/contracts";
import * as HostProcess from "@t3tools/shared/HostProcess";
import { UNPUBLISHABLE_THEME_IDS } from "@t3tools/shared/themePalettes";
import * as Cause from "effect/Cause";
import * as Context from "effect/Context";
import * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";
import * as Equal from "effect/Equal";
import * as Exit from "effect/Exit";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as PubSub from "effect/PubSub";
import * as Ref from "effect/Ref";
import * as Schema from "effect/Schema";
import * as Semaphore from "effect/Semaphore";
import * as Scope from "effect/Scope";
import * as Stream from "effect/Stream";

import * as ServerConfig from "./config.ts";

const decodeEnvironmentThemeFileJsonExit = Schema.decodeUnknownExit(
  Schema.fromJsonString(EnvironmentThemeFile),
);
const isEnvironmentThemeId = Schema.is(EnvironmentThemeId);

const THEME_FILE_SUFFIX = ".json";

const MAX_THEME_FILES = 32;
/** Shared with publishing so it cannot accept files the watcher skips. */
export const MAX_THEME_FILE_BYTES = 32 * 1024;
const MAX_THEME_TOTAL_BYTES = 192 * 1024;

interface PublishedThemes {
  readonly seq: number;
  readonly themes: ReadonlyArray<EnvironmentTheme>;
}

export class EnvironmentThemeService extends Context.Service<
  EnvironmentThemeService,
  {
    readonly current: Effect.Effect<ReadonlyArray<EnvironmentTheme>>;

    /** Subscribes before reading to retain changes during connection. */
    readonly streamChanges: Stream.Stream<ReadonlyArray<EnvironmentTheme>>;
  }
>()("t3/environmentTheme/EnvironmentThemeService") {}

/** Validates and reads one handle; rejects symlinked files, allows symlinked directories.
 * Uses non-blocking opens against FIFOs; Windows lacks these flags and checks symlinks with lstat. */
export const readThemeFileGuarded = (filePath: string, maxBytes: number): string | null => {
  let fd: number;
  try {
    if (NodeFS.constants.O_NOFOLLOW === undefined && NodeFS.lstatSync(filePath).isSymbolicLink()) {
      return null;
    }
    fd = NodeFS.openSync(
      filePath,
      NodeFS.constants.O_RDONLY |
        (NodeFS.constants.O_NOFOLLOW ?? 0) |
        (NodeFS.constants.O_NONBLOCK ?? 0),
    );
  } catch {
    return null;
  }
  try {
    const info = NodeFS.fstatSync(fd);
    if (!info.isFile() || info.size > maxBytes) return null;
    const contents = Buffer.alloc(info.size);
    let offset = 0;
    while (offset < contents.length) {
      const read = NodeFS.readSync(fd, contents, offset, contents.length - offset, offset);
      if (read <= 0) break;
      offset += read;
    }
    return contents.subarray(0, offset).toString("utf8");
  } catch {
    return null;
  } finally {
    NodeFS.closeSync(fd);
  }
};

const readThemeFile = Effect.fn(function* (filePath: string) {
  const raw = readThemeFileGuarded(filePath, MAX_THEME_FILE_BYTES);
  if (raw === null) {
    yield* Effect.logWarning("ignoring unusable environment theme file", {
      path: filePath,
      limit: MAX_THEME_FILE_BYTES,
    });
    return null;
  }
  if (raw.trim().length === 0) return null;

  const decoded = decodeEnvironmentThemeFileJsonExit(raw);
  if (decoded._tag === "Failure") {
    yield* Effect.logWarning("ignoring invalid environment theme", {
      path: filePath,
      detail: Cause.pretty(decoded.cause),
    });
    return null;
  }
  if (!environmentThemeFileHasColors(decoded.value)) {
    yield* Effect.logWarning("ignoring environment theme without colors", { path: filePath });
    return null;
  }
  return { raw, file: decoded.value };
});

/**
 * Omarchy renders a T3 Code palette into its current theme on every theme switch. Reading it
 * here follows the switch under any T3 home, not only the ~/.t3 Omarchy's sync script copies to.
 */
export const omarchyThemePaths = (homeDirectory: string) => {
  const currentDir = `${homeDirectory}/.local/state/omarchy/current`;
  return { currentDir, file: `${currentDir}/theme/t3code.json` };
};
const OMARCHY_THEME_ID = EnvironmentThemeId.make("omarchy");

export const readPublishedThemes = Effect.fn(function* (
  themesDir: string,
  omarchyThemeFile?: string,
) {
  const fs = yield* FileSystem.FileSystem;
  const entries = yield* fs
    .readDirectory(themesDir)
    .pipe(Effect.orElseSucceed((): Array<string> => []));

  const themes: Array<EnvironmentTheme> = [];
  let examined = 0;
  let totalBytes = 0;
  for (const entry of entries.toSorted()) {
    if (!entry.endsWith(THEME_FILE_SUFFIX)) continue;
    const id = entry.slice(0, -THEME_FILE_SUFFIX.length);
    // Reserved ids shadow built-ins or capture clients that never chose them.
    if (!isEnvironmentThemeId(id) || UNPUBLISHABLE_THEME_IDS.has(id)) continue;

    // Cap examined files, not accepted themes, to bound work on malformed directories.
    examined += 1;
    if (examined > MAX_THEME_FILES) {
      yield* Effect.logWarning("ignoring environment theme files past the limit", {
        path: themesDir,
        limit: MAX_THEME_FILES,
      });
      break;
    }

    const read = yield* readThemeFile(`${themesDir}/${entry}`);
    if (read === null) continue;
    const { raw, file } = read;

    totalBytes += Buffer.byteLength(raw);
    if (totalBytes > MAX_THEME_TOTAL_BYTES) {
      yield* Effect.logWarning("ignoring environment themes past the total size limit", {
        path: themesDir,
        limit: MAX_THEME_TOTAL_BYTES,
      });
      break;
    }

    themes.push({ id, ...file });
  }
  // A published omarchy.json, such as the copy Omarchy's sync script writes, wins.
  if (omarchyThemeFile !== undefined && !themes.some((theme) => theme.id === OMARCHY_THEME_ID)) {
    const omarchy = NodeFS.existsSync(omarchyThemeFile)
      ? yield* readThemeFile(omarchyThemeFile)
      : null;
    if (omarchy !== null) themes.push({ id: OMARCHY_THEME_ID, ...omarchy.file });
  }
  return themes;
});

const make = Effect.gen(function* () {
  const { environmentThemesDir } = yield* ServerConfig.ServerConfig;
  const fs = yield* FileSystem.FileSystem;
  const omarchy = omarchyThemePaths(yield* HostProcess.HomeDirectory);
  // Sequence numbers let subscribers drop queued events older than their initial snapshot.
  const changes = yield* PubSub.sliding<PublishedThemes>(1);
  const published = yield* Ref.make<PublishedThemes>({ seq: 0, themes: [] });
  // Serialize read/compare/publish so slow older reads cannot publish with newer sequence numbers.
  const refreshSemaphore = yield* Semaphore.make(1);
  const watcherScope = yield* Scope.make("sequential");
  yield* Effect.addFinalizer(() => Scope.close(watcherScope, Exit.void));

  const refresh = refreshSemaphore.withPermits(1)(
    Effect.gen(function* () {
      const themes = yield* readPublishedThemes(environmentThemesDir, omarchy.file).pipe(
        Effect.provideService(FileSystem.FileSystem, fs),
      );
      // Compare the whole value so new fields cannot silently miss republishes.
      const [changed, next] = yield* Ref.modify(
        published,
        (previous): readonly [readonly [boolean, PublishedThemes], PublishedThemes] => {
          if (Equal.equals(previous.themes, themes)) return [[false, previous], previous];
          const updated: PublishedThemes = { seq: previous.seq + 1, themes };
          return [[true, updated], updated];
        },
      );
      if (changed) yield* PubSub.publish(changes, next).pipe(Effect.asVoid);
      return next;
    }),
  );

  yield* fs
    .makeDirectory(environmentThemesDir, { recursive: true })
    .pipe(Effect.ignoreCause({ log: true }));

  // A save emits several events, and fs.watch can fire before content is flushed.
  const watchEvents = fs.watch(environmentThemesDir).pipe(Stream.debounce(Duration.millis(100)));

  yield* refresh;
  yield* Stream.runForEach(watchEvents, () => refresh.pipe(Effect.ignoreCause({ log: true }))).pipe(
    Effect.ignoreCause({ log: true }),
    Effect.forkIn(watcherScope),
    Effect.asVoid,
  );
  // Omarchy swaps the theme directory on a switch, so watch its parent, which the switch touches.
  if (NodeFS.existsSync(omarchy.currentDir)) {
    const omarchyEvents = fs.watch(omarchy.currentDir).pipe(Stream.debounce(Duration.millis(250)));
    yield* Stream.runForEach(omarchyEvents, () =>
      refresh.pipe(Effect.ignoreCause({ log: true })),
    ).pipe(Effect.ignoreCause({ log: true }), Effect.forkIn(watcherScope), Effect.asVoid);
  }

  return {
    current: Effect.map(refresh, (state) => state.themes),
    get streamChanges() {
      return Stream.unwrap(
        Effect.gen(function* () {
          const subscription = yield* PubSub.subscribe(changes);
          const snapshot = yield* refresh;
          return Stream.concat(
            Stream.make(snapshot.themes),
            Stream.fromSubscription(subscription).pipe(
              Stream.filter((update) => update.seq > snapshot.seq),
              Stream.map((update) => update.themes),
            ),
          );
        }),
      );
    },
  } satisfies EnvironmentThemeService["Service"];
});

export const layer = Layer.effect(EnvironmentThemeService, make);
