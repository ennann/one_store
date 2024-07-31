const { newLarkClient } = require('../../utils');

/**
 * @param {Params}  params     自定义参数
 * @param {Context} context    上下文参数，可通过此参数下钻获取上下文变量信息等
 * @param {Logger}  logger     日志记录器
 *
 * @return 函数的返回数据
 */
module.exports = async function (params, context, logger) {
    logger.info(`设置群管理员函数开始执行`, params);
    const { chat_id, users } = params;

    // 在这里补充业务代码
    if (!chat_id || !users) {
        logger.error('缺少群聊ID或用户信息');
        return { code: -1, message: '缺少群聊ID或用户信息' };
    }

    // 从 users 列表中拿到每一个元素的 id 或者 _id
    let userIds = users.map(user => user._id || user.id);
    logger.info(userIds)
    if (userIds.length === 0) {
        logger.error('用户信息为空');
        return { code: -1, message: '用户信息为空' };
    }

    // 根据 userIds 从用户表中查询用户信息
    let userRecords = await application.data
        .object('_user')
        .select('_lark_user_id')
        .where({ _id: application.operator.in(userIds) })
        .limit(10)
        .find();
        

    let manager_ids = userRecords.map(user => user._lark_user_id);
    logger.info(manager_ids);

    let client = await newLarkClient({ userId: context.user._id }, logger);

    // 如果 manager_ids 为空，则不执行设置管理员操作
    if (manager_ids.length === 0) {
        logger.warn('没有需要设置为管理员的用户');
        return { code: 0, message: '没有需要设置为管理员的用户' };
    }

    try {
        let res = await client.im.chatManagers.addManagers({
            path: { chat_id },
            params: { member_id_type: 'user_id' },
            data: { manager_ids },
        });
        if (res.code !== 0) {
            logger.error('设置群管理员失败', res.msg);
            return { code: res.code, message: res.msg };
        }

        return { code: 0, message: '设置群管理员成功', data: res };
    } catch (error) {
        logger.error('设置群管理员失败', error);
        return { code: -2, message: '设置群管理员失败' };
    }
};
