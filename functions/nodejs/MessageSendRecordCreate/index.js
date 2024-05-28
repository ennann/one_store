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
  logger.info('创建消息发送记录函数开始执行', params);
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
        .findStream(records => {
          const ids = records.map(i => i.chat_member._id);
          chatMemberIds.push(...ids);
        });
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
        ...(chat_record.chat_managers.length > 0 ? chat_record.chat_managers.map(i => i._id) : []),
        ...chatMemberIds,
        chat_record.chat_owner._id,
      ]));
      return {
        department: { _id: chat_record.department._id },
        message_chat: { _id: chat_record._id },
        unread_count: allMemberIds.length,
        allMemberIds
      };
    } catch (error) {
      logger.error(`获取飞书群 ${data.chat_id} 信息失败`, error);
    }
  };

  // 获取人员信息
  const getUserInfo = async (_lark_user_id) => {
    try {
      const user_record = await application.data.object('_user')
        .where({ _lark_user_id })
        .select("_id", "_department")
        .findOne();
      return {
        unread_count: 1,
        accept_user: [{ _id: user_record._id }],
        department: { _id: user_record._department._id }
      }
    } catch (error) {
      logger.error(`获取人员 ${_lark_user_id} 信息失败`, error);
    }
  };

  const createRecord = async (record) => {
    try {
      let createData = {
        message_send: { _id: message_define._id },
        message_batch: { _id: message_send_batch._id },
        option_send_channel: message_define.send_channel,
        message_id: record.data.message_id,
        read_status: "option_unread",
        read_count: 0,
        result: record.code === 0 ? "option_success" : "option_failed"
      };
      let user_ids;
      if (message_define.send_channel === "option_group") {
        const { allMemberIds, ...rest } = await getChatInfo(record.data);
        user_ids = allMemberIds;
        createData = { ...createData, ...rest };
      }
      if (message_define.send_channel === "option_user") {
        const userInfo = await getUserInfo(record.receive_id);
        createData = { ...createData, ...userInfo };
      }
      const message_send_record = await application.data.object("object_message_record").create(createData);
      if (message_define.send_channel === "option_group") {
        const task = await baas.tasks.createAsyncTask('MessageReadRecordCreate', {
          user_ids,
          message_send_record
        });
      }
    } catch (error) {
      logger.error(`创建消息发送记录 ${record.data.message_id} 失败`, error);
    }
  };

  try {
    await Promise.all(message_send_result.map(item => createRecord(item)));
  } catch (error) {
    logger.error("创建消息发送记录失败", error);
    throw new Error("创建消息发送记录失败", error);
  }
}