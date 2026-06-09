const puppeteer = require('puppeteer-core');
const fs = require('fs');

// 1. 读取并校验环境变量
const ugId = process.env.UG_ID || process.env.UGID; 
const webhookUrl = process.env.WEBHOOK_URL;
const intervalSeconds = parseInt(process.env.CHECK_INTERVAL) || 3600;

if (!ugId) {
    console.error("❌ 致命错误: 缺少必填环境变量 UG_ID。程序已拒绝运行并退出。");
    process.exit(1);
}

if (!webhookUrl) {
    console.error("❌ 致命错误: 缺少必填环境变量 WEBHOOK_URL。程序已拒绝运行并退出。");
    process.exit(1);
}

const targetUrl = `https://ug.link/${ugId}`;
const lastUrlFile = '/app/last_url.txt';
// 动态生成正则表达式，用于在 JS 渲染后的源码中兜底查找链接
const urlPattern = new RegExp(`https:\\/\\/${ugId}\\.cn[0-9]+\\.ug\\.link[a-zA-Z0-9/._-]*`);

/**
 * 显式剥离 hash fragment（# 及其后所有内容）。
 * 作为 normalizeUrl 的前置步骤，双保险确保 hash 不会干扰对比。
 * @param {string} url
 * @returns {string}
 */
function stripHash(url) {
    if (!url) return '';
    const idx = url.indexOf('#');
    return idx >= 0 ? url.substring(0, idx) : url;
}

/**
 * URL 标准化清洗函数
 * 1. 先显式剥离 hash fragment
 * 2. 再通过 URL API 只保留 origin + pathname + search
 * 3. 去除 pathname 末尾多余的 /，避免 /desktop/ 与 /desktop 被视为不同
 * @param {string} url
 * @returns {string}
 */
function normalizeUrl(url) {
    if (!url) return '';
    try {
        // 先剥离 hash，双保险
        const cleaned = stripHash(url.trim());
        const u = new URL(cleaned);
        const pathname = u.pathname.replace(/\/+$/, '') || '/';
        return u.origin + pathname + u.search;
    } catch (e) {
        // URL 解析失败时，降级为手动去除末尾 /、# 处理
        return url.trim().replace(/[/#]+$/, '').trim();
    }
}

async function checkUrl() {
    console.log(`[${new Date().toLocaleString()}] 🚀 启动浏览器抓取...`);
    let browser;
    try {
        browser = await puppeteer.launch({
            executablePath: process.env.PUPPETEER_EXECUTABLE_PATH || '/usr/bin/chromium',
            headless: "new",
            protocolTimeout: 240000, 
            args: [
                '--no-sandbox',
                '--disable-setuid-sandbox',
                '--disable-dev-shm-usage',
                '--disable-gpu',
                '--no-zygote',
                '--disable-software-rasterizer',
                '--disable-background-networking',
                '--disable-extensions',
                '--blink-settings=imagesEnabled=false'
            ]
        });
        
        const page = await browser.newPage();
        page.setDefaultNavigationTimeout(60000); 

        await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36');

        console.log(`[${new Date().toLocaleString()}] ⏳ 正在访问: ${targetUrl} ...`);
        await page.goto(targetUrl, { waitUntil: 'networkidle2' });

        await new Promise(r => setTimeout(r, 3000));

        let finalUrlRaw = page.url(); // 获取原始抓取的 URL

        if (!finalUrlRaw.includes(`${ugId}.cn`)) {
            const content = await page.content();
            const match = content.match(urlPattern);
            if (match) {
                finalUrlRaw = match[0];
            }
        }

        await browser.close();

        if (!finalUrlRaw.includes(`${ugId}.cn`)) {
            console.log(`[${new Date().toLocaleString()}] ❌ 仍未获取到目标链接，页面停留在: ${finalUrlRaw}`);
        } else {
            // 读取上一次的原始链接
            let lastUrlRaw = '';
            if (fs.existsSync(lastUrlFile)) {
                lastUrlRaw = fs.readFileSync(lastUrlFile, 'utf8').trim();
            }

            // 进行标准化处理后再对比
            const lastUrlNormalized = normalizeUrl(lastUrlRaw);
            const finalUrlNormalized = normalizeUrl(finalUrlRaw);

            console.log(`[${new Date().toLocaleString()}] 🔍 对比: [${lastUrlNormalized || '(空)'}] vs [${finalUrlNormalized}]`);

            // 首次运行（无历史记录）：只保存，不发通知，避免误报
            if (!lastUrlRaw) {
                console.log(`[${new Date().toLocaleString()}] 📝 首次运行，保存当前链接，不发送通知: ${finalUrlRaw}`);
                fs.writeFileSync(lastUrlFile, finalUrlRaw);
            } else if (finalUrlNormalized !== lastUrlNormalized) {
                // 标准化后的链接不一致，说明发生了实质性的域名/路径变化
                console.log(`[${new Date().toLocaleString()}] ✅ 发现域名实质变更: ${lastUrlNormalized} -> ${finalUrlNormalized}`);

                if (webhookUrl) {
                    const payload = {
                        msgtype: "text",
                        text: {
                            content: `⚠️ 绿联云域名跳转已更新\nUGID: ${ugId}\n变更前: ${lastUrlRaw}\n变更后: ${finalUrlRaw}\n更新时间: ${new Date().toLocaleString()}`
                        }
                    };

                    await fetch(webhookUrl, {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify(payload)
                    });
                    console.log(`[${new Date().toLocaleString()}] 📨 企业微信 Webhook 已发送`);
                }
                fs.writeFileSync(lastUrlFile, finalUrlRaw);
            } else {
                // 标准化链接一致，域名未发生实质变化
                if (finalUrlRaw !== lastUrlRaw) {
                    console.log(`[${new Date().toLocaleString()}] 💤 忽略细微变化 (如 hash/结尾斜杠): ${lastUrlRaw} -> ${finalUrlRaw}`);
                    // 更新存储文件，保持下次对比基于最新数据
                    fs.writeFileSync(lastUrlFile, finalUrlRaw);
                } else {
                    console.log(`[${new Date().toLocaleString()}] 💤 域名未变化: ${finalUrlRaw}`);
                }
            }
        }
    } catch (error) {
        console.error(`[${new Date().toLocaleString()}] ❌ 抓取过程中出错:`, error.message);
        if (browser) await browser.close().catch(() => {});
    }

    setTimeout(checkUrl, intervalSeconds * 1000);
}

checkUrl();
