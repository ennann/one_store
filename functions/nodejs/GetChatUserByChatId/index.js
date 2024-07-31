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
    logger.info(`${new Date()} 获取指定群成员函数开始执行`, params);
    // 获取 apaas 群 id以及飞书群 id
    const {larkChatId} = params

    // 创建飞书客户端
    const client = await newLarkClient({userId: context.user._id}, logger);

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
    } catch (e) {
        logger.error('获取群成员信息失败：', e);
        return {
            code: 3,
            msg: '获取群成员信息失败'
        }
    }
    logger.info('获取群成员信息成功：', chatMember);
    // 获取飞书群
    const feishuChat = await application.data
        .object('object_feishu_chat')
        .select('_id', 'chat_id',  'chat_group_type')
        .where({ chat_id: larkChatId })
        .findOne();
    const chatId = feishuChat._id;

    const groupMemberRes = await application.data.object('object_chat_member')
        .select('chat_member')
        .where({ store_chat: {_id: Number(chatId)} }).find();

    if (groupMemberRes.length > 0){
        return {code: 1, msg: '正在同步中途，请勿重复提交'};
    }


    for (let larKUserIdItem of chatMember) {
        // 获取 apaas 用户信息
        try {
            let userRecord = await application.data
                .object('_user')
                .select('_id', '_name')
                .where({_lark_user_id: larKUserIdItem})
                .findOne();
            if (userRecord) {
                const userId = userRecord._id;
                //     创建飞书群成员
                await application.data.object('object_chat_member').create({
                    store_chat: {_id: Number(chatId)},
                    chat_member: {_id: userId},
                    chat_member_role: 'option_group_member',
                });
            }
        } catch (e) {
            logger.warn('创建飞书群成员过程中出现问题',e);
        }
    }
    logger.info('创建飞书群成员成功');

    return {code: 0, msg: '创建飞书群成员成功'};

    // 在这里补充业务代码
}
