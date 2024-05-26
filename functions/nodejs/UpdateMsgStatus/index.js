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

  const chatId = params.chatId;
  // 获取消息id
  const messageId = await baas.redis.get(chatId);

  const client = await newLarkClient({ userId: context?.user?._id }, logger); // 创建 Lark 客户端

  const card_messageReq =
    '{"config":{"wide_screen_mode":true},"elements":[{"tag":"markdown","content":"群主已将一店一群机器人设为群管理员。"}],"header":{"template":"red","title":{"content":"🤖 机器人已授权","tag":"plain_text"}}}';
    // '{"config":{"wide_screen_mode":true},"elements":[{"tag":"markdown","content":"为了更好地服务大家，请将一店一群机器人设为群管理员。"},{"tag":"action","actions":[{"tag":"button","disabled":true,"text":{"tag":"plain_text","content":"点击授权"},"type":"primary","multi_url":{"url":"baidu.com","pc_url":"","android_url":"","ios_url":""}}]}],"header":{"template":"red","title":{"content":"🤖 一店一群机器人授权","tag":"plain_text"}}}';
    // let messageReq = JSON.parse(card_messageReq); 更新群消息卡片不需要json格式化

  // 更新飞书的卡片消息
  await client.im.message.patch({
    path: {
      message_id: messageId,
    },
    data: {
      content: card_messageReq,
    },
  },
  ).then(res => {
    console.log(res);
  });
  // 在这里补充业务代码
}