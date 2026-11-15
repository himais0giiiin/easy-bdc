import { defineConfig } from 'vite';
import path from 'path';
import { glob } from 'glob';
import { fileURLToPath } from 'url';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const versionHash = createHash('sha256');
for (const file of glob.sync('**/*.{html,js,ts,css,json,svg}', {
  ignore: ['node_modules/**', 'dist/**', '.git/**', 'output/**', '.playwright-cli/**'],
}).sort()) {
  versionHash.update(file).update(readFileSync(file));
}
const buildVersion = process.env.GITHUB_SHA || versionHash.digest('hex').slice(0, 20);

// プロジェクト内のHTMLファイルを自動的に取得
const getHtmlEntries = () => {
  const htmlFiles = glob.sync('**/*.html', {
    ignore: ['node_modules/**', 'dist/**', '.git/**', 'output/**'],
  });

  return Object.fromEntries(
    htmlFiles.map((file) => {
      // ファイル名（パスを含む）をキーにする（例: "editor/index"）
      const key = file.replace(/\\/g, '/').replace(/\.html$/, '');
      return [key, path.resolve(__dirname, file)];
    })
  );
};

export default defineConfig({
  base: './',
  plugins: [{
    name: 'edbb-build-version',
    apply: 'build',
    transformIndexHtml: {
      order: 'pre',
      handler: () => [{ tag: 'meta', attrs: { name: 'edbb-app-version', content: buildVersion }, injectTo: 'head' }],
    },
    generateBundle() {
      this.emitFile({ type: 'asset', fileName: 'version.json', source: JSON.stringify({ version: buildVersion }) });
    },
  }],
  // 開発サーバー設定
  server: {
    port: 5173,
    strictPort: false,
    cors: true,
  },

  // ビルド設定
  build: {
    rollupOptions: {
      input: getHtmlEntries(),
    },
  },

  // モジュール解決設定
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
    extensions: ['.ts', '.tsx', '.js', '.jsx', '.json'],
  },
});
