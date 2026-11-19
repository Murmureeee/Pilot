// @env browser
// 会话导航栈（前进/后退）：纯函数，NFR-6 测试覆盖。
export interface NavState {
  stack: string[];
  index: number;
}

export function initialNavState(): NavState {
  return { stack: [], index: -1 };
}

/** 记录一次用户主动跳转：截断前进分支；重复访问当前会话不重复入栈 */
export function pushNav(state: NavState, id: string): NavState {
  if (state.stack[state.index] === id) return state;
  const stack = [...state.stack.slice(0, state.index + 1), id];
  return { stack, index: stack.length - 1 };
}

export function canBack(state: NavState): boolean {
  return state.index > 0;
}

export function canForward(state: NavState): boolean {
  return state.index < state.stack.length - 1;
}

/** 回退/前进后的目标会话 id；不可移动时返回 undefined */
export function peekNav(state: NavState, direction: "back" | "forward"): string | undefined {
  if (direction === "back" && canBack(state)) return state.stack[state.index - 1];
  if (direction === "forward" && canForward(state)) return state.stack[state.index + 1];
  return undefined;
}

export function moveNav(state: NavState, direction: "back" | "forward"): NavState {
  if (peekNav(state, direction) === undefined) return state;
  return { ...state, index: direction === "back" ? state.index - 1 : state.index + 1 };
}
