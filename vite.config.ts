import { defineConfig } from 'vite';
import path from 'path';
import { glob } from 'glob';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// プロジェクト内のHTMLファイルを自動的に取得
const getHtmlEntries = () => {
  const htmlFiles = glob.sync('**/*.html', {
    ignore: ['node_modules/**', 'dist/**', '.git/**'],
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
