/** 节点列表/详情头共用的短名格式化。
 *
 * 为什么单独放一个文件：`shortServer` 原本写在 NodesView 里，而桌面三栏的聊天头
 * 在 ChatPane 里；ChatPane 反过来 import 页面组件会形成循环依赖，所以抽到这里。
 */

/** 服务器名：阿里云 `iZ…oyZ` 这类长主机名截断到 8 字符 + 省略号。
 *  完整值应保留在调用方的 title 里，供悬停与读屏使用。 */
export function shortServer(server: string | null | undefined): string {
  if (!server) return '—';
  return server.length > 12 ? `${server.slice(0, 8)}…` : server;
}

/** 模型短名：`deepseek/deepseek-flash` → `deepseek-flash`。
 *  详情头那一行要同时放 agent / server / model，厂商前缀会把服务器名挤掉；
 *  完整值留在 title 里。没有 model 时返回空串，调用方据此整段不渲染 ——
 *  不留一个孤零零的分隔点。 */
export function shortModel(model: string | null | undefined): string {
  if (!model) return '';
  const slash = model.lastIndexOf('/');
  return slash >= 0 ? model.slice(slash + 1) : model;
}
