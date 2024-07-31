// 通过 NPM dependencies 成功安装 NPM 包后此处可引入使用
// 如安装 linq 包后就可以引入并使用这个包
// const linq = require("linq");
const { newLarkClient } = require('../../utils');

/**
 * @param {Params}  params     自定义参数
 * @param {Context} context    上下文参数，可通过此参数下钻获取上下文变量信息等
 * @param {Logger}  logger     日志记录器
 *
 * @return 函数的返回数据
 */
module.exports = async function (params, context, logger) {
  // 日志功能
  logger.info(`获取消息已读状态 ${new Date()} 函数开始执行`, params);

  if (!params.object_message_log) {
    throw new Error("缺少消息发送日志");
  }

  if (object_message_log.receive_id_type === "user_id") {
    throw new Error("消息接收类型不是飞书群");
  }

  const client = await newLarkClient({ userId: context.user._id }, logger);
  const { object_message_log } = params;

  // 获取消息已读人员
  const getRendUsers = async (page_token) => {
    const users = [];
    try {
      const res = await client.im.message.readUsers({
        path: { message_id: object_message_log.message_id },
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

  try {
    const readUsers = await getRendUsers();
    const chatUsers = await faas.function("ChatMemberListGet").invoke({ chat_id: object_message_log.receive_id });
    const chatUserIds = chatUsers.map(m => m.member_id);
    const read_user_ids = readUsers.map(i => i.user_id);
    const unread_user_ids = chatUserIds.filter(id => !read_user_ids.includes(id));
    return { read_user_ids, unread_user_ids };
  } catch (error) {
    logger.error("获取群消息已读人员失败", error);
    throw new Error("获取群消息已读人员失败", error);
  }
}