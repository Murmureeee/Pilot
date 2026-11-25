# Pilot

Pilot is a desktop AI workspace built on pi. Start a chat to work with an agent on files and commands in a folder, then pick up where you left off from your conversation history.

[简体中文](../README.md) · [Download the latest release](https://github.com/Murmureeee/Pilot/releases/latest) · [Changelog (Chinese)](../CHANGELOG.md) · [Roadmap (Chinese)](./PLAN.md) · [Design guidelines (Chinese)](./DESIGN.md) · [Development history (Chinese)](./DEVELOPMENT_HISTORY.md)

## Download and update

Download the package for your platform from **Assets**. Each release page describes its changes in Chinese. [Latest stable release](https://github.com/Murmureeee/Pilot/releases/latest)

| Platform | Release file |
| --- | --- |
| Windows x64 | `pilot-<version>-x64-setup.exe` |
| Linux x64 | `pilot-<version>-linux-x86_64.AppImage` or `pilot-<version>-linux-amd64.deb` |

Linux packages are available starting with the first release built by the Linux workflow. Make the AppImage executable before running it. On Debian, Ubuntu, or a derivative, install the Debian package with `sudo apt install ./pilot-<version>-linux-amd64.deb`.

Packages with in-app updates check for and download updates on launch. To check manually, open **App menu → Check for updates…**. On Windows and AppImage, choose **Update and restart** after the download. For a Debian package, choose **Open download location**, install the package with your system package manager, and reopen Pilot. Linux users on v0.5.0 or earlier need to install a newer package from Releases once.

## Get started

1. On first launch, choose the built-in demo model to try a chat, or configure an Anthropic or OpenAI-compatible service and select a model.
2. Choose a working directory under **Settings → General**. Set the approval mode in the chat and respond to prompts when the agent requests permission to edit files or run commands.
3. Open **Settings → Import** to preview skills, MCP servers, and plugin components from Codex or Claude Code. Select the items you want and confirm the import.

## Features

- **Chats and task plans.** Stream responses, read Markdown, and resume saved conversations and task plans.
- **Files and commands.** Read, search, and edit files in the working directory. Run commands in PowerShell or Git Bash on Windows and Bash on Linux, using the approval mode you choose.
- **Skills and MCP.** Manage local `SKILL.md` skills, configure stdio or Streamable HTTP MCP servers, and import supported skills and MCP configurations from external plugins.
- **Personalization.** Switch between Simplified Chinese and English, change themes, and set custom instructions for all chats or a single conversation.

## Run from source

Development uses Node.js 26 and pnpm 11. Close running Electron development instances, then run these commands from the repository root. [Build workflow](../.github/workflows/windows.yml)

```sh
pnpm install --frozen-lockfile
pnpm dev
```

Run `pnpm build` to build the app. Use `pnpm package:win` on Windows or `pnpm package:linux` on Linux x64 to build the platform packages. [Roadmap](./PLAN.md)
