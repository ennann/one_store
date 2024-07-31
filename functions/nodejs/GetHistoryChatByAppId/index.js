// 通过 NPM dependencies 成功安装 NPM 包后此处可引入使用
// 如安装 linq 包后就可以引入并使用这个包
// const linq = require("linq");
const {newLarkClient} = require('../utils');
const lark = require('@larksuiteoapi/node-sdk');
/**
 * @param {Params}  params     自定义参数
 * @param {Context} context    上下文参数，可通过此参数下钻获取上下文变量信息等
 * @param {Logger}  logger     日志记录器
 *
 * @return 函数的返回数据
 */
module.exports = async function (params, context, logger) {
    // 日志功能
    logger.info(`${new Date()} 获取历史群函数开始执行，入参：`, params.appId);
    // 获取传入的历史群群主机器人appid
    const appId = params.appId;
    const appSecret = params.appSecret;
    if (!appId || !appSecret) {
        logger.error(`${new Date()} 获取历史群函数入参appid为空`)
        throw new Error('appid为空!')
    }
    // 创建飞书客户端
    const client = await newLarkClient({userId: context.user._id}, logger);

    // 在 Redis 中获取历史群机器人 token
    let token = await baas.redis.get('historyChatToken');
    if (!token) {
        //获取历史群机器人 token
        const tokenRes = await client.auth.tenantAccessToken.internal({
            data: {
                app_id: appId,
                app_secret: appSecret,
            },
        });
        // 获取失败的情况
        if (tokenRes.code !== 0) {
            logger.error("获取历史群应用机器人 Token 失败！")
            throw new Error('获取历史群应用机器人 Token 失败!');
        }

        token = tokenRes.tenant_access_token;
        // 数据存储到 Redis中一个半小时
        await baas.redis.setex('historyChatToken', 60 * 60 * 1.5, token);
        // 也存储到 redis 中后面函数要用
        await baas.redis.setex('historyAppId', 60 * 60 * 24 * 30, appId);
        await baas.redis.setex('historyAppSecret', 60 * 60 * 24 * 30, appSecret);
    }

    logger.info(`${new Date()} 获取历史群函数获取历史群机器人token成功，token：${token}`)

    let rebootChatList = [];
    //   调用飞书开发平台获取历史群列表信息
    await (async () => {
        for await (const item of await client.im.chat.listWithIterator({
                params: {
                    user_id_type: 'user_id'
                },
            },
            lark.withTenantToken(token)
        )) {
            console.log(item);
            let rebootChat = [];
            rebootChat = item.items.filter(item => !item.owner_id)
            rebootChatList.push(...rebootChat)
        }
    })();
    logger.info('获取到的机器人当群主的历史群：', rebootChatList);

    // 当不存在机器人当群主的情况
    if (rebootChatList.length === 0) {
        logger.error(`${new Date()} 历史群无机器人当群主的情况`);
        throw new Error('历史群无机器人当群主的情况');
    }
    // 将获取到的历史群信息存储到 apaas 的历史群表中
    try {
        for (let item of rebootChatList) {
            if (item.chat_status === 'normal') {
                // 判断历史表中是否有改历史群信息
                const isHaveChat = await application.data.object('object_history_feishu_chat')
                    .select('chat_name', 'chat_id')
                    .where({
                        'chat_id': item.chat_id
                    }).findOne();
                // 不存在的情况下新增
                if (!isHaveChat) {
                    await application.data.object('object_history_feishu_chat')
                        .create({
                            'chat_name': item.name,
                            'chat_id': item.chat_id,
                            'history_chat_authorize_status': 'option_license_not_transferred'
                        })
                }
            }
        }
    } catch (error) {
        logger.error(`${new Date()} 获取历史群函数存储历史群信息失败，错误信息：${error}`);
    }
}
