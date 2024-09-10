// 通过 NPM dependencies 成功安装 NPM 包后此处可引入使用
// 如安装 linq 包后就可以引入并使用这个包
// const linq = require("linq");
const { newLarkClient, createLimiter,batchOperation } = require('../../utils');
const dayjs = require('dayjs');

/**
 * @param {Params}  params     自定义参数
 * @param {Context} context    上下文参数，可通过此参数下钻获取上下文变量信息等
 * @param {Logger}  logger     日志记录器
 *
 * @return 函数的返回数据
 */
module.exports = async function (params, context, logger) {
  if (!params.batch_record) {
    throw new Error("缺少消息批次记录");
  }
  logger.info('撤回信息的入参：',params);

  const { batch_record } = params;

  const DB = application.data.object;
  // 消息发送批次
  const BATCH_OBJECT = "object_message_send";
  // 消息发送记录
  const RECORD_OBJECT = "object_message_record";
  // 消息阅读记录
  const READ_OBJECT = "object_message_read_record";
  const client = await newLarkClient({ userId: context.user._id }, logger);

  // 撤回方法
  const recall = async (message_id) => {
    try {
      const res = await client.im.message.delete({ path: { message_id } });
      // logger.info('飞书平台撤回信息：',res);
      if (res.code !== 0) {
        logger.error(`${message_id} 消息撤回失败`);
        return { code: -1 };
      }
      return res;
    } catch (error) {
      logger.error(`${message_id} 消息撤回失败`, error);
      return { code: -1 };
    }
  };

  // 删除消息阅读记录
  const deleteMessageRead = async (_id) => {
    try {
      const readRecords = [];
      await DB(READ_OBJECT)
        .where({ message_send_record: { _id } })
        .select("_id")
        .findStream(records => readRecords.push(...records));
      await Promise.all(readRecords.map(item => DB(READ_OBJECT).delete(item)));
      return { code: 0 };
    } catch (error) {
      logger.error(`删除消息记录 ${_id} 下的阅读记录失败`, error);
      return { code: -1 };
    }
  };

  // 删除消息记录及阅读记录
  const deleteRecord = async (msg_record) => {
    try {
      if (msg_record.option_send_channel === "option_group") {
        await deleteMessageRead(msg_record._id);
      }
      await DB(RECORD_OBJECT).delete(msg_record);
      return { code: 0 };
    } catch (error) {
      logger.error(`删除消息记录 ${msg_record._id} 及阅读记录失败`);
      return { code: -1 };
    }
  };

    const deleteRecords = async (msgRecords) => {
        try {
            if (msgRecords[0]?.option_send_channel === "option_group") {
                const batchSize = 10;
                for(let i = 0; i < msgRecords.length; i += batchSize){
                    const batch = msgRecords.slice(i, i + batchSize);
                    await  Promise.all(batch.map(item => deleteMessageRead(item._id)))
                }
            }
            await batchOperation(logger, RECORD_OBJECT, "batchDelete",msgRecords);
            return { code: 0 };
        } catch (error) {
            logger.error(`删除消息记录 ${msg_record._id} 及阅读记录失败`);
            return { code: -1 };
        }
    };

  // 通过批次获取所有消息记录
  const getMessageRecords = async () => {
    const msgRecords = [];
    await DB(RECORD_OBJECT)
      .where({ message_batch: { _id: batch_record._id } })
      .select("_id", "result", "message_id", "option_send_channel", "message_chat")
      .findStream(records => msgRecords.push(...records));
    return {
      msgRecords,
      successRecords: msgRecords.filter(item => item.result === "option_success")
    };
  };

  // 获取批次详情
  const getBatchData = async () => {
    const record = await DB(BATCH_OBJECT)
      .where({ _id: batch_record._id })
      .select("_id", "option_status", "send_end_datetime")
      .findOne();
    return record;
  }

  try {
    const batchData = await getBatchData();
    if (batchData.option_status === "option_recall") {
        logger.warn("消息撤回失败，消息发送状态为撤回完成")
        return { code: -1 ,message: "消息撤回失败，消息发送状态为撤回完成"};
    }
    if (!["option_all_success", "option_part_success"].includes(batchData.option_status)) {
        logger.warn("消息撤回失败，消息发送状态为未发送完成")
        return { code: -1 ,message: "消息撤回失败，消息发送状态为未发送完成"};
    }
    if (!isWithinHours(batchData.send_end_datetime)) {
        logger.warn("消息撤回失败，消息发送时间已超过24小时")
        return { code: -1 ,message: "消息撤回失败，消息发送时间已超过24小时"};
    }

    const { msgRecords, successRecords } = await getMessageRecords();

    if (successRecords.length > 0) {
      const recallFun = createLimiter(recall);
      await Promise.all(successRecords.map(item => recallFun(item.message_id)));
    }

    if (msgRecords.length > 0) {
      // await Promise.all(msgRecords.map(item => deleteRecord(item)));
      // 采用分批执行的方式，防止数据量过大导致请求达到上限
      await  deleteRecords(msgRecords);

      // 更新批次状态为已撤回
      await DB(BATCH_OBJECT).update({
        _id: batch_record._id,
        option_status: "option_recall"
      });
    }
  } catch (error) {
      logger.info("批次消息撤回失败", error)
      return { code: -1 ,messages: error};
    // throw new Error("批次消息撤回失败", error);
  }
}

// 判断是否在24小时撤回时间内
function isWithinHours(timestamp, hours = 24) {
  const currentTime = dayjs();
  const timestampDate = dayjs(timestamp);
  const hoursDifference = currentTime.diff(timestampDate, 'hour');
  return hoursDifference < hours;
}
