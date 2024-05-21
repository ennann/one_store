// 通过 NPM dependencies 成功安装 NPM 包后此处可引入使用
// 如安装 linq 包后就可以引入并使用这个包
// const linq = require("linq");
const { chunkArray } = require('../utils');

/**
 * @param {Params}  params     自定义参数
 * @param {Context} context    上下文参数，可通过此参数下钻获取上下文变量信息等
 * @param {Logger}  logger     日志记录器
 *
 * @return 函数的返回数据
 */
module.exports = async function (params, context, logger) {
  // 日志功能
  logger.info(`创建消息发送记录 函数开始执行`, params);

  if(!params.message_define || !params.message_send_batch || !params.message_send_result ){
    throw new Error("缺少参数");
  }

  const { message_define,message_send_batch,message_send_result } = params;

  const getRecord = (record) => {
    let data = {
      message_send: { _id: message_define._id },
      message_batch: { _id: message_send_batch._id },
      option_send_channel: message_define.send_channel,
      message_id: record.data.message_id,
      read_status: "option_unread",
      result: record.code === 0 ? "option_success" : "option_failed"
    };
  };

  const batchCreateData = async (records) => {
    try {
      const recordList = records.map(item => ({
        message_send: { _id: message_define._id },
        message_batch: { _id: message_send_batch._id },
        option_send_channel: message_define.send_channel,
        message_id: item.data.message_id,
        read_status: "option_unread",
        result: item.code === 0 ? "option_success" : "option_failed"
      }));
      const result = await application.data.object("object_message_log").batchCreate(recordList);
      logger.info("批量创建日志成功", { recordList, result });
    } catch (error) {
      logger.error("批量创建日志失败", error);
    }
  };

  // try {
  //   // 将记录列表按照每个200的长度分成若干个数组
  //   const chunks = chunkArray(sendMessageResult);
  //   await Promise.all(chunks.map(item => batchCreateData(item)));
  //   logger.info("执行成功");
  // } catch (error) {
  //   logger.error("执行失败", error);
  // }
}