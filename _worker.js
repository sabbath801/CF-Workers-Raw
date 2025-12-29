/**
 * Cloudflare Worker: GitHub Raw Proxy with Auth
 * 2025 Refactored Version
 */

export default {
    async fetch(request, env) {
        const url = new URL(request.url);

        // --- 1. 首页处理 (Root Path) ---
        if (url.pathname === '/') {
            const envKey = env.URL302 ? 'URL302' : (env.URL ? 'URL' : null);
            if (envKey) {
                const URLs = await parseEnvList(env[envKey]);
                const targetURL = URLs[Math.floor(Math.random() * URLs.length)];
                return envKey === 'URL302' 
                    ? Response.redirect(targetURL, 302) 
                    : fetch(new Request(targetURL, request));
            }
            // 默认显示 Nginx 伪装页
            return new Response(nginxTemplate(), {
                headers: { 'Content-Type': 'text/html; charset=UTF-8' },
            });
        }

        // --- 2. 构建目标 GitHub URL ---
        let githubRawUrl = 'https://raw.githubusercontent.com';
        
        // 检查路径是否直接包含 raw.githubusercontent.com (兼容旧逻辑)
        // 注意：正则中 . 需要转义，且不再使用 new RegExp 避免开销
        const rawUrlRegex = /https:\/\/raw\.githubusercontent\.com/i;
        if (rawUrlRegex.test(url.pathname)) {
            githubRawUrl += url.pathname.split(rawUrlRegex)[1];
        } else {
            // 自动拼接环境变量
            const parts = [];
            if (env.GH_NAME) parts.push(env.GH_NAME);
            if (env.GH_REPO) parts.push(env.GH_REPO);
            if (env.GH_BRANCH) parts.push(env.GH_BRANCH);
            
            // 拼接基础路径
            if (parts.length > 0) {
                githubRawUrl += '/' + parts.join('/');
            }
            // 追加请求路径 (移除开头的 / 防止双斜杠，如果 githubRawUrl 结尾已有 /)
            githubRawUrl += url.pathname;
        }

        // 修复潜在的双斜杠问题 (https://... 之后的)
        githubRawUrl = githubRawUrl.replace(/([^:]\/)\/+/g, "$1");

        // --- 3. 鉴权逻辑 ---
        const headers = new Headers();
        let finalToken = "";
        let isAuthDone = false;
        const userProvidedToken = url.searchParams.get('token');

        // A. 检查 TOKEN_PATH (特定路径鉴权)
        if (env.TOKEN_PATH) {
            const pathConfigs = await parseEnvList(env.TOKEN_PATH);
            const normalizedPathname = decodeURIComponent(url.pathname.toLowerCase());

            for (const config of pathConfigs) {
                const splitIndex = config.indexOf('@');
                if (splitIndex === -1) continue;

                const requiredToken = config.substring(0, splitIndex).trim();
                const pathPart = config.substring(splitIndex + 1).trim();
                const normalizedConfigPath = '/' + pathPart.toLowerCase().replace(/^\/+/, ''); // 确保以 / 开头

                // 路径匹配逻辑
                if (normalizedPathname === normalizedConfigPath || 
                    normalizedPathname.startsWith(normalizedConfigPath + '/')) {
                    
                    if (!userProvidedToken) return new Response('TOKEN不能为空', { status: 400 });
                    if (userProvidedToken !== requiredToken) return new Response('TOKEN错误', { status: 403 });
                    if (!env.GH_TOKEN) return new Response('服务器GitHub TOKEN配置错误', { status: 500 });

                    finalToken = env.GH_TOKEN;
                    isAuthDone = true;
                    break;
                }
            }
        }

        // B. 默认鉴权 (如果未命中 TOKEN_PATH)
        if (!isAuthDone) {
            // 逻辑：
            // 1. 如果 env.TOKEN 存在且等于用户传的 token -> 使用 env.GH_TOKEN (隐藏真实 token)
            // 2. 否则使用用户传的 token
            // 3. 如果用户没传，尝试使用 env.GH_TOKEN 或 env.TOKEN 作为默认值
            
            if (env.TOKEN && userProvidedToken === env.TOKEN) {
                finalToken = env.GH_TOKEN || env.TOKEN;
            } else {
                finalToken = userProvidedToken || env.GH_TOKEN || env.TOKEN;
            }

            if (!finalToken) {
                return new Response('TOKEN不能为空', { status: 400 });
            }
        }

        // 设置 Authorization 头
        if (finalToken) {
            headers.append('Authorization', `token ${finalToken}`);
        }

        // --- 4. 发起请求 ---
        try {
            const response = await fetch(githubRawUrl, { 
                method: request.method,
                headers: headers 
            });

            if (response.ok) {
                return new Response(response.body, {
                    status: response.status,
                    headers: response.headers
                });
            } else {
                const errorText = env.ERROR || '无法获取文件，检查路径或TOKEN是否正确。';
                return new Response(errorText, { status: response.status });
            }
        } catch (e) {
            return new Response('服务器内部错误: ' + e.message, { status: 500 });
        }
    }
};

// 辅助函数：解析环境变量列表 (替代原有的 ADD)
async function parseEnvList(envStr) {
    if (!envStr) return [];
    // 将换行、制表符、引号替换为逗号，然后分割，过滤空项
    return envStr.replace(/[\s"'`]+/g, ',').split(',').filter(item => item.length > 0);
}

// 辅助函数：Nginx 伪装页面
function nginxTemplate() {
    return `
    <!DOCTYPE html>
    <html>
    <head>
    <title>Welcome to nginx!</title>
    <style>
        body { width: 35em; margin: 0 auto; font-family: Tahoma, Verdana, Arial, sans-serif; }
    </style>
    </head>
    <body>
    <h1>Welcome to nginx!</h1>
    <p>If you see this page, the nginx web server is successfully installed and
    working. Further configuration is required.</p>
    <p>For online documentation and support please refer to
    <a href="http://nginx.org/">nginx.org</a>.<br/>
    Commercial support is available at
    <a href="http://nginx.com/">nginx.com</a>.</p>
    <p><em>Thank you for using nginx.</em></p>
    </body>
    </html>`;
}
