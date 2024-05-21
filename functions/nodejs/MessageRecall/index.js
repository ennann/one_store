// 通过 NPM dependencies 成功安装 NPM 包后此处可引入使用
// 如安装 linq 包后就可以引入并使用这个包
// const linq = require("linq");
const { newLarkClient, createLimiter } = require('../utils');

/**
 * @param {Params}  params     自定义参数
 * @param {Context} context    上下文参数，可通过此参数下钻获取上下文变量信息等
 * @param {Logger}  logger     日志记录器
 *
 * @return 函数的返回数据
 */
module.exports = async function (params, context, logger) {
  // 日志功能
  logger.info(`消息撤回 函数开始执行`, params);

  if (!params.object_message_send) {
    throw new Error("缺少消息发送记录");
  }

  const client = await newLarkClient({ userId: context.user._id }, logger);
  const { object_message_send } = params;

  // 撤回方法
  const recall = async (message_id) => {
    try {
      const res = await client.im.message.delete({ path: { message_id } });
      logger.info({ res });
      if (res.code !== 0) {
        logger.error(`${message_id} 消息撤回失败`);
      }
      return res;
    } catch (error) {
      logger.error(`${message_id} 消息撤回失败`, error);
      throw new Error(`${message_id} 消息撤回失败`, error);
    }
  };

  // 通过消息记录获取所有消息
  const getMessages = async () => {
    try {
      const logList = [];
      await application.data.object("object_message_log")
        .where({
          message_send: { _id: object_message_send._id },
          result: "option_success"
        })
        .select("_id", "message_id")
        .findStream(async (records) => logList.push(...records));
      logger.info({ logList });
      return logList;
    } catch (error) {
      logger.error("获取消息日志列表失败", error);
      throw new Error("获取消息日志列表失败", error);
    }
  };

  try {
    const logs = await getMessages();
    const recallMessage = createLimiter(recall);
    const recallResult = await Promise.all(logs.map(item => recallMessage(item.message_id)));
    const successList = recallResult.filter(item => item?.code === 0);
    const errorList = recallResult.filter(item => item?.code !== 0);
    logger.info(`消息撤回总数: ${recallResult.length}, 成功数量: ${successList.length}, 失败数量: ${errorList.length}`);
  } catch (error) {
    throw new Error("消息撤回失败", error);
  }
}