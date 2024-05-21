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

  if (!params.message_define || !params.message_send_batch || !params.message_send_result) {
    throw new Error("缺少参数");
  }

  const { message_define, message_send_batch, message_send_result } = params;

  // 获取飞书群成员
  const getChatMembers = async (_id) => {
    try {
      const chatMemberIds = [];
      await application.data.object('object_chat_member')
        .where({ store_chat: { _id } })
        .select("_id", "chat_member")
        .findStream(record => chatMemberIds.push(record.chat_member._id));
      return chatMemberIds;
    } catch (error) {
      logger.error(`获取飞书群 ${_id} 成员失败`, error);
      throw new Error(`获取飞书群 ${_id} 成员失败`, error);
    }
  };

  // 获取群信息
  const getChatInfo = async (data) => {
    try {
      const chat_record = await application.data.object('object_feishu_chat')
        .where({
          chat_id: data.chat_id,
          chat_status: "option_02"
        })
        .select("_id", "chat_owner", "chat_managers", "department")
        .findOne();

      const chatMemberIds = await getChatMembers(chat_record._id);
      const allMemberIds = Array.from(new Set([
        ...chatMemberIds,
        ...chat_record.chat_managers.map(i => i._id),
        chat_record.chat_owner._id,
      ]));
      return {
        message_chat: { _id: chat_record._id },
        department: chat_record.department,
        unread_count: allMemberIds.length,
      };
    } catch (error) {
      logger.error(`获取飞书群 ${data.chat_id} 信息失败`, error);
    }
  };

  const getRecord = (record) => {
    let data = {
      message_send: { _id: message_define._id },
      message_batch: { _id: message_send_batch._id },
      option_send_channel: message_define.send_channel,
      message_id: record.data.message_id,
      read_status: "option_unread",
      read_count: 0,
      result: record.code === 0 ? "option_success" : "option_failed"
    };
    if (message_define.send_channel === "option_group") {
      const chatInfo = await getChatInfo(record.data);
      data = { ...data, ...chatInfo };
    }
    return data;
  };

  const batchCreateData = async (records) => {
    try {
      const recordList = records.map(item => getRecord(item));
      const result = await application.data.object("object_message_record").batchCreate(recordList);
      logger.info("创建消息发送记录成功", { recordList, result });
    } catch (error) {
      logger.error("创建消息发送记录失败", error);
    }
  };

  // try {
  //   // 将记录列表按照每个200的长度分成若干个数组
  //   const chunks = chunkArray(message_send_result);
  //   await Promise.all(chunks.map(item => batchCreateData(item)));
  //   logger.info("执行成功");
  // } catch (error) {
  //   logger.error("执行失败", error);
  // }
}