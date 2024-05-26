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
  // logger.info(`${new Date()} 函数开始执行`);
  

  // 在这里补充业务代码
  const larkChatId = params.larkChatId;
  const client = await newLarkClient({ userId: context?.user?._id }, logger); // 创建 Lark 客户端
  // 获取飞书群详细信息
  const chatRes = await client.im.chat.get({
		path: {
			chat_id: larkChatId,
		},
    params: {
      user_id_type: 'user_id',
    },
	},
);
  const larkChatOwnerId = chatRes?.data?.owner_id;

  return {larkChatOwnerId: larkChatOwnerId}

}