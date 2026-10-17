import test from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'vite';

test('生产构建可从 GitHub Pages 的海岛子目录加载所有入口资源', async () => {
  const result = await build({ logLevel: 'silent', build: { write: false } });
  const output = result.output;
  const html = output.find((file) => file.fileName === 'index.html').source.toString();
  const files = new Set(output.map((file) => file.fileName));
  const pageUrl = new URL('https://suqixu.github.io/sometest/demo/island/');
  const resources = [...html.matchAll(/(?:src|href)="([^"]+\.(?:js|css))"/g)];

  assert.ok(resources.some(([, reference]) => reference.endsWith('.js')), '应包含轻量加载入口');
  assert.ok(resources.some(([, reference]) => reference.endsWith('.css')), '应包含加载屏和场景样式表');
  for (const [, reference] of resources) {
    const url = new URL(reference, pageUrl);
    assert.ok(url.pathname.startsWith(pageUrl.pathname), `${reference} 必须留在部署子目录中`);
    assert.ok(files.has(url.pathname.slice(pageUrl.pathname.length)), `${reference} 必须对应实际构建文件`);
  }

  // The loading animation starts before the scene and Three are fetched.
  // All deferred dependencies must still resolve within the Pages directory.
  const chunks = output.filter(file => file.type === 'chunk');
  assert.ok(chunks.some(file => file.dynamicImports.length), '主场景应在加载动画启动后异步载入');
  for (const file of chunks) {
    for (const reference of [...file.imports, ...file.dynamicImports, ...file.referencedFiles]) {
      const url = new URL(reference, pageUrl);
      assert.ok(url.pathname.startsWith(pageUrl.pathname), `${reference} 必须留在部署子目录中`);
      assert.ok(files.has(url.pathname.slice(pageUrl.pathname.length)), `${reference} 必须对应实际构建文件`);
    }
  }

  const homeReference = html.match(/<a class="brand" href="([^"]+)"/)[1];
  assert.equal(new URL(homeReference, pageUrl).href, pageUrl.href, '首页链接应返回海岛页面');
});
