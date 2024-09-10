const { newLarkClient,limitedFunctionWithRetry } = require('../../utils');
/**
 * @param {Params}  params     自定义参数
 * @param {Context} context    上下文参数，可通过此参数下钻获取上下文变量信息等
 * @param {Logger}  logger     日志记录器
 *
 * @return 函数的返回数据
 */
module.exports = async function (params, context, logger) {
    // 获取飞书客户端
    const client = await newLarkClient({ userId: context.user._id }, logger);

    const addUserToChat = async (chatId, addBatchUserList) => {
        return await client.im.chatMembers.create({
            path: { chat_id: chatId },
            params: { member_id_type: 'user_id' },
            data: { id_list: addBatchUserList }
        });
    }

    const chatId = params.chatId;
    const userList = params.userList;
    logger.info('入参：', params);

    if (!chatId || !userList){
        logger.error('参数错误');
        return {
            code: -1,
            msg: '参数错误'
        };
    }
    // 循环获取用户飞书 larkId
    let larkIdList = [];
    for (let item of userList) {
        let  larkId = await application.data
            .object("_user")
            .select("_lark_user_id")
            .where({_id: item.chat_member._id || item.chat_member.id })
            .findOne();
        larkIdList.push(larkId._lark_user_id);
    }

    logger.info('飞书用户id列表：', larkIdList.length);

    const batchSize = 90;

    // const limitAddUser = createLimiter(addUserToChat)
    for (let i = 0 ; i < larkIdList.length; i += batchSize){
        let addBatchUserList = larkIdList.slice(i, i + batchSize);
        try {
            // 创建一个新的函数，预先绑定参数
            const boundAddUserToChat = () => addUserToChat(chatId, addBatchUserList);
            await limitedFunctionWithRetry("AddUserListToChat",logger,boundAddUserToChat);
        }catch (e) {
            logger.error('添加用户失败', e);
        }
    }
    logger.info('添加用户完成');

}
