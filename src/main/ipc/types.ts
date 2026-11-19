// @env node
import type { IPC } from "../../shared/contract";

export type IpcChannel = (typeof IPC)[keyof typeof IPC];
