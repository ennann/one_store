const lark = require('@larksuiteoapi/node-sdk');


/**
 * 发送消息
 * @param {lark.Client} client - Lark Client 实例
 */
async function sendMessage(client) {
    try {
        const res = await client.im.message.create({
            params: {
                receive_id_type: 'email',
            },
            data: {
                receive_id: 'zhaoyizhe@bytedance.com',
                msg_type: 'text',
                content: '{"text":"test content"}',
            },
        });
        console.log(res);
    } catch (error) {
        console.error('发送消息失败:', error);
    }
}

async function main() {
    // 
    const appId = "cli_a6b23873d463100b";
    const client = new lark.Client({ appId, appSecret: 'fake', disableTokenCache: false });
    client.tokenManager.cache.set(lark.CTenantAccessToken, "t-g1045thMNVDZMNDRPY7YHT33ESMQ7XATMD7DEK5Q", null, { "namespace": appId });

    await sendMessage(client);
}

main();
