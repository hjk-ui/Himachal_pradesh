/* eslint-disable @typescript-eslint/no-require-imports */
// Local-only UI test server. Never connects to a database or clinical service.
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const esbuild = require('esbuild');
const postcss = require('postcss');
const tailwind = require('tailwindcss');
async function main() {
  const result = await esbuild.build({
    entryPoints: [path.join(__dirname, 'clinical-preview-entry.tsx')],
    bundle: true,
    write: false,
    platform: 'browser',
    format: 'iife',
    jsx: 'automatic',
    define: { 'process.env.NODE_ENV': '"development"' },
    plugins: [
      {
        name: 'framework-test-shell',
        setup(build) {
          build.onResolve(
            { filter: /^(next\/link|next\/navigation|next-auth\/react)$/ },
            (args) => ({ path: args.path, namespace: 'test-shell' }),
          );
          build.onLoad({ filter: /.*/, namespace: 'test-shell' }, (args) => ({
            loader: 'tsx',
            resolveDir: process.cwd(),
            contents:
              args.path === 'next/link'
                ? 'export default function Link(props) { return <a {...props} />; }'
                : args.path === 'next/navigation'
                  ? 'export const useSearchParams = () => new URLSearchParams(); export const useRouter = () => ({push() {}, replace() {}, refresh() {}}); export const usePathname = () => "/dashboard";'
                  : 'export const useSession = () => ({ data: { user: { id: "test", role: "DIRECTOR", organizationId: "test" } }, status: "authenticated", update: async () => {} }); export const getSession = async () => null; export const signOut = async () => {}; export const signIn = async () => {};',
          }));
        },
      },
    ],
  });
  const css = await postcss([
    tailwind({
      ...require('../../tailwind.config.js'),
      content: ['./src/**/*.{ts,tsx}', './tests/e2e/clinical-preview-entry.tsx'],
    }),
  ]).process(fs.readFileSync('src/app/globals.css', 'utf8'), { from: 'src/app/globals.css' });
  http
    .createServer((req, res) => {
      if (req.url === '/app.js') {
        res.setHeader('Content-Type', 'text/javascript');
        return res.end(result.outputFiles[0].contents);
      }
      if (req.url === '/app.css') {
        res.setHeader('Content-Type', 'text/css');
        return res.end(css.css);
      }
      if (req.url.startsWith('/api/')) {
        res.writeHead(501);
        return res.end('API calls must be mocked by the test.');
      }
      res.setHeader('Content-Type', 'text/html');
      res.end(
        '<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><link rel="stylesheet" href="/app.css"></head><body><div id="root"></div><script src="/app.js"></script></body></html>',
      );
    })
    .listen(3407, '127.0.0.1');
}
main().catch((error) => {
  console.error(error);
  process.exit(1);
});
