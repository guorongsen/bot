import { ProxyAgent, setGlobalDispatcher } from 'undici';

/** 配置 Node fetch 代理，使 OKX/OpenAI 请求能走本机网络代理。 */
export function configureProxy() {
  const proxy = process.env.HTTPS_PROXY || process.env.HTTP_PROXY || process.env.ALL_PROXY;
  if (!proxy) return null;
  setGlobalDispatcher(new ProxyAgent(proxy));
  return proxy;
}

export default { configureProxy };
