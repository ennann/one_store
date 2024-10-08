const { newLarkClient, batchOperation, createLimiter } = require('../../utils');

/**
 * @param {Params}  params     自定义参数
 * @param {Context} context    上下文参数，可通过此参数下钻获取上下文变量信息等
 * @param {Logger}  logger     日志记录器
 *
 * @return 函数的返回数据
 */
module.exports = async function (params, context, logger) {
    const { chat_pin } = params;

    if (!chat_pin) {
        logger.error('缺少需要删除的置顶');
        return { code: -1, message: '缺少需要删除的置顶' };
    }
    // 加上Redis锁
    await baas.redis.setex("GroupTabDeploy",60 * 10,"Y");

    // 获取群置顶的群聊ID
    // const chatRecordList = await faas.function('GroupTabDeployRange').invoke({ chat_tab_deploy_range: chat_pin });
    const chatRecordList = await faas.function('DeployChatRange').invoke({ deploy_rule: chat_pin.chat_rule });
    const chatIdList = chatRecordList.map(item => item.chat_id);

    // 定义一个删除函数
    const deleteGroupTab = async (client, chat_id, tab_name) => {
        try {
            let chat_tab_response = await client.im.chatTab.listTabs({
                path: {
                    chat_id: chat_id,
                },
            });

            if (chat_tab_response.code !== 0) {
                return { chat_id, result: 'failed', message: '获取群置顶标签失败: ' + chat_tab_response.msg || chat_tab_response.message };
            }

            // 获取所有 tab_name 相等的 tab_id
            const tab_ids = chat_tab_response.data.chat_tabs.filter(item => item.tab_name === tab_name).map(item => item.tab_id);

            if (tab_ids.length === 0) {
                return { chat_id, result: 'failed', message: `群内未找到名为 ${tab_name} 的置顶标签` };
            }

            let delete_response = await client.im.chatTab.deleteTabs({
                path: {
                    chat_id: chat_id,
                },
                data: {
                    tab_ids: tab_ids,
                },
            });

            if (delete_response.code !== 0) {
                return { chat_id, result: 'failed', message: '删除群置顶标签失败: ' + delete_response.msg || delete_response.message };
            }
            return { chat_id, result: 'success', message: `成功删除群置顶 - ${chat_pin.pin_name}` };
        } catch (error) {
            return { chat_id, result: 'failed', message: error.message };
        }
    };

    // 循环 chatIdList 创建 Promise
    const client = await newLarkClient({ userId: context.user._id }, logger);

    // 添加限流器
    const deleteGroupTapLimiter = createLimiter(deleteGroupTab);
    // 并发执行 Promise
    const deleteResults = await Promise.all(chatIdList.map(chat_id => deleteGroupTapLimiter(client, chat_id, chat_pin.pin_name)));

    const batchDeleteIds = [];
    await application.data
        .object('object_chat_pin_relation')
        .select('_id')
        .where({ chat_pin: chat_pin._id })
        .findStream(async record => {
            batchDeleteIds.push(...record.map(item => item._id));
        });

    if (batchDeleteIds.length > 0) {
        batchOperation(logger, 'object_chat_pin_relation', 'batchDelete', batchDeleteIds);
    }

    return { deleteResults };
};
