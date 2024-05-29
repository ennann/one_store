// node-sdk使用说明：https://github.com/larksuite/node-sdk/blob/main/README.zh.md
const lark = require('@larksuiteoapi/node-sdk');

// 开发者复制该Demo后，需要修改Demo里面的"app id", "app secret"为自己应用的appId, appSecret
const client = new lark.Client({
    appId: 'cli_a6b23873d463100b',
    appSecret: 'UzsmHpBmOqaST2ivt4y9Qj0kgmjgqke2',
});

client.im.message
    .create({
        params: {
            receive_id_type: 'email',
        },
        data: {
            receive_id: 'zhaoyizhe@bytedance.com',
            msg_type: 'text',
            content: '{"text":"test conten121212121212t"}',
        },
    })
    .then(res => {
        console.log(res);
    });
