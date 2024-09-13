const dayjs = require('dayjs');
const _ = application.operator;

/**
 * @param {Params}  params     自定义参数
 * @param {Context} context    上下文参数，可通过此参数下钻获取上下文变量信息等
 * @param {Logger}  logger     日志记录器
 *
 * @return 函数的返回数据
 */
module.exports = async function (params, context, logger) {
    // 日志功能

    const { name, namespace } = context.tenant;

    logger.info(`机器人进群事件发生，函数开始执行`);

    logger.info(`租户信息：${namespace}/${name}}`);

    return context.tenant;
};
