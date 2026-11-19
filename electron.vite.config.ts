import { resolve } from 'node:path'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { defineConfig, externalizeDepsPlugin } from 'electron-vite'

// pi 是纯 TS 包，随主进程打包（不走 node_modules 外置）
const PI_PACKAGES = ['@earendil-works/pi-agent-core', '@earendil-works/pi-ai', '@earendil-works/pi-schema', '@earendil-works/pi-mcp']

export default defineConfig({
  main: {
    plugins: [externalizeDepsPlugin({ exclude: PI_PACKAGES })],
    resolve: {
      alias: { '@shared': resolve('src/shared') },
    },
  },
  preload: {
    plugins: [externalizeDepsPlugin()],
    resolve: {
      alias: { '@shared': resolve('src/shared') },
    },
  },
  renderer: {
    resolve: {
      alias: {
        '@renderer': resolve('src/renderer/src'),
        '@shared': resolve('src/shared'),
      },
    },
    plugins: [react(), tailwindcss()],
  },
})
