// Entry for the isolated fs-watcher child process. Emitted as
// dist/main/fs-watcher-subprocess.js, side-by-side with host-service.js so
// SubprocessWatcherManager's sibling-path resolution finds it. All logic lives
// in @superset/workspace-fs so host-service and the desktop main process share
// one implementation.
import { listGitIgnoredDirs } from "@superset/host-service/git";
import { runFsWatcherSubprocess } from "@superset/workspace-fs/host";

runFsWatcherSubprocess({ managerOptions: { listGitIgnoredDirs } });
