// @env node
export const MAX_FILE_SNAPSHOT_BYTES = 256 * 1024;
export const MAX_DIFF_SEARCH_DISTANCE = 512;
export const MAX_DIFF_COMPARISONS = 1_000_000;
export const MAX_DIFF_PREVIEW_LINES = 700;
export const MAX_DIRECTORY_PREVIEW_ENTRIES = 200;
export const DIFF_CONTEXT_LINES = 3;
export const GIT_STATUS_MAX_BYTES = 8 * 1024 * 1024;
export const GIT_STATUS_TIMEOUT_MS = 5000;
export const GIT_FILE_READ_CONCURRENCY = 16;
export const MAX_GIT_CHECKPOINT_BYTES = 8 * 1024 * 1024;
export const GIT_COMMIT_TIMEOUT_MS = 60_000;
export const GIT_REMOTE_READ_TIMEOUT_MS = 20_000;
export const GIT_PUBLISH_TIMEOUT_MS = 60_000;
export const GIT_BRANCH_REF_PREFIX = "refs/heads/";
export const GIT_OBJECT_ID = /^(?:[0-9a-f]{40}|[0-9a-f]{64})$/;
export const TASKKILL_TIMEOUT_MS = 5_000;
