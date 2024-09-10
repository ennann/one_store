const { newLarkClient, createLimiter, batchOperation } = require('../../utils');

/**
 * @param {Params}  params     自定义参数
 * @param {Context} context    上下文参数，可通过此参数下钻获取上下文变量信息等
 * @param {Logger}  logger     日志记录器
 *
 * @return 函数的返回数据
 */
module.exports = async function (params, context, logger) {
    const { chat_bot } = params;
    if (!chat_bot || !chat_bot._id) {
        logger.error('错误：缺少机器人信息');
        return { code: -1, message: '错误：缺少机器人信息' };
    }
    // 加上Redis锁
    await baas.redis.setex("GroupBotDeploy",60 * 10,"Y");
    // 调用函数获取群置顶的群聊ID列表
    const chatRecordList = await faas.function('DeployChatRange').invoke({ deploy_rule: chat_bot.chat_rule });
    const chatIdList = chatRecordList.map(item => item.chat_id);

    if (!chatIdList || chatIdList.length === 0) {
        logger.error('查询结果为空，未找到对应的群聊');
        return { code: -2, message: '未找到对应的群聊，无法移除' };
    }

    // 获取机器人信息并创建客户端实例
    const { bot_app_id } = chat_bot;
    const client = await newLarkClient({ userId: context.user._id }, logger);

    // 定义将机器人添加到群聊的函数
    const removeBotFromChat = async chat_id => {
        try {
            const response = await client.im.chatMembers.delete({
                path: { chat_id },
                params: {
                    member_id_type: 'app_id',
                },
                data: {
                    id_list: [bot_app_id],
                },
            });

            if (response.code !== 0) {
                throw new Error(`机器人 ${bot_app_id} 移出群聊 ${chat_id} 失败，错误信息：${response.msg}`);
            }

            return { code: 0, chat_id, message: '机器人移出群聊成功', result: 'success' };
        } catch (error) {
            return { code: -1, chat_id, message: error.message, result: 'failed' };
        }
    };

    // 创建限流器
    const limitedRemoveBotFromChat = createLimiter(removeBotFromChat);
    logger.info(`1.1【飞书测】开始移除群中机器人：${chatIdList.length};`);
    // 并行执行将机器人移除群聊的操作
    const removeBotResults = await Promise.all(chatIdList.map(chat_id => limitedRemoveBotFromChat(chat_id)));

    // 处理成功和失败的结果
    const successList = removeBotResults.filter(item => item.code === 0);
    const failedList = removeBotResults.filter(item => item.code !== 0);

    logger.info(`1.2【飞书测】移除群中机器人群数量：${removeBotResults.length}; 成功数量：${successList.length}; 失败数量：${failedList.length}`);

    // 找到关系表中的所有当前机器人关系
    const batchDeleteIds = [];
    await context.db
        .object('object_chat_bot_relation')
        .select('_id')
        .where({ bot: chat_bot._id })
        .findStream(async records => {
            batchDeleteIds.push(...records.map(item => item._id));
        });

    if (batchDeleteIds.length > 0) {
        try
        {
            logger.info(`2.1【apass】开始移除群与机器人关系记录：${batchDeleteIds.length};`);
            await batchOperation(logger, 'object_chat_bot_relation', 'batchDelete', batchDeleteIds);
            logger.info(`2.2【apass】移除群与机器人关系群数量：${batchDeleteIds.length};`);
        }catch (error){
            logger.info(`2.2【apass】移除群与机器人关系群失败->`,error);
        }
    }

    return { code: 0, message: '机器人移出群聊成功' };
};
