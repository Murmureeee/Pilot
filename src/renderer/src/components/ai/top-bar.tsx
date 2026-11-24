// @env browser
// 菜单动作走 IPC 白名单（编辑类为 webContents 原生实现）。
import { useEffect, useState, type JSX } from "react";
import {
  ArrowLeftIcon,
  ArrowRightIcon,
  MenuIcon,
  PanelLeftCloseIcon,
  PanelLeftOpenIcon,
} from "lucide-react";
import { UpdatePanel } from "@renderer/components/ai/update-panel";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@renderer/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuShortcut,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from "@renderer/components/ui/dropdown-menu";
import { t, useLocale } from "@renderer/lib/i18n";
import { useAgentStore } from "@renderer/stores/agent";
import { useUpdateStore } from "@renderer/stores/update";
import { canBack, canForward } from "@renderer/lib/nav";
import { APP_NAME } from "@shared/constants";
import type { AppInfo, MenuAction } from "@shared/contract";
import { cn } from "cn";

function Item({
  label,
  shortcut,
  onRun,
  disabled,
  destructive,
}: {
  label: string;
  shortcut?: string;
  onRun(): void;
  disabled?: boolean;
  destructive?: boolean;
}): JSX.Element {
  return (
    <DropdownMenuItem
      disabled={disabled}
      onClick={() => onRun()}
      className={cn(destructive && "text-destructive data-disabled:text-destructive/50")}
    >
      {label}
      {shortcut && <DropdownMenuShortcut>{shortcut}</DropdownMenuShortcut>}
    </DropdownMenuItem>
  );
}

export function TopBar({
  collapsed,
  onToggleSidebar,
}: {
  collapsed: boolean;
  onToggleSidebar(): void;
}): JSX.Element {
  const locale = useLocale();
  const nav = useAgentStore((s) => s.nav);
  const navBack = useAgentStore((s) => s.navBack);
  const navForward = useAgentStore((s) => s.navForward);
  const newSession = useAgentStore((s) => s.newSession);
  const selectProject = useAgentStore((s) => s.selectProject);
  const choosingProject = useAgentStore((s) => s.choosingProject);
  const setView = useAgentStore((s) => s.setView);
  const setPaletteOpen = useAgentStore((s) => s.setPaletteOpen);
  const menuAction = useAgentStore((s) => s.menuAction);
  const dialog = useUpdateStore((s) => s.dialog);
  const setDialog = useUpdateStore((s) => s.setDialog);
  const [appInfo, setAppInfo] = useState<AppInfo | null>(null);
  const sidebarLabel = t(collapsed ? "显示侧边栏" : "隐藏侧边栏", locale);
  const menuLabel = t("应用菜单", locale);
  const aboutLabel = t("关于 {0}", locale, [APP_NAME]);
  const isAbout = dialog === "about";
  const SidebarIcon = collapsed ? PanelLeftOpenIcon : PanelLeftCloseIcon;

  useEffect(() => useUpdateStore.getState().subscribe(), []);

  useEffect(() => {
    if (!isAbout) return;
    void window.pi.getAppInfo().then(setAppInfo);
  }, [isAbout]);

  const run = (action: MenuAction): void => {
    void menuAction(action);
  };

  return (
    <>
      <div className="app-no-drag flex shrink-0 items-center gap-0.5">
        <DropdownMenu>
          <DropdownMenuTrigger
            render={
              <button
                type="button"
                className="app-titlebar-control data-popup-open:bg-sidebar-foreground/8 w-7"
                aria-label={menuLabel}
                title={menuLabel}
              />
            }
          >
            <MenuIcon className="size-4" strokeWidth={1.7} aria-hidden="true" />
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start" className="min-w-56">
            <DropdownMenuGroup>
              <Item
                label={t("新聊天", locale)}
                shortcut="Ctrl+N"
                onRun={() => {
                  setView("chat");
                  void newSession();
                }}
              />
              <Item
                label={t("打开项目…", locale)}
                shortcut="Ctrl+O"
                disabled={choosingProject}
                onRun={() => void selectProject()}
              />
              <Item
                label={t("搜索…", locale)}
                shortcut="Ctrl+K"
                onRun={() => setPaletteOpen(true)}
              />
            </DropdownMenuGroup>
            <DropdownMenuSeparator />
            <DropdownMenuGroup>
              <DropdownMenuSub>
                <DropdownMenuSubTrigger>{t("视图", locale)}</DropdownMenuSubTrigger>
                <DropdownMenuSubContent className="min-w-52">
                  <DropdownMenuGroup>
                    <Item label={sidebarLabel} shortcut="Ctrl+Shift+S" onRun={onToggleSidebar} />
                  </DropdownMenuGroup>
                  <DropdownMenuSeparator />
                  <DropdownMenuGroup>
                    <Item
                      label={t("放大", locale)}
                      shortcut="Ctrl+="
                      onRun={() => run("zoom-in")}
                    />
                    <Item
                      label={t("缩小", locale)}
                      shortcut="Ctrl+-"
                      onRun={() => run("zoom-out")}
                    />
                    <Item
                      label={t("实际大小", locale)}
                      shortcut="Ctrl+0"
                      onRun={() => run("zoom-reset")}
                    />
                  </DropdownMenuGroup>
                  <DropdownMenuSeparator />
                  <DropdownMenuGroup>
                    <Item
                      label={t("切换全屏", locale)}
                      shortcut="F11"
                      onRun={() => run("fullscreen")}
                    />
                    <Item
                      label={t("重新加载", locale)}
                      shortcut="Ctrl+R"
                      onRun={() => run("reload")}
                    />
                  </DropdownMenuGroup>
                </DropdownMenuSubContent>
              </DropdownMenuSub>
              <DropdownMenuSub>
                <DropdownMenuSubTrigger>{t("编辑", locale)}</DropdownMenuSubTrigger>
                <DropdownMenuSubContent className="min-w-44">
                  <DropdownMenuGroup>
                    <Item label={t("撤销", locale)} shortcut="Ctrl+Z" onRun={() => run("undo")} />
                    <Item label={t("重做", locale)} shortcut="Ctrl+Y" onRun={() => run("redo")} />
                  </DropdownMenuGroup>
                  <DropdownMenuSeparator />
                  <DropdownMenuGroup>
                    <Item label={t("剪切", locale)} shortcut="Ctrl+X" onRun={() => run("cut")} />
                    <Item label={t("复制", locale)} shortcut="Ctrl+C" onRun={() => run("copy")} />
                    <Item label={t("粘贴", locale)} shortcut="Ctrl+V" onRun={() => run("paste")} />
                    <Item label={t("删除", locale)} onRun={() => run("delete")} />
                    <Item
                      label={t("全选", locale)}
                      shortcut="Ctrl+A"
                      onRun={() => run("select-all")}
                    />
                  </DropdownMenuGroup>
                </DropdownMenuSubContent>
              </DropdownMenuSub>
            </DropdownMenuGroup>
            <DropdownMenuSeparator />
            <DropdownMenuGroup>
              <Item label={t("设置", locale)} shortcut="Ctrl+," onRun={() => setView("settings")} />
              <Item
                label={t("检查更新…", locale)}
                onRun={() => {
                  setDialog("update");
                  void useUpdateStore.getState().check();
                }}
              />
              <Item label={aboutLabel} onRun={() => setDialog("about")} />
            </DropdownMenuGroup>
            <DropdownMenuSeparator />
            <DropdownMenuGroup>
              <Item label={t("关闭窗口", locale)} shortcut="Ctrl+W" onRun={() => run("close")} />
              <Item
                label={t("退出 {0}", locale, [APP_NAME])}
                shortcut="Ctrl+Q"
                onRun={() => run("quit")}
                destructive
              />
            </DropdownMenuGroup>
          </DropdownMenuContent>
        </DropdownMenu>
        <span aria-hidden="true" className="bg-sidebar-border mx-1.5 h-3.5 w-px shrink-0" />
        <button
          type="button"
          className="app-titlebar-control w-7"
          disabled={!canBack(nav)}
          onClick={() => void navBack()}
          aria-label={t("后退 (Ctrl+[)", locale)}
          title={t("后退 (Ctrl+[)", locale)}
        >
          <ArrowLeftIcon className="size-4" strokeWidth={1.7} aria-hidden="true" />
        </button>
        <button
          type="button"
          className="app-titlebar-control w-7"
          disabled={!canForward(nav)}
          onClick={() => void navForward()}
          aria-label={t("前进 (Ctrl+])", locale)}
          title={t("前进 (Ctrl+])", locale)}
        >
          <ArrowRightIcon className="size-4" strokeWidth={1.7} aria-hidden="true" />
        </button>
        <button
          type="button"
          className="app-titlebar-control w-7"
          onClick={onToggleSidebar}
          aria-label={sidebarLabel}
          aria-expanded={!collapsed}
          aria-controls="sidebar-panel"
          title={sidebarLabel}
        >
          <SidebarIcon className="size-4" strokeWidth={1.7} aria-hidden="true" />
        </button>
      </div>

      <Dialog open={dialog !== null} onOpenChange={(open) => !open && setDialog(null)}>
        <DialogContent closeLabel={t("关闭", locale)} className="gap-4 sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>{isAbout ? aboutLabel : t("软件更新", locale)}</DialogTitle>
            {isAbout && (
              <DialogDescription>
                {t("基于 pi（earendil-works/pi）构建的桌面 AI Agent 应用。", locale)}
              </DialogDescription>
            )}
          </DialogHeader>
          {isAbout && (
            <div className="text-muted-foreground border-b pb-3 font-mono text-xs">
              <p>
                {t("版本", locale)} {appInfo?.version ?? "…"}
              </p>
              {appInfo?.isDev && <p>{t("开发模式", locale)}</p>}
            </div>
          )}
          <UpdatePanel locale={locale} />
        </DialogContent>
      </Dialog>
    </>
  );
}
