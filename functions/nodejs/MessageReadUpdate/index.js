// 通过 NPM dependencies 成功安装 NPM 包后此处可引入使用
// 如安装 linq 包后就可以引入并使用这个包
// const linq = require("linq");
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
  logger.info(`更新消息已读未读状态 ${new Date()} 函数开始执行`, params);

  if (!params.message_batch) {
    throw new Error("请传入消息发送批次");
  }

  const { message_batch } = params;
  const DB = application.data.object;
  const RECORD_OBJECT = "object_message_record";
  const client = await newLarkClient({ userId: context.user._id }, logger);

  // 获取批次关联的消息发送记录
  const getMsgRecord = async () => {
    try {
      const msgRecords = [];
      await DB(RECORD_OBJECT).where({ message_batch: { _id: message_batch._id } })
        .select("_id", "message_id", "option_send_channel", "message_chat", "accept_user")
        .findStream(records => msgRecords.push(...records));
      logger.info({ msgRecords });
      return msgRecords;
    } catch (error) {
      throw new Error("获取批次关联的消息发送记录失败", error);
    }
  };

  // 获取消息已读人员
  const getRendUsers = async (message_id, page_token) => {
    const users = [];
    try {
      const res = await client.im.message.readUsers({
        path: { message_id },
        params: {
          page_token,
          page_size: 100,
          user_id_type: "user_id",
        }
      });
      logger.info({ res });
      if (res.code !== 0) {
        throw new Error("查询消息已读信息接口报错", error);
      }
      users.push(...res.data.items);
      if (!res.data.has_more) {
        return users;
      }
      const moreUsers = await getRendUsers(res.data.page_token);
      users.push(...moreUsers);
      return users;
    } catch (error) {
      logger.error("查询消息已读信息接口报错", error);
      throw new Error("查询消息已读信息接口报错", error);
    }
  };

  // 

}