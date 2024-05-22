// 通过 NPM dependencies 成功安装 NPM 包后此处可引入使用
// 如安装 linq 包后就可以引入并使用这个包
// const linq = require("linq");

/**
 * @param {Params}  params     自定义参数
 * @param {Context} context    上下文参数，可通过此参数下钻获取上下文变量信息等
 * @param {Logger}  logger     日志记录器
 *
 * @return 函数的返回数据
 */
module.exports = async function (params, context, logger) {
  // 日志功能
  logger.info(`创建消息阅读记录 ${new Date()} 函数开始执行`, params);

  if (!params.user_ids || !params.message_send_record) {
    throw new Error("缺少参数,请检查");
  }

  if (params.user_ids === 0) {
    logger.info("用户ID列表为空，中断函数");
    return;
  }

  const { user_ids, message_send_record } = params;

  // 发送群消息时 创建消息阅读记录
  const createMessageReadRecord = async (userId, _id) => {
    try {
      const creataData = {
        message_send_record: { _id },
        accept_user: { _id: userId },
        read_status: "option_unread"
      };
      const res = await application.data.object('object_message_read_record').create(creataData);
      return {
        ...res,
        code: 0
      };
    } catch (error) {
      logger.error(`创建消息阅读记录 ${_id} 失败`, error);
      return { code: -1 };
    }
  };

  try {
    const result = await Promise.all(user_ids.map(userId => createMessageReadRecord(userId, message_send_record._id)));
    const successRes = result.filter(i => i.code === 0);
    const failRes = result.filter(i => i.code !== 0);
    logger.info(`创建消息阅读记录 总数：${result.length}，成功数量：${successRes.length}，失败数量：${failRes.length}`);
  } catch (error) {
    logger.error(`创建消息阅读记录`, error);
    throw new Error(`创建消息阅读记录`, error);
  }
}