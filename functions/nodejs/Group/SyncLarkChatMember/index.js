const {newLarkClient, createLimiter} = require('../../utils');

/**
 * @param {Params}  params     自定义参数
 * @param {Context} context    上下文参数，可通过此参数下钻获取上下文变量信息等
 * @param {Logger}  logger     日志记录器
 *
 * @return 函数的返回数据
 */
module.exports = async function (params, context, logger) {
    // 日志功能
    logger.info(`${new Date()} 函数开始执行, 参数为: ${JSON.stringify(params)}`);
    const chat = params.chat;

    if (!chat) {
        logger.error(`${new Date()} 函数执行结束，无有效数据`);
        return [];
    }
    // 创建飞书客户端
    const client = await newLarkClient({userId: context.user._id}, logger);
    // 获取飞书群成员列表
    const syncLarkChatMember = async (larkChatId) => {
        // 获取群成员列表
        let chatMember = [];
        try {
            // 获取当前群的群成员信息
            await (async () => {
                for await (const item of await client.im.chatMembers.getWithIterator({
                        path: {
                            chat_id: larkChatId,
                        },
                        params: {
                            member_id_type: 'user_id',
                        },
                    }
                )) {
                    const memberIds = item.items.map(item => item.member_id);
                    chatMember.push(...memberIds);
                }
            })();
            logger.info('获取群成员信息成功，共：', chatMember.length);
            return chatMember;
        } catch (e) {
            logger.error('获取群成员信息失败：', e);
            return {
                code: 3,
                msg: '获取群成员信息失败'
            }
        }
    }

    // const limitSyncLarkCharMember = createLimiter(syncLarkChatMember);
    try {
        const larkChatId = chat.chat_id;
        const chatId = chat._id;

        // 获取飞书侧群成员
        const larkChatMemberRes = await syncLarkChatMember(larkChatId);
        // const larkChatMemberRes = await limitSyncLarkCharMember(larkChatId);

        // 获取 apaas 侧群成员列表
        const groupMemberRes = await application.data.object('object_chat_member')
            .select('chat_member')
            .where({store_chat: {_id: Number(chatId)}}).find();

        // 获取已存在的用户 id
        const existUserIds = groupMemberRes.map(item => item.chat_member._id);

        // 判断成员列表是否一致，多出的则新增
        for (const larkMemberItem of larkChatMemberRes) {
            let userRecord = await application.data
                .object('_user')
                .select('_id', '_name')
                .where({_lark_user_id: larkMemberItem})
                .findOne();
            let flag = existUserIds.find(item => item === userRecord._id)
            if (userRecord && !flag) {
                const userId = userRecord._id;
                //     创建飞书群成员
                await application.data.object('object_chat_member').create({
                    store_chat: {_id: Number(chatId)},
                    chat_member: {_id: userId},
                    chat_member_role: 'option_group_member',
                });
            }
        }
    }catch (e) {
        logger.error('同步飞书群成员失败：', e);
    }
}
