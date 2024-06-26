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
  logger.info(`获取群成员列表 函数开始执行`, params);

  if (!params.chat_id) {
    throw new Error("缺少群ID");
  }

  const client = await newLarkClient({ userId: context.user._id }, logger);
  const { chat_id } = params;

  const getData = async (page_token) => {
    const members = [];
    try {
      const res = await client.im.chatMembers.get({
        path: { chat_id },
        params: {
          page_token,
          member_id_type: "user_id",
          page_size: 100,
        }
      });
      logger.info({ res });
      if (res.code !== 0) {
        throw new Error("获取群成员接口报错", error);
      }
      members.push(...res.data.items);
      if (!res.data.has_more) {
        return members;
      }
      const moreMembers = await getData(res.data.page_token);
      members.push(...moreMembers);
      return members;
    } catch (error) {
      logger.error("获取群成员接口报错", error);
      throw new Error("获取群成员接口报错", error);
    }
  }

  try {
    const userList = await getData();
    logger.info({ userList });
    return userList;
  } catch (error) {
    throw new Error("获取群成员失败", error);
  }
}