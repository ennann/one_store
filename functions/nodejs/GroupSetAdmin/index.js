const { newLarkClient } = require('../utils');

/**
 * @param {Params}  params     自定义参数
 * @param {Context} context    上下文参数，可通过此参数下钻获取上下文变量信息等
 * @param {Logger}  logger     日志记录器
 *
 * @return 函数的返回数据
 */
module.exports = async function (params, context, logger) {
    // 日志功能
    logger.info(`${new Date().toISOString}，设置群管理员函数开始执行`);

    const { chat_id, user_id } = params;

    // 在这里补充业务代码
    if (!chat_id || !user_id) {
        logger.error('缺少群聊ID或成员ID');
        return { code: -1, message: '缺少群聊ID或成员ID' };
    }

    let client = await newLarkClient({ userId: context.user._id }, logger);

    try {
        let res = await client.im.chatManagers.addManagers({
            path: { chat_id },
            params: { member_id_type: 'user_id' },
            data: { manager_ids: [user_id] },
        });
        if (res.code !== 0) {
            logger.error('设置群管理员失败', res);
            return { code: res.code, message: res.msg };
        }

        logger.info('设置群管理员成功', res);
        return { code: 0, message: '设置群管理员成功', data: res };
    } catch (error) {
        logger.error('设置群管理员失败', error);
        return { code: -2, message: '设置群管理员失败' };
    }
};
