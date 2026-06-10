const fs = require('fs');

// 1. 读取并校验环境变量
const alias = process.env.UG_ID || process.env.UGID;
const webhookUrl = process.env.WEBHOOK_URL;
const intervalSeconds = parseInt(process.env.CHECK_INTERVAL) || 3600;
const notifyOnFirstRun = process.env.NOTIFY_ON_FIRST_RUN === 'true';

if (!alias) {
    console.error("❌ 致命错误: 缺少必填环境变量 UG_ID。程序已拒绝运行并退出。");
    process.exit(1);
}

if (!webhookUrl) {
    console.error("❌ 致命错误: 缺少必填环境变量 WEBHOOK_URL。程序已拒绝运行并退出。");
    process.exit(1);
}

const apiUrl = 'https://api.ugnas.com/api/p2p/v2/ta/nodeInfo/byAlias';
const lastDomainFile = '/app/last_domain.txt';

/**
 * 调用绿联 API 获取当前 relayDomain
 * @returns {Promise<string|null>} relayDomain 或 null（请求失败时）
 */
async function fetchRelayDomain() {
    try {
        const res = await fetch(apiUrl, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/148.0.0.0 Safari/537.36',
                'lang': 'zh-CN'
            },
            body: JSON.stringify({ alias })
        });

        const json = await res.json();

        if (json.code === 200 && json.data && json.data.relayDomain) {
            return json.data.relayDomain.trim();
        }

        console.error(`[${new Date().toLocaleString()}] ⚠️ API 返回异常: code=${json.code}, msg=${json.msg}`);
        return null;
    } catch (error) {
        console.error(`[${new Date().toLocaleString()}] ❌ API 请求失败:`, error.message);
        return null;
    }
}

/**
 * 发送企业微信 Webhook 通知
 */
async function sendNotification(oldDomain, newDomain) {
    if (!webhookUrl) return;

    const payload = {
        msgtype: "text",
        text: {
            content: `⚠️ 绿联云域名跳转已更新\nUGID: ${alias}\n变更前: ${oldDomain}\n变更后: ${newDomain}\n更新时间: ${new Date().toLocaleString()}`
        }
    };

    try {
        await fetch(webhookUrl, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
        });
        console.log(`[${new Date().toLocaleString()}] 📨 企业微信 Webhook 已发送`);
    } catch (error) {
        console.error(`[${new Date().toLocaleString()}] ❌ Webhook 发送失败:`, error.message);
    }
}

async function check() {
    console.log(`[${new Date().toLocaleString()}] 🔍 正在查询 ${alias} 的 relayDomain...`);

    const currentDomain = await fetchRelayDomain();

    if (!currentDomain) {
        console.log(`[${new Date().toLocaleString()}] ❌ 本次未获取到域名，跳过对比，等待下次检查。`);
        return;
    }

    // 读取上次保存的域名
    let lastDomain = '';
    if (fs.existsSync(lastDomainFile)) {
        lastDomain = fs.readFileSync(lastDomainFile, 'utf8').trim();
    }

    console.log(`[${new Date().toLocaleString()}] 📋 对比: [${lastDomain || '(空)'}] vs [${currentDomain}]`);

    // 首次运行：根据 NOTIFY_ON_FIRST_RUN 决定是否发送通知
    if (!lastDomain) {
        fs.writeFileSync(lastDomainFile, currentDomain);
        if (notifyOnFirstRun) {
            console.log(`[${new Date().toLocaleString()}] 📝 首次运行，发送测试通知: ${currentDomain}`);
            await sendNotification('(首次运行)', currentDomain);
        } else {
            console.log(`[${new Date().toLocaleString()}] 📝 首次运行，保存当前域名，不发送通知: ${currentDomain}`);
        }
        return;
    }

    if (currentDomain !== lastDomain) {
        console.log(`[${new Date().toLocaleString()}] ✅ 域名变更: ${lastDomain} -> ${currentDomain}`);
        await sendNotification(lastDomain, currentDomain);
        fs.writeFileSync(lastDomainFile, currentDomain);
    } else {
        console.log(`[${new Date().toLocaleString()}] 💤 域名未变化: ${currentDomain}`);
    }
}

async function loop() {
    await check();
    setTimeout(loop, intervalSeconds * 1000);
}

loop();
