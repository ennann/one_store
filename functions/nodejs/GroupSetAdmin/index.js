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
    logger.info(`${new Date().toISOString}，设置群管理员函数开始执行`, params);

    const { chat_id, users } = params;

    // 在这里补充业务代码
    if (!chat_id || !users) {
        logger.error('缺少群聊ID或用户信息');
        return { code: -1, message: '缺少群聊ID或用户信息' };
    }

    let client = await newLarkClient({ userId: context.user._id }, logger);

    let manager_ids = users.map(user => user._lark_user_id);

    // 如果 manager_ids 为空，则不执行设置管理员操作
    if (manager_ids.length === 0) {
        logger.warn('没有需要设置为管理员的用户');
        return { code: 0, message: '没有需要设置为管理员的用户' };
    }

    // 如果 manager_ids 大于 10 个，则只取前 10 个
    if (manager_ids.length > 10) {
        logger.warn('设置管理员的用户数量超过 10 个，只取前 10 个');
        manager_ids = manager_ids.slice(0, 10);
    }

    try {
        let res = await client.im.chatManagers.addManagers({
            path: { chat_id },
            params: { member_id_type: 'user_id' },
            data: { manager_ids  },
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
