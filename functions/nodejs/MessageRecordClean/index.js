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
  const DB = application.data.object;
  const BATCH_OBJECT = "object_message_send";
  const RECORD_OBJECT = "object_message_record";
  const READ_OBJECT = "object_message_read_record";
  const clean_days = await application.globalVar.getVar("message_record_storage_days");

  // 获取多少天前的时间戳
  const getBeforeTimestamp = () => {
    const currentTime = dayjs();
    const daysAgo = currentTime.subtract(Number(clean_days), 'day');
    return daysAgo.valueOf();
  };

  const timestamp = getBeforeTimestamp();

  // 删除关联消息记录的阅读记录
  const deleteMessageRead = async (_id) => {
    try {
      const readRecords = [];
      await DB(READ_OBJECT)
        .where({ message_send_record: { _id } })
        .select("_id")
        .findStream(records => readRecords.push(...records));
      if (readRecords.length > 0) {
        await Promise.all(readRecords.map(item => DB(READ_OBJECT).delete(item)));
      }
      return { code: 0 };
    } catch (error) {
      logger.error(`删除消息记录 ${_id} 下的阅读记录失败`, error);
      return { code: -1 };
    }
  };

  // 删除批次关联的消息记录
  const deleteMessageRecord = async (_id) => {
    try {
      const msgRecords = [];
      await DB(RECORD_OBJECT)
        .where({ message_batch: { _id } })
        .select("_id")
        .findStream(records => msgRecords.push(...records));
      if (msgRecords.length > 0) {
        await Promise.all(msgRecords.map(item => {
          if (item.option_send_channel === "option_group") {
            deleteMessageRead(item._id);
          }
          DB(RECORD_OBJECT).delete(item);
        }));
      }
      await DB(BATCH_OBJECT).update({
        _id,
        remark: "消息发送记录已被清理"
      });
      return { code: 0 };
    } catch (error) {
      logger.error(`删除消息批次 ${_id} 下的消息记录失败`, error);
      return { code: -1 };
    }
  };

  try {
    const bacthRecords = [];
    await DB(BATCH_OBJECT)
      .where({
        _createdAt: application.operator.lt(timestamp),
        remark: application.operator.empty()
      })
      .select("_id")
      .findStream(records => bacthRecords.push(...records));
    if (bacthRecords.length > 0) {
      await Promise.all(bacthRecords.map(item => deleteMessageRecord(item._id)));
    } else {
      logger.warn(`没有超过 ${clean_days} 天的未清理的消息批次`)
    }
  } catch (error) {
    logger.error("清理消息记录失败", error);
  }
}