// 通过 NPM dependencies 成功安装 NPM 包后此处可引入使用
// 如安装 linq 包后就可以引入并使用这个包
// const linq = require("linq");
const dayjs = require('dayjs');

/**
 * @param {Params}  params     自定义参数
 * @param {Context} context    上下文参数，可通过此参数下钻获取上下文变量信息等
 * @param {Logger}  logger     日志记录器
 *
 * @return 函数的返回数据
 */
module.exports = async function (params, context, logger) {
  // 日志功能
  logger.info(`清理消息记录 ${new Date()} 函数开始执行`);

  const DB = application.data.object;
  const RECORD_OBJECT = "object_message_record";
  const READ_OBJECT = "object_message_read_record";
  const clean_days = await application.globalVar.getVar("message_record_storage_days");

  // 获取多少天前的时间戳
  const getBeforeTimestamp = () => {
    const currentTime = dayjs();
    const daysAgo = currentTime.subtract(Number(clean_days), 'day');
    return daysAgo.valueOf();
  };

  // 删除关联消息记录的阅读记录
  const deleteMessageRead = async (_id) => {
    try {
      const readRecords = [];
      await DB(READ_OBJECT)
        .where({ message_send_record: { _id } })
        .select("_id")
        .findStream(records => readRecords.push(...records));
      logger.info({ readRecords });
      if (readRecords.length > 0) {
        await Promise.all(readRecords.map(item => DB(READ_OBJECT).delete(item)));
        logger.info(`删除的消息阅读记录数量：${readRecords.length}`);
      } else {
        logger.info(`消息记录 ${_id} 关联的阅读记录为空`);
      }
      return { code: 0 };
    } catch (error) {
      logger.error(`删除消息记录 ${_id} 下的阅读记录失败`, error);
      return { code: -1 };
    }
  };

  try {
    const msgRecords = [];
    const timestamp = getBeforeTimestamp();
    await DB(RECORD_OBJECT)
      .where({ _createdAt: application.operator.lt(timestamp) })
      .select("_id", "option_send_channel")
      .findStream(records => msgRecords.push(...records));
    logger.info({ msgRecords });
    if (msgRecords.length > 0) {
      await Promise.all(msgRecords.map(item => {
        if (item.option_send_channel === "option_group") {
          deleteMessageRead(item._id);
        }
        DB(RECORD_OBJECT).delete(item);
      }));
      logger.info(`清理消息记录成功，清理数量：${msgRecords.length}`);
    } else {
      logger.info(`${clean_days}天前的消息记录为空`);
    }
  } catch (error) {
    logger.error("清理消息记录成功", error);
  }
}