# Pilot

Pilot is a desktop AI workspace built on pi. Start a chat to work with an agent on files and commands in a folder, then pick up where you left off from your conversation history.

[简体中文](./README.md) · [Download the latest release](https://github.com/Murmureeee/Pilot/releases/latest) · [Changelog (Chinese)](./CHANGELOG.md) · [Roadmap (Chinese)](./PLAN.md)

## Download and update

Pilot is available for **Windows x64**. Open the [latest stable release](https://github.com/Murmureeee/Pilot/releases/latest), expand **Assets**, and download `pi-desktop-<version>-x64-setup.exe`. Each release page describes its changes in Chinese.

Open **Help → About Pilot** to check for updates in the installed app. Once the download finishes, confirm when you want Pilot to quit and install it.

## Get started

1. On first launch, choose the built-in demo model to try a chat, or configure an Anthropic or OpenAI-compatible service and select a model.
2. Choose a working directory under **Settings → General**. Set the approval mode in the chat and respond to prompts when the agent requests permission to edit files or run commands.
3. Open **Settings → Import** to preview skills, MCP servers, and plugin components from Codex or Claude Code. Select the items you want and confirm the import.

## Features

- **Chats and task plans.** Stream responses, read Markdown, and resume saved conversations and task plans.
- **Files and commands.** Read, search, and edit files in the working directory, and run commands in PowerShell or Git Bash with the approval mode you choose.
- **Skills and MCP.** Manage local `SKILL.md` skills, configure stdio or Streamable HTTP MCP servers, and import supported skills and MCP configurations from external plugins.
- **Personalization.** Switch between Simplified Chinese and English, change themes, and set custom instructions for all chats or a single conversation.

## Run from source

Windows development uses Node.js 26 and pnpm 11. The [build workflow](./.github/workflows/windows.yml) pins the exact versions. Close running Electron development instances, then run these commands from the repository root.

```sh
pnpm install --frozen-lockfile
pnpm dev
```

Run `pnpm build` to build the app or `pnpm package:win` to build a Windows installer. The [roadmap](./PLAN.md) tracks local model testing, additional languages, and scheduled tasks.
